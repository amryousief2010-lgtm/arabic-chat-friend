import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Target, Plus, TrendingUp, TrendingDown, Award, Users, BarChart3, FileDown } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import MonthlyTargetTable from '@/components/sales/MonthlyTargetTable';
import ModeratorOrdersBreakdown from '@/components/sales/ModeratorOrdersBreakdown';
import GirlsSalesQuantityTable from '@/components/sales/GirlsSalesQuantityTable';
import ModeratorPayrollTable from '@/components/sales/ModeratorPayrollTable';

const months = [
  { value: 1, label: 'يناير' },
  { value: 2, label: 'فبراير' },
  { value: 3, label: 'مارس' },
  { value: 4, label: 'أبريل' },
  { value: 5, label: 'مايو' },
  { value: 6, label: 'يونيو' },
  { value: 7, label: 'يوليو' },
  { value: 8, label: 'أغسطس' },
  { value: 9, label: 'سبتمبر' },
  { value: 10, label: 'أكتوبر' },
  { value: 11, label: 'نوفمبر' },
  { value: 12, label: 'ديسمبر' },
];

const currentYear = new Date().getFullYear();
const currentMonth = new Date().getMonth() + 1;

interface Profile {
  id: string;
  full_name: string;
  email: string;
}

interface SalesTarget {
  id: string;
  user_id: string;
  target_amount: number;
  achieved_amount: number;
  month: number;
  year: number;
  profile?: Profile;
}

const SalesTargets = () => {
  const { toast } = useToast();
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [newTarget, setNewTarget] = useState({
    user_id: '',
    target_amount: '',
    month: currentMonth,
    year: currentYear,
  });

  const isManager = role === 'general_manager' || role === 'executive_manager' || role === 'sales_manager';
  const isModerator = role === 'sales_moderator';

  // Fetch employees (sales moderators)
  const { data: employees = [] } = useQuery({
    queryKey: ['employees-for-targets'],
    queryFn: async () => {
      const { data: userRoles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'sales_moderator');

      if (rolesError) throw rolesError;

      const userIds = userRoles.map(r => r.user_id);
      if (userIds.length === 0) return [];

      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      if (profilesError) throw profilesError;
      return profiles as Profile[];
    },
    enabled: isManager,
  });

  // Fetch targets for selected month/year
  const { data: targets = [], isLoading } = useQuery({
    queryKey: ['sales-targets', selectedMonth, selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_targets')
        .select('*')
        .eq('month', selectedMonth)
        .eq('year', selectedYear);

      if (error) throw error;

      // Fetch profiles for each target
      const userIds = data.map(t => t.user_id);
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from('profiles')
        .select('*')
        .in('id', userIds);

      return data.map(target => ({
        ...target,
        profile: profiles?.find(p => p.id === target.user_id),
      })) as SalesTarget[];
    },
  });

  // Calculate achieved amounts from orders
  const { data: achievedData = [] } = useQuery({
    queryKey: ['achieved-sales', selectedMonth, selectedYear],
    queryFn: async () => {
      // حدود الشهر بـ UTC لتطابق created_at المخزّن للأوردرات
      const startDate = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1, 0, 0, 0));
      const endDate = new Date(Date.UTC(selectedYear, selectedMonth, 0, 23, 59, 59));

      const { data, error } = await supabase
        .from('orders')
        .select('created_by, total')
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString())
        .eq('status', 'delivered');

      if (error) throw error;

      // Aggregate by user
      const aggregated: Record<string, number> = {};
      data.forEach(order => {
        if (order.created_by) {
          aggregated[order.created_by] = (aggregated[order.created_by] || 0) + Number(order.total);
        }
      });

      return Object.entries(aggregated).map(([user_id, total]) => ({ user_id, total }));
    },
  });

  // Merge targets with achieved amounts
  const targetsWithAchieved = targets.map(target => {
    const achieved = achievedData.find(a => a.user_id === target.user_id);
    return {
      ...target,
      achieved_amount: achieved?.total || 0,
    };
  });

  const createTargetMutation = useMutation({
    mutationFn: async (data: typeof newTarget) => {
      const { error } = await supabase.from('sales_targets').insert({
        user_id: data.user_id,
        target_amount: Number(data.target_amount),
        month: data.month,
        year: data.year,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-targets'] });
      toast({ title: 'تم إضافة الهدف بنجاح' });
      setIsDialogOpen(false);
      setNewTarget({ user_id: '', target_amount: '', month: currentMonth, year: currentYear });
    },
    onError: (error: any) => {
      if (error.message?.includes('duplicate')) {
        toast({ title: 'هذا الموظف لديه هدف بالفعل لهذا الشهر', variant: 'destructive' });
      } else {
        toast({ title: 'حدث خطأ', variant: 'destructive' });
      }
    },
  });

  const deleteTargetMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('sales_targets').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-targets'] });
      toast({ title: 'تم حذف الهدف' });
    },
  });

  const getProgressColor = (percentage: number) => {
    if (percentage >= 100) return 'bg-green-500';
    if (percentage >= 75) return 'bg-blue-500';
    if (percentage >= 50) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const totalTarget = targetsWithAchieved.reduce((sum, t) => sum + Number(t.target_amount), 0);
  const totalAchieved = targetsWithAchieved.reduce((sum, t) => sum + t.achieved_amount, 0);
  const overallPercentage = totalTarget > 0 ? (totalAchieved / totalTarget) * 100 : 0;
  const achievedCount = targetsWithAchieved.filter(t => t.achieved_amount >= Number(t.target_amount)).length;

  const exportToPDF = () => {
    const doc = new jsPDF();
    const monthName = months.find(m => m.value === selectedMonth)?.label || '';
    
    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`Sales Performance Report - ${monthName} ${selectedYear}`, 105, 20, { align: 'center' });
    
    // Summary section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(`Total Target: ${totalTarget.toLocaleString()} SAR`, 20, 40);
    doc.text(`Total Achieved: ${totalAchieved.toLocaleString()} SAR`, 20, 50);
    doc.text(`Achievement Rate: ${overallPercentage.toFixed(1)}%`, 20, 60);
    doc.text(`Employees who achieved target: ${achievedCount} / ${targetsWithAchieved.length}`, 20, 70);
    
    // Table
    const tableData = targetsWithAchieved.map(target => {
      const percentage = Number(target.target_amount) > 0
        ? (target.achieved_amount / Number(target.target_amount)) * 100
        : 0;
      return [
        target.profile?.full_name || 'Unknown',
        `${Number(target.target_amount).toLocaleString()} SAR`,
        `${target.achieved_amount.toLocaleString()} SAR`,
        `${percentage.toFixed(1)}%`,
        percentage >= 100 ? 'Achieved' : 'In Progress'
      ];
    });

    autoTable(doc, {
      startY: 85,
      head: [['Employee', 'Target', 'Achieved', 'Percentage', 'Status']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246] },
      styles: { halign: 'center' },
    });

    doc.save(`performance-report-${monthName}-${selectedYear}.pdf`);
    toast({ title: 'تم تصدير التقرير بنجاح' });
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {!isModerator && <MonthlyTargetTable />}
        {!isModerator && <ModeratorOrdersBreakdown />}
        {!isModerator && <GirlsSalesQuantityTable />}
        {!isModerator && <ModeratorPayrollTable />}
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Target className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">أهداف المبيعات</h1>
              <p className="text-muted-foreground">متابعة أهداف المبيعات الشهرية</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Select
              value={selectedMonth.toString()}
              onValueChange={(v) => setSelectedMonth(Number(v))}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m.value} value={m.value.toString()}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedYear.toString()}
              onValueChange={(v) => setSelectedYear(Number(v))}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {targetsWithAchieved.length > 0 && (
              <Button variant="outline" onClick={exportToPDF}>
                <FileDown className="h-4 w-4 ml-2" />
                تصدير PDF
              </Button>
            )}
            {isManager && (
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 ml-2" />
                    إضافة هدف
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>إضافة هدف مبيعات جديد</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 pt-4">
                    <div className="space-y-2">
                      <Label>الموظف</Label>
                      <Select
                        value={newTarget.user_id}
                        onValueChange={(v) => setNewTarget({ ...newTarget, user_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="اختر الموظف" />
                        </SelectTrigger>
                        <SelectContent>
                          {employees.map((emp) => (
                            <SelectItem key={emp.id} value={emp.id}>
                              {emp.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>المبلغ المستهدف (ر.س)</Label>
                      <Input
                        type="number"
                        value={newTarget.target_amount}
                        onChange={(e) => setNewTarget({ ...newTarget, target_amount: e.target.value })}
                        placeholder="0"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>الشهر</Label>
                        <Select
                          value={newTarget.month.toString()}
                          onValueChange={(v) => setNewTarget({ ...newTarget, month: Number(v) })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {months.map((m) => (
                              <SelectItem key={m.value} value={m.value.toString()}>
                                {m.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>السنة</Label>
                        <Select
                          value={newTarget.year.toString()}
                          onValueChange={(v) => setNewTarget({ ...newTarget, year: Number(v) })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                              <SelectItem key={y} value={y.toString()}>
                                {y}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => createTargetMutation.mutate(newTarget)}
                      disabled={!newTarget.user_id || !newTarget.target_amount}
                    >
                      إضافة الهدف
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-primary/10">
                  <Target className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي الأهداف</p>
                  <p className="text-2xl font-bold">{totalTarget.toLocaleString()} ر.س</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-green-500/10">
                  <TrendingUp className="h-6 w-6 text-green-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">إجمالي المحقق</p>
                  <p className="text-2xl font-bold">{totalAchieved.toLocaleString()} ر.س</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-full ${overallPercentage >= 100 ? 'bg-green-500/10' : 'bg-yellow-500/10'}`}>
                  {overallPercentage >= 100 ? (
                    <TrendingUp className="h-6 w-6 text-green-500" />
                  ) : (
                    <TrendingDown className="h-6 w-6 text-yellow-500" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">نسبة التحقيق</p>
                  <p className="text-2xl font-bold">{overallPercentage.toFixed(1)}%</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="p-3 rounded-full bg-amber-500/10">
                  <Award className="h-6 w-6 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">حققوا الهدف</p>
                  <p className="text-2xl font-bold">{achievedCount} / {targetsWithAchieved.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Performance Chart */}
        {targetsWithAchieved.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                مقارنة أداء الموظفين
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={targetsWithAchieved.map(t => ({
                      name: t.profile?.full_name || 'غير معروف',
                      الهدف: Number(t.target_amount),
                      المحقق: t.achieved_amount,
                      percentage: Number(t.target_amount) > 0 
                        ? (t.achieved_amount / Number(t.target_amount)) * 100 
                        : 0,
                    }))}
                    layout="vertical"
                    margin={{ top: 20, right: 30, left: 100, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis dataKey="name" type="category" width={90} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value: number) => [`${value.toLocaleString()} ر.س`, '']}
                      labelFormatter={(label) => label}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        direction: 'rtl'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="الهدف" fill="hsl(var(--muted-foreground))" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="المحقق" radius={[0, 4, 4, 0]}>
                      {targetsWithAchieved.map((entry, index) => {
                        const percentage = Number(entry.target_amount) > 0 
                          ? (entry.achieved_amount / Number(entry.target_amount)) * 100 
                          : 0;
                        let fill = 'hsl(0, 84%, 60%)'; // red
                        if (percentage >= 100) fill = 'hsl(142, 71%, 45%)'; // green
                        else if (percentage >= 75) fill = 'hsl(217, 91%, 60%)'; // blue
                        else if (percentage >= 50) fill = 'hsl(45, 93%, 47%)'; // yellow
                        return <Cell key={`cell-${index}`} fill={fill} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-6 mt-4 text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500" />
                  <span>100%+ محقق</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span>75-99%</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-yellow-500" />
                  <span>50-74%</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span>أقل من 50%</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Targets Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              أهداف الموظفين - {months.find(m => m.value === selectedMonth)?.label} {selectedYear}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
            ) : targetsWithAchieved.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>لا توجد أهداف لهذا الشهر</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الموظف</TableHead>
                    <TableHead>الهدف</TableHead>
                    <TableHead>المحقق</TableHead>
                    <TableHead>النسبة</TableHead>
                    <TableHead>التقدم</TableHead>
                    <TableHead>الحالة</TableHead>
                    {isManager && <TableHead>إجراءات</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {targetsWithAchieved.map((target) => {
                    const percentage = Number(target.target_amount) > 0
                      ? (target.achieved_amount / Number(target.target_amount)) * 100
                      : 0;
                    const isAchieved = percentage >= 100;

                    return (
                      <TableRow key={target.id}>
                        <TableCell className="font-medium">
                          {target.profile?.full_name || 'غير معروف'}
                        </TableCell>
                        <TableCell>{Number(target.target_amount).toLocaleString()} ر.س</TableCell>
                        <TableCell>{target.achieved_amount.toLocaleString()} ر.س</TableCell>
                        <TableCell>{percentage.toFixed(1)}%</TableCell>
                        <TableCell className="w-40">
                          <Progress 
                            value={Math.min(percentage, 100)} 
                            className={`h-2 ${getProgressColor(percentage)}`}
                          />
                        </TableCell>
                        <TableCell>
                          {isAchieved ? (
                            <Badge className="bg-green-500">محقق</Badge>
                          ) : percentage >= 75 ? (
                            <Badge className="bg-blue-500">قريب</Badge>
                          ) : percentage >= 50 ? (
                            <Badge className="bg-yellow-500">متوسط</Badge>
                          ) : (
                            <Badge variant="destructive">بعيد</Badge>
                          )}
                        </TableCell>
                        {isManager && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => deleteTargetMutation.mutate(target.id)}
                            >
                              حذف
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default SalesTargets;