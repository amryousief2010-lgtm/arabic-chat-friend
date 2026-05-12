import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Users, Plus, Edit, Phone, Mail, MapPin, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import CustomersAnalytics from "@/components/dashboard/CustomersAnalytics";

const Customers = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const { canDeleteCustomers } = useAuth();

  const [formData, setFormData] = useState({
    name: "", phone: "", email: "", address: "", city: "",
  });

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filteredCustomers = customers.filter(
    (c) => c.name.includes(searchQuery) || c.phone.includes(searchQuery) || (c.email && c.email.includes(searchQuery))
  );

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

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from('customers').insert({
        name: data.name, phone: data.phone,
        email: data.email || null, address: data.address || null, city: data.city || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
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
      queryClient.invalidateQueries({ queryKey: ['customers'] });
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
      queryClient.invalidateQueries({ queryKey: ['customers'] });
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

  return (
    <DashboardLayout>
      <Header title="العملاء" subtitle="إدارة قاعدة بيانات العملاء" />

      <CustomersAnalytics customers={customers} />

      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            قائمة العملاء ({filteredCustomers.length})
          </CardTitle>
          <div className="flex items-center gap-4">
            <Input
              placeholder="بحث عن عميل..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 input-modern"
            />
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
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
          ) : (
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
                {filteredCustomers.map((customer) => (
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
                      {customer.total_spent.toLocaleString()} ج.م
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(customer.created_at).toLocaleDateString('ar-EG')}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(customer)}>
                        <Edit className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </DashboardLayout>
  );
};

export default Customers;
