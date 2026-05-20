import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import Header from "@/components/layout/Header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Users, Plus, Edit, Phone, Mail, MapPin, Trash2, ChevronRight, ChevronLeft, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import CustomersAnalytics from "@/components/dashboard/CustomersAnalytics";
import { formatDate } from "@/lib/dateFormat";
import { normalizePhone } from "@/lib/normalizePhone";

const PAGE_SIZE = 25;

const Customers = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(0);
  const { toast } = useToast();
  const { canDeleteCustomers } = useAuth();

  const [formData, setFormData] = useState({
    name: "", phone: "", email: "", address: "", city: "",
  });

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchQuery(searchInput.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(0); }, [dateFrom, dateTo]);

  // Total count (always reflects full DB filtered count)
  const { data: totalCount = 0 } = useQuery({
    queryKey: ['customers-count', searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from('customers').select('*', { count: 'exact', head: true });
      if (searchQuery) q = q.or(`name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
      if (dateFrom) q = q.gte('created_at', new Date(dateFrom).toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        q = q.lt('created_at', end.toISOString());
      }
      const { count, error } = await q;
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Paged page rows
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers-page', searchQuery, dateFrom, dateTo, page],
    queryFn: async () => {
      let q = supabase.from('customers').select('*')
        .order('created_at', { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (searchQuery) q = q.or(`name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
      if (dateFrom) q = q.gte('created_at', new Date(dateFrom).toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        q = q.lt('created_at', end.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    placeholderData: keepPreviousData,
  });

  // Analytics dataset: load a wider sample (up to 1000 most recent of current filter) for charts
  const { data: analyticsSample = [] } = useQuery({
    queryKey: ['customers-analytics-sample', searchQuery, dateFrom, dateTo],
    queryFn: async () => {
      let q = supabase.from('customers').select('*')
        .order('created_at', { ascending: false })
        .range(0, 999);
      if (searchQuery) q = q.or(`name.ilike.%${searchQuery}%,phone.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`);
      if (dateFrom) q = q.gte('created_at', new Date(dateFrom).toISOString());
      if (dateTo) {
        const end = new Date(dateTo);
        end.setDate(end.getDate() + 1);
        q = q.lt('created_at', end.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    staleTime: 60 * 1000,
  });

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const handleOpenDialog = (customer?: any) => {
    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        name: customer.name, phone: customer.phone,
        email: customer.email || "", address: customer.address || "", city: customer.city || "",
      });
    } else {
      setEditingCustomer(null);
      setFormData({ name: "", phone: "", email: "", address: "", city: "" });
    }
    setIsDialogOpen(true);
  };

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['customers-page'] });
    queryClient.invalidateQueries({ queryKey: ['customers-count'] });
    queryClient.invalidateQueries({ queryKey: ['customers-analytics-sample'] });
  };

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from('customers').insert({
        name: data.name, phone: data.phone,
        email: data.email || null, address: data.address || null, city: data.city || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "تمت الإضافة", description: "تم إضافة العميل بنجاح" });
      setIsDialogOpen(false);
    },
    onError: () => { toast({ title: "خطأ", variant: "destructive" }); },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: { id: string; updates: any }) => {
      const { error } = await supabase.from('customers').update(data.updates).eq('id', data.id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "تم التحديث", description: "تم تحديث بيانات العميل بنجاح" });
      setIsDialogOpen(false);
    },
    onError: () => { toast({ title: "خطأ", variant: "destructive" }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customers').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateAll();
      toast({ title: "تم الحذف", description: "تم حذف العميل بنجاح" });
    },
    onError: (e: any) => {
      toast({ title: "خطأ", description: e?.message || "تعذّر حذف العميل (قد يكون لديه طلبات مرتبطة)", variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!formData.name || !formData.phone) {
      toast({ title: "خطأ", description: "يرجى ملء الاسم ورقم الهاتف", variant: "destructive" });
      return;
    }
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, updates: { ...formData, email: formData.email || null, address: formData.address || null, city: formData.city || null } });
    } else {
      createMutation.mutate(formData);
    }
  };

  const hasFilters = useMemo(() => !!(searchQuery || dateFrom || dateTo), [searchQuery, dateFrom, dateTo]);
  const clearFilters = () => { setSearchInput(""); setSearchQuery(""); setDateFrom(""); setDateTo(""); setPage(0); };

  return (
    <DashboardLayout>
      <Header title="العملاء" subtitle="إدارة قاعدة بيانات العملاء" />

      <CustomersAnalytics customers={analyticsSample} totalCount={totalCount} />

      <Card className="glass-card">
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-row items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              قائمة العملاء — الإجمالي: {totalCount.toLocaleString()}
            </CardTitle>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button className="btn-primary" onClick={() => handleOpenDialog()}>
                  <Plus className="w-4 h-4 ml-2" />
                  إضافة عميل
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>{editingCustomer ? "تعديل بيانات العميل" : "إضافة عميل جديد"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>الاسم *</Label>
                    <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="أدخل اسم العميل" className="input-modern" />
                  </div>
                  <div className="space-y-2">
                    <Label>رقم الهاتف *</Label>
                    <Input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} placeholder="01xxxxxxxxx" className="input-modern" />
                  </div>
                  <div className="space-y-2">
                    <Label>المدينة</Label>
                    <Input value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} placeholder="المدينة" className="input-modern" />
                  </div>
                  <div className="space-y-2">
                    <Label>البريد الإلكتروني</Label>
                    <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} placeholder="email@example.com" className="input-modern" />
                  </div>
                  <div className="space-y-2">
                    <Label>العنوان</Label>
                    <Input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} placeholder="أدخل العنوان" className="input-modern" />
                  </div>
                  <Button onClick={handleSubmit} className="w-full btn-primary">
                    {editingCustomer ? "حفظ التعديلات" : "إضافة العميل"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">بحث (اسم / هاتف / بريد)</Label>
              <Input
                placeholder="بحث..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-64 input-modern"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">من تاريخ</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-44 input-modern" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">إلى تاريخ</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-44 input-modern" />
            </div>
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={clearFilters} className="gap-1">
                <X className="w-3 h-3" /> مسح الفلاتر
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : customers.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">لا يوجد عملاء مطابقين</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">العميل</TableHead>
                    <TableHead className="text-right">معلومات التواصل</TableHead>
                    <TableHead className="text-right">المدينة</TableHead>
                    <TableHead className="text-right">عدد الطلبات</TableHead>
                    <TableHead className="text-right">إجمالي الإنفاق</TableHead>
                    <TableHead className="text-right">تاريخ الانضمام</TableHead>
                    <TableHead className="text-right">الإجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer: any) => (
                    <TableRow key={customer.id} className="table-row-hover">
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="font-semibold text-primary">{customer.name.charAt(0)}</span>
                          </div>
                          <span className="font-medium">{customer.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="w-3 h-3 text-muted-foreground" />
                            {customer.phone}
                          </div>
                          {customer.email && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Mail className="w-3 h-3" />
                              {customer.email}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-sm">
                          <MapPin className="w-3 h-3 text-muted-foreground" />
                          {customer.city || "غير محدد"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{customer.total_orders} طلب</Badge>
                      </TableCell>
                      <TableCell className="font-bold">
                        {Number(customer.total_spent).toLocaleString()} ج.م
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(customer.created_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(customer)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          {canDeleteCustomers && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>حذف العميل {customer.name}؟</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    لا يمكن التراجع عن هذا الإجراء. إذا كان للعميل طلبات مرتبطة فلن يتم الحذف.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>إلغاء</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(customer.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                    حذف
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
                <div className="text-sm text-muted-foreground">
                  عرض {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} من {totalCount.toLocaleString()}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
                    <ChevronRight className="w-4 h-4" /> السابق
                  </Button>
                  <span className="text-sm px-2">صفحة {page + 1} / {totalPages}</span>
                  <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
                    التالي <ChevronLeft className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default Customers;
