import { useState, useEffect } from 'react';
import { cairoMonthStartUTC, cairoYearStartUTC, currentCairoYearMonth, toCairoDateString } from '@/lib/cairoDate';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Header from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import {
  Users,
  TrendingUp,
  ShoppingCart,
  DollarSign,
  UserPlus,
  UserMinus,
  Target,
  Download,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { formatDate } from "@/lib/dateFormat";

interface TeamMember {
  id: string;
  full_name: string;
  ordersCount: number;
  totalSales: number;
  deliveredOrders: number;
  pendingOrders: number;
}

interface AvailableModerator {
  id: string;
  full_name: string;
}

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--secondary))',
  'hsl(var(--success))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

const TeamPerformance = () => {
  const { user, isGeneralManager, isSalesManager } = useAuth();
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [availableModerators, setAvailableModerators] = useState<AvailableModerator[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('month');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedModerator, setSelectedModerator] = useState<string>('');

  const fetchTeamData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Get team assignments. General manager sees ALL teams; others see their own team.
      const assignmentsQuery = supabase.from('team_assignments').select('moderator_id');
      const { data: assignments, error: assignError } = isGeneralManager
        ? await assignmentsQuery
        : await assignmentsQuery.eq('manager_id', user.id);

      if (assignError) throw assignError;

      const moderatorIds = assignments?.map(a => a.moderator_id) || [];

      if (moderatorIds.length === 0) {
        setTeamMembers([]);
        setLoading(false);
        return;
      }

      // Get profiles for team members
      const { data: profiles, error: profileError } = await supabase
        .from('profile_directory')
        .select('id, full_name')
        .in('id', moderatorIds);

      if (profileError) throw profileError;

      // Get date range based on period (محسوب بتوقيت القاهرة)
      const now = new Date();
      const { year: cy, monthIndex0: cm } = currentCairoYearMonth(now);
      let startDate: Date;
      switch (period) {
        case 'week':
          startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          startDate = cairoMonthStartUTC(cy, cm);
          break;
        case 'quarter':
          startDate = cairoMonthStartUTC(cy, Math.floor(cm / 3) * 3);
          break;
        case 'year':
          startDate = cairoYearStartUTC(cy);
          break;
        default:
          startDate = cairoMonthStartUTC(cy, cm);
      }

      // Get orders for team members
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('created_by, total, status')
        .in('created_by', moderatorIds)
        .gte('created_at', startDate.toISOString());

      if (ordersError) throw ordersError;

      // Calculate metrics per team member
      const membersWithMetrics: TeamMember[] = (profiles || []).map(profile => {
        const memberOrders = orders?.filter(o => o.created_by === profile.id) || [];
        return {
          id: profile.id,
          full_name: profile.full_name,
          ordersCount: memberOrders.length,
          totalSales: memberOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0),
          deliveredOrders: memberOrders.filter(o => o.status === 'delivered').length,
          pendingOrders: memberOrders.filter(o => o.status === 'pending' || o.status === 'processing').length,
        };
      });

      setTeamMembers(membersWithMetrics);
    } catch (error) {
      console.error('Error fetching team data:', error);
      toast.error('حدث خطأ أثناء جلب بيانات الفريق');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableModerators = async () => {
    try {
      // Get all sales moderators
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'sales_moderator');

      if (rolesError) throw rolesError;

      const moderatorUserIds = roles?.map(r => r.user_id) || [];

      if (moderatorUserIds.length === 0) {
        setAvailableModerators([]);
        return;
      }

      // Get already assigned moderators
      const { data: assigned, error: assignedError } = await supabase
        .from('team_assignments')
        .select('moderator_id');

      if (assignedError) throw assignedError;

      const assignedIds = assigned?.map(a => a.moderator_id) || [];
      const unassignedIds = moderatorUserIds.filter(id => !assignedIds.includes(id));

      if (unassignedIds.length === 0) {
        setAvailableModerators([]);
        return;
      }

      // Get profiles for unassigned moderators
      const { data: profiles, error: profileError } = await supabase
        .from('profile_directory')
        .select('id, full_name')
        .in('id', unassignedIds);

      if (profileError) throw profileError;

      setAvailableModerators(profiles || []);
    } catch (error) {
      console.error('Error fetching available moderators:', error);
    }
  };

  useEffect(() => {
    fetchTeamData();
  }, [user, period]);

  useEffect(() => {
    if (isAddDialogOpen) {
      fetchAvailableModerators();
    }
  }, [isAddDialogOpen]);

  const handleAddMember = async () => {
    if (!selectedModerator || !user) return;

    try {
      const { error } = await supabase.from('team_assignments').insert({
        manager_id: user.id,
        moderator_id: selectedModerator,
      });

      if (error) throw error;

      toast.success('تمت إضافة الموظف للفريق بنجاح');
      setIsAddDialogOpen(false);
      setSelectedModerator('');
      fetchTeamData();
    } catch (error) {
      console.error('Error adding team member:', error);
      toast.error('حدث خطأ أثناء إضافة الموظف');
    }
  };

  const handleRemoveMember = async (moderatorId: string) => {
    if (!user) return;

    try {
      const { error } = await supabase
        .from('team_assignments')
        .delete()
        .eq('manager_id', user.id)
        .eq('moderator_id', moderatorId);

      if (error) throw error;

      toast.success('تمت إزالة الموظف من الفريق');
      fetchTeamData();
    } catch (error) {
      console.error('Error removing team member:', error);
      toast.error('حدث خطأ أثناء إزالة الموظف');
    }
  };

  // Calculate summary stats
  const totalOrders = teamMembers.reduce((sum, m) => sum + m.ordersCount, 0);
  const totalSales = teamMembers.reduce((sum, m) => sum + m.totalSales, 0);
  const totalDelivered = teamMembers.reduce((sum, m) => sum + m.deliveredOrders, 0);
  const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  // Chart data
  const performanceChartData = teamMembers.map(m => ({
    name: m.full_name.split(' ')[0],
    orders: m.ordersCount,
    sales: m.totalSales,
  }));

  const orderStatusData = [
    { name: 'تم التوصيل', value: totalDelivered },
    { name: 'قيد التنفيذ', value: teamMembers.reduce((sum, m) => sum + m.pendingOrders, 0) },
  ];

  const periodLabels: Record<string, string> = {
    week: 'هذا الأسبوع',
    month: 'هذا الشهر',
    quarter: 'هذا الربع',
    year: 'هذه السنة',
  };

  const exportToPDF = () => {
    const doc = new jsPDF();
    
    // Add Arabic font support note - jsPDF has limited Arabic support
    // For full Arabic support, you'd need to add custom fonts
    doc.setFont('helvetica');
    
    // Title
    doc.setFontSize(18);
    doc.text('Team Performance Report', 105, 20, { align: 'center' });
    
    doc.setFontSize(12);
    doc.text(`Period: ${periodLabels[period]}`, 105, 30, { align: 'center' });
    doc.text(`Generated: ${formatDate(new Date())}`, 105, 38, { align: 'center' });
    
    // Summary stats
    doc.setFontSize(14);
    doc.text('Summary', 14, 55);
    doc.setFontSize(11);
    doc.text(`Team Members: ${teamMembers.length}`, 14, 65);
    doc.text(`Total Orders: ${totalOrders}`, 14, 72);
    doc.text(`Total Sales: ${totalSales.toLocaleString()} EGP`, 14, 79);
    doc.text(`Average Order Value: ${avgOrderValue.toFixed(0)} EGP`, 14, 86);
    
    // Team performance table
    const tableData = teamMembers.map(member => [
      member.full_name,
      member.ordersCount.toString(),
      `${member.totalSales.toLocaleString()} EGP`,
      member.deliveredOrders.toString(),
      member.pendingOrders.toString(),
    ]);
    
    autoTable(doc, {
      startY: 95,
      head: [['Name', 'Orders', 'Sales', 'Delivered', 'Pending']],
      body: tableData,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [59, 130, 246] },
    });
    
    doc.save(`team-performance-${period}-${new Date().toISOString().split('T')[0]}.pdf`);
    toast.success('تم تصدير التقرير بنجاح');
  };

  const exportToExcel = () => {
    const worksheetData = [
      ['تقرير أداء الفريق'],
      [`الفترة: ${periodLabels[period]}`],
      [`تاريخ التقرير: ${formatDate(new Date())}`],
      [],
      ['ملخص'],
      [`عدد أعضاء الفريق: ${teamMembers.length}`],
      [`إجمالي الطلبات: ${totalOrders}`],
      [`إجمالي المبيعات: ${totalSales.toLocaleString()} ج.م`],
      [`متوسط قيمة الطلب: ${avgOrderValue.toFixed(0)} ج.م`],
      [],
      ['الاسم', 'عدد الطلبات', 'المبيعات', 'تم التوصيل', 'قيد التنفيذ'],
      ...teamMembers.map(member => [
        member.full_name,
        member.ordersCount,
        member.totalSales,
        member.deliveredOrders,
        member.pendingOrders,
      ]),
    ];
    
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // Set column widths
    worksheet['!cols'] = [
      { wch: 25 },
      { wch: 30 },
      { wch: 12 },
      { wch: 15 },
      { wch: 12 },
      { wch: 12 },
    ];
    
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'أداء الفريق');
    
    XLSX.writeFile(workbook, `team-performance-${period}-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('تم تصدير التقرير بنجاح');
  };

  return (
    <DashboardLayout>
      <Header title="أداء الفريق" subtitle="متابعة أداء فريق المبيعات" />

      {/* Controls */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="week">هذا الأسبوع</SelectItem>
              <SelectItem value="month">هذا الشهر</SelectItem>
              <SelectItem value="quarter">هذا الربع</SelectItem>
              <SelectItem value="year">هذه السنة</SelectItem>
            </SelectContent>
          </Select>

          {teamMembers.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Download className="w-4 h-4" />
                  تصدير
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={exportToPDF} className="gap-2 cursor-pointer">
                  <FileText className="w-4 h-4" />
                  تصدير PDF
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportToExcel} className="gap-2 cursor-pointer">
                  <FileSpreadsheet className="w-4 h-4" />
                  تصدير Excel
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="w-4 h-4" />
              إضافة للفريق
            </Button>
          </DialogTrigger>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>إضافة موظف للفريق</DialogTitle>
              <DialogDescription>
                اختر موظف مبيعات لإضافته لفريقك
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              {availableModerators.length === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  لا يوجد موظفون متاحون للإضافة
                </p>
              ) : (
                <Select value={selectedModerator} onValueChange={setSelectedModerator}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر موظف..." />
                  </SelectTrigger>
                  <SelectContent>
                    {availableModerators.map(mod => (
                      <SelectItem key={mod.id} value={mod.id}>
                          {mod.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                إلغاء
              </Button>
              <Button onClick={handleAddMember} disabled={!selectedModerator}>
                إضافة
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card className="stat-card">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <Users className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">أعضاء الفريق</p>
              <p className="text-2xl font-bold">{teamMembers.length}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center">
              <ShoppingCart className="w-6 h-6 text-secondary-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">إجمالي الطلبات</p>
              <p className="text-2xl font-bold">{totalOrders}</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-success flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-success-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">إجمالي المبيعات</p>
              <p className="text-2xl font-bold">{totalSales.toLocaleString()} ج.م</p>
            </div>
          </div>
        </Card>
        <Card className="stat-card">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-chart-4 flex items-center justify-center">
              <Target className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <p className="text-muted-foreground text-sm">متوسط الطلب</p>
              <p className="text-2xl font-bold">{avgOrderValue.toFixed(0)} ج.م</p>
            </div>
          </div>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
        </div>
      ) : teamMembers.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="w-16 h-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">لا يوجد أعضاء في الفريق</h3>
            <p className="text-muted-foreground mb-4">
              أضف موظفي مبيعات لفريقك لمتابعة أدائهم
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} className="gap-2">
              <UserPlus className="w-4 h-4" />
              إضافة موظف
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-primary" />
                  مقارنة الأداء
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={performanceChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.75rem',
                        direction: 'rtl',
                      }}
                    />
                    <Bar dataKey="orders" fill="hsl(var(--primary))" name="الطلبات" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-secondary" />
                  حالة الطلبات
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={orderStatusData.filter(d => d.value > 0)}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {orderStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.75rem',
                        direction: 'rtl',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Team Members Table */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle>تفاصيل أداء الفريق</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-right">الموظف</TableHead>
                    <TableHead className="text-right">عدد الطلبات</TableHead>
                    <TableHead className="text-right">المبيعات</TableHead>
                    <TableHead className="text-right">تم التوصيل</TableHead>
                    <TableHead className="text-right">قيد التنفيذ</TableHead>
                    <TableHead className="text-right">إجراءات</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamMembers.map(member => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                            {member.full_name.charAt(0)}
                          </div>
                          <div>
                            <p className="font-medium">{member.full_name}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{member.ordersCount}</Badge>
                      </TableCell>
                      <TableCell className="font-semibold">
                        {member.totalSales.toLocaleString()} ج.م
                      </TableCell>
                      <TableCell>
                        <Badge variant="default" className="bg-success">
                          {member.deliveredOrders}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{member.pendingOrders}</Badge>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleRemoveMember(member.id)}
                        >
                          <UserMinus className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  );
};

export default TeamPerformance;
