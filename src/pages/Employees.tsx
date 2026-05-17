import { useState, useEffect } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { UserPlus, MoreHorizontal, Shield, Search, Users, UserCheck, Warehouse, Calculator, ShoppingCart, Trash2, UserMinus, Egg, FlaskConical, Drumstick, Beef, Factory, Wheat, Megaphone, Crown, Building2, Truck, KeyRound, Copy } from 'lucide-react';
import { z } from 'zod';
import { useAuth, AppRole } from '@/hooks/useAuth';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Employee {
  id: string;
  full_name: string;
  email: string;
  role: AppRole;
  created_at: string;
}

const roleLabels: Record<AppRole, string> = {
  general_manager: 'مدير عام',
  executive_manager: 'مدير تنفيذي',
  sales_manager: 'مدير مبيعات',
  sales_moderator: 'مودريتور مبيعات',
  accountant: 'محاسب',
  warehouse_supervisor: 'مشرف مخازن',
  farm_manager: 'مدير المزرعة',
  hatchery_manager: 'مدير المعمل',
  brooding_manager: 'مدير التحضين',
  slaughterhouse_manager: 'مدير المجزر',
  meat_factory_manager: 'مدير مصنع اللحوم',
  feed_factory_manager: 'مدير مصنع الأعلاف',
  hr_manager: 'مدير الموارد البشرية',
  production_manager: 'مدير الإنتاج والتشغيل',
  marketing_sales_manager: 'مدير التسويق والمبيعات',
  financial_manager: 'المدير المالي',
  quality_manager: 'مدير الجودة',
  shipping_company: 'شركة الشحن',
  private_delivery_rep: 'مندوب شحن خاص',
};

const roleBadgeVariants: Record<AppRole, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  general_manager: 'default',
  executive_manager: 'default',
  sales_manager: 'default',
  sales_moderator: 'secondary',
  accountant: 'outline',
  warehouse_supervisor: 'outline',
  farm_manager: 'secondary',
  hatchery_manager: 'secondary',
  brooding_manager: 'secondary',
  slaughterhouse_manager: 'secondary',
  meat_factory_manager: 'secondary',
  feed_factory_manager: 'secondary',
  hr_manager: 'secondary',
  production_manager: 'default',
  marketing_sales_manager: 'default',
  financial_manager: 'default',
  quality_manager: 'default',
  shipping_company: 'outline',
  private_delivery_rep: 'outline',
};

const roleIcons: Record<AppRole, React.ElementType> = {
  general_manager: Shield,
  executive_manager: UserCheck,
  sales_manager: Users,
  sales_moderator: ShoppingCart,
  accountant: Calculator,
  warehouse_supervisor: Warehouse,
  farm_manager: Users,
  hatchery_manager: Users,
  brooding_manager: Users,
  slaughterhouse_manager: Users,
  meat_factory_manager: Users,
  feed_factory_manager: Users,
  hr_manager: Users,
  production_manager: UserCheck,
  marketing_sales_manager: Users,
  financial_manager: Calculator,
  quality_manager: Shield,
  shipping_company: Truck,
  private_delivery_rep: Truck,
};

const addEmployeeSchema = z.object({
  fullName: z.string().min(2, 'الاسم يجب أن يكون حرفين على الأقل').max(100),
  email: z.string().email('البريد الإلكتروني غير صالح').max(255),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  role: z.enum(['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor', 'farm_manager', 'hatchery_manager', 'brooding_manager', 'slaughterhouse_manager', 'meat_factory_manager', 'feed_factory_manager', 'hr_manager', 'production_manager', 'marketing_sales_manager', 'financial_manager', 'quality_manager', 'shipping_company', 'private_delivery_rep']),
});

const Employees = () => {
  const { isGeneralManager, user } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddLoading, setIsAddLoading] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [employeeToDelete, setEmployeeToDelete] = useState<Employee | null>(null);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  // Custom password reset dialog
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<Employee | null>(null);
  const [customPassword, setCustomPassword] = useState('');
  const [isResetLoading, setIsResetLoading] = useState(false);
  
  // Add employee form
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<AppRole>('sales_moderator');

  const fetchEmployees = async () => {
    try {
      // Fetch profiles with their roles
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, full_name, email, created_at');

      if (profilesError) throw profilesError;

      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      const employeeList: Employee[] = (profiles || []).map(profile => {
        const userRole = roles?.find(r => r.user_id === profile.id);
        return {
          id: profile.id,
          full_name: profile.full_name,
          email: profile.email,
          role: (userRole?.role as AppRole) || 'sales_moderator',
          created_at: profile.created_at,
        };
      });

      setEmployees(employeeList);
    } catch (error) {
      console.error('Error fetching employees:', error);
      toast.error('حدث خطأ أثناء جلب بيانات الموظفين');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const handleAddEmployee = async () => {
    try {
      addEmployeeSchema.parse({
        fullName: newFullName,
        email: newEmail,
        password: newPassword,
        role: newRole,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    setIsAddLoading(true);

    try {
      // Create user via Supabase Auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: {
          data: {
            full_name: newFullName,
          },
        },
      });

      if (authError) throw authError;

      if (authData.user && newRole !== 'sales_moderator') {
        // Update role if not default sales_moderator
        const { error: roleError } = await supabase
          .from('user_roles')
          .update({ role: newRole })
          .eq('user_id', authData.user.id);

        if (roleError) throw roleError;
      }

      toast.success('تم إضافة الموظف بنجاح');
      setIsAddDialogOpen(false);
      resetForm();
      fetchEmployees();
    } catch (error: any) {
      if (error.message?.includes('User already registered')) {
        toast.error('هذا البريد الإلكتروني مسجل بالفعل');
      } else {
        toast.error('حدث خطأ أثناء إضافة الموظف');
      }
    } finally {
      setIsAddLoading(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: AppRole) => {
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', userId);

      if (error) throw error;

      toast.success('تم تحديث الصلاحية بنجاح');
      fetchEmployees();
    } catch (error) {
      console.error('Error updating role:', error);
      toast.error('حدث خطأ أثناء تحديث الصلاحية');
    }
  };

  const resetForm = () => {
    setNewFullName('');
    setNewEmail('');
    setNewPassword('');
    setNewRole('sales_moderator');
  };

  const handleDeleteEmployee = async () => {
    if (!employeeToDelete) return;
    
    setIsDeleteLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('يجب تسجيل الدخول أولاً');
        return;
      }

      const response = await supabase.functions.invoke('delete-user', {
        body: { userId: employeeToDelete.id },
      });

      if (response.error) {
        throw new Error(response.error.message || 'فشل في حذف الموظف');
      }

      toast.success('تم حذف الموظف بنجاح');
      setIsDeleteDialogOpen(false);
      setEmployeeToDelete(null);
      fetchEmployees();
    } catch (error: any) {
      console.error('Error deleting employee:', error);
      toast.error(error.message || 'حدث خطأ أثناء حذف الموظف');
    } finally {
      setIsDeleteLoading(false);
    }
  };

  const openDeleteDialog = (employee: Employee) => {
    setEmployeeToDelete(employee);
    setIsDeleteDialogOpen(true);
  };

  const generateStrongPassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%&*';
    const all = upper + lower + digits + symbols;
    const pick = (s: string) => s[Math.floor(Math.random() * s.length)];
    let pwd = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
    for (let i = 0; i < 8; i++) pwd += pick(all);
    return pwd.split('').sort(() => Math.random() - 0.5).join('');
  };

  const performReset = async (employee: Employee, newPwd: string) => {
    const tId = toast.loading(`جاري إعادة تعيين كلمة مرور ${employee.full_name}...`);
    try {
      const { data, error } = await supabase.functions.invoke('reset-password', {
        body: { userId: employee.id, newPassword: newPwd },
      });

      // Surface real backend error (e.g. weak/leaked password)
      let backendMsg: string | null = null;
      if (error && (error as any).context?.json) {
        try {
          const j = await (error as any).context.json();
          backendMsg = j?.error || null;
        } catch { /* ignore */ }
      } else if (data && (data as any).error) {
        backendMsg = (data as any).error;
      }

      if (error || backendMsg) {
        const msg = backendMsg || error?.message || 'فشل إعادة تعيين كلمة المرور';
        const friendly = /weak|known|pwned|guess/i.test(msg)
          ? 'كلمة المرور ضعيفة أو مسرّبة. اختر كلمة أقوى (أحرف كبيرة + صغيرة + أرقام + رموز، ولا تكن شائعة).'
          : msg;
        toast.error(friendly, { id: tId });
        return false;
      }

      const credentials = `بيانات الدخول - ${employee.full_name}\nالوظيفة: ${roleLabels[employee.role]}\nالبريد: ${employee.email}\nكلمة المرور: ${newPwd}`;
      try {
        await navigator.clipboard.writeText(credentials);
        toast.success('تم إعادة التعيين ونسخ البيانات إلى الحافظة', { id: tId });
      } catch {
        toast.success('تم إعادة التعيين بنجاح', { id: tId, description: credentials, duration: 30000 });
      }
      return true;
    } catch (err: any) {
      console.error('reset-password error', err);
      toast.error(err?.message || 'فشل إعادة تعيين كلمة المرور', { id: tId });
      return false;
    }
  };

  const handleResetAndCopy = async (employee: Employee) => {
    if (!isGeneralManager) {
      toast.error('هذا الإجراء متاح للمدير العام فقط');
      return;
    }
    await performReset(employee, generateStrongPassword());
  };

  const openCustomResetDialog = (employee: Employee) => {
    if (!isGeneralManager) {
      toast.error('هذا الإجراء متاح للمدير العام فقط');
      return;
    }
    setResetTarget(employee);
    setCustomPassword('');
    setIsResetDialogOpen(true);
  };

  const handleCustomReset = async () => {
    if (!resetTarget) return;
    if (customPassword.length < 8) {
      toast.error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    setIsResetLoading(true);
    const ok = await performReset(resetTarget, customPassword);
    setIsResetLoading(false);
    if (ok) {
      setIsResetDialogOpen(false);
      setResetTarget(null);
      setCustomPassword('');
    }
  };

  const filteredEmployees = employees.filter(emp =>
    emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const countByRoles = (roles: AppRole[]) =>
    employees.filter((e) => roles.includes(e.role)).length;

  const departments: {
    key: string;
    name: string;
    icon: React.ElementType;
    color: string;
    bg: string;
    roles: AppRole[];
  }[] = [
    {
      key: 'leadership',
      name: 'الإدارة العليا',
      icon: Crown,
      color: 'text-amber-600',
      bg: 'bg-amber-500/10',
      roles: ['general_manager', 'executive_manager', 'production_manager', 'financial_manager', 'quality_manager'],
    },
    {
      key: 'sales',
      name: 'التسويق والمبيعات',
      icon: Megaphone,
      color: 'text-primary',
      bg: 'bg-primary/10',
      roles: ['marketing_sales_manager', 'sales_manager', 'sales_moderator', 'accountant'],
    },
    {
      key: 'farm',
      name: 'مزرعة الأمهات والإنتاج',
      icon: Egg,
      color: 'text-orange-500',
      bg: 'bg-orange-500/10',
      roles: ['farm_manager'],
    },
    {
      key: 'hatchery',
      name: 'المعمل وتفريغ الكتاكيت',
      icon: FlaskConical,
      color: 'text-cyan-500',
      bg: 'bg-cyan-500/10',
      roles: ['hatchery_manager'],
    },
    {
      key: 'brooding',
      name: 'التحضين والتسمين',
      icon: Drumstick,
      color: 'text-yellow-600',
      bg: 'bg-yellow-500/10',
      roles: ['brooding_manager'],
    },
    {
      key: 'slaughter',
      name: 'المجزر وإنتاج اللحوم',
      icon: Beef,
      color: 'text-red-500',
      bg: 'bg-red-500/10',
      roles: ['slaughterhouse_manager'],
    },
    {
      key: 'meat',
      name: 'مصنع اللحوم',
      icon: Factory,
      color: 'text-rose-600',
      bg: 'bg-rose-500/10',
      roles: ['meat_factory_manager'],
    },
    {
      key: 'feed_hr',
      name: 'مصنع الأعلاف والموارد البشرية',
      icon: Wheat,
      color: 'text-green-600',
      bg: 'bg-green-500/10',
      roles: ['feed_factory_manager', 'hr_manager'],
    },
    {
      key: 'warehouses',
      name: 'المخازن',
      icon: Warehouse,
      color: 'text-purple-600',
      bg: 'bg-purple-500/10',
      roles: ['warehouse_supervisor'],
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">إدارة الموظفين</h1>
            <p className="text-muted-foreground mt-1">إضافة وتعديل صلاحيات الموظفين</p>
          </div>

          <div className="flex gap-2">
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2" disabled={!isGeneralManager}>
                  <UserPlus className="w-4 h-4" />
                  إضافة موظف
                </Button>
              </DialogTrigger>
            <DialogContent className="sm:max-w-md" dir="rtl">
              <DialogHeader>
                <DialogTitle>إضافة موظف جديد</DialogTitle>
                <DialogDescription>
                  أدخل بيانات الموظف الجديد وحدد صلاحياته
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="fullName">الاسم الكامل</Label>
                  <Input
                    id="fullName"
                    placeholder="محمد أحمد"
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">البريد الإلكتروني</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="employee@company.com"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">كلمة المرور</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="role">الوظيفة</Label>
                  <Select value={newRole} onValueChange={(value: AppRole) => setNewRole(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      <SelectItem value="general_manager">مدير عام</SelectItem>
                      <SelectItem value="executive_manager">مدير تنفيذي</SelectItem>
                      <SelectItem value="production_manager">مدير الإنتاج والتشغيل</SelectItem>
                      <SelectItem value="marketing_sales_manager">مدير التسويق والمبيعات</SelectItem>
                      <SelectItem value="financial_manager">المدير المالي</SelectItem>
                      <SelectItem value="quality_manager">مدير الجودة</SelectItem>
                      <SelectItem value="sales_manager">مدير مبيعات</SelectItem>
                      <SelectItem value="sales_moderator">مودريتور مبيعات</SelectItem>
                      <SelectItem value="accountant">محاسب</SelectItem>
                      <SelectItem value="warehouse_supervisor">مشرف مخازن</SelectItem>
                      <SelectItem value="farm_manager">مدير المزرعة</SelectItem>
                      <SelectItem value="hatchery_manager">مدير المعمل</SelectItem>
                      <SelectItem value="brooding_manager">مدير التحضين</SelectItem>
                      <SelectItem value="slaughterhouse_manager">مدير المجزر</SelectItem>
                      <SelectItem value="meat_factory_manager">مدير مصنع اللحوم</SelectItem>
                      <SelectItem value="feed_factory_manager">مدير مصنع الأعلاف</SelectItem>
                      <SelectItem value="hr_manager">مدير الموارد البشرية</SelectItem>
                      <SelectItem value="shipping_company">شركة الشحن</SelectItem>
                      <SelectItem value="private_delivery_rep">مندوب شحن خاص</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  إلغاء
                </Button>
                <Button onClick={handleAddEmployee} disabled={isAddLoading}>
                  {isAddLoading ? 'جاري الإضافة...' : 'إضافة'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Total Card */}
        <Card className="bg-gradient-to-l from-primary/10 to-secondary/10 border-primary/20">
          <CardContent className="flex items-center justify-between p-6">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center">
                <Building2 className="w-7 h-7 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">إجمالي موظفي شركة نعام العاصمة</p>
                <h2 className="text-2xl font-bold text-foreground">{employees.length} موظف</h2>
              </div>
            </div>
            <Badge variant="secondary" className="text-sm">
              {departments.length} قسم
            </Badge>
          </CardContent>
        </Card>

        {/* Departments Grid */}
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            أقسام الشركة
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {departments.map((dept) => {
              const Icon = dept.icon;
              const count = countByRoles(dept.roles);
              return (
                <Card
                  key={dept.key}
                  className="hover:shadow-md transition-all hover:-translate-y-0.5 cursor-default"
                >
                  <CardContent className="p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <div className={`w-11 h-11 rounded-xl ${dept.bg} flex items-center justify-center`}>
                        <Icon className={`w-5 h-5 ${dept.color}`} />
                      </div>
                      <div className="text-2xl font-bold text-foreground">{count}</div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground leading-tight">{dept.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {count === 0 ? 'لا يوجد موظفون' : count === 1 ? 'موظف واحد' : `${count} موظفين`}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Search */}
        <div className="relative max-w-md">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث عن موظف..."
            className="pr-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Employees Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الموظف</TableHead>
                  <TableHead className="text-right">البريد الإلكتروني</TableHead>
                  <TableHead className="text-right">الوظيفة</TableHead>
                  <TableHead className="text-right">تاريخ الانضمام</TableHead>
                  <TableHead className="text-right">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto"></div>
                    </TableCell>
                  </TableRow>
                ) : filteredEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      لا يوجد موظفون
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEmployees.map((employee) => {
                    const RoleIcon = roleIcons[employee.role];
                    return (
                      <TableRow key={employee.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                              {employee.full_name.charAt(0)}
                            </div>
                            <span className="font-medium">{employee.full_name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{employee.email}</TableCell>
                        <TableCell>
                          <Badge variant={roleBadgeVariants[employee.role]} className="gap-1">
                            <RoleIcon className="w-3 h-3" />
                            {roleLabels[employee.role]}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(employee.created_at).toLocaleDateString('en-GB')}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
                              {(Object.keys(roleLabels) as AppRole[]).map((r) => {
                                const Icon = roleIcons[r];
                                return (
                                  <DropdownMenuItem
                                    key={r}
                                    onClick={() => handleChangeRole(employee.id, r)}
                                    disabled={employee.role === r}
                                  >
                                    <Icon className="w-4 h-4 ml-2" />
                                    {roleLabels[r]}
                                  </DropdownMenuItem>
                                );
                              })}
                              <div className="my-1 border-t border-border" />
                              <DropdownMenuItem
                                onClick={() => handleResetAndCopy(employee)}
                                disabled={!isGeneralManager}
                              >
                                <KeyRound className="w-4 h-4 ml-2" />
                                إعادة تعيين ونسخ بيانات الدخول
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => openCustomResetDialog(employee)}
                                disabled={!isGeneralManager}
                              >
                                <KeyRound className="w-4 h-4 ml-2" />
                                تعيين كلمة مرور مخصصة
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => openDeleteDialog(employee)}
                                className="text-destructive focus:text-destructive"
                                disabled={!isGeneralManager || employee.id === user?.id}
                              >
                                <Trash2 className="w-4 h-4 ml-2" />
                                حذف الموظف {!isGeneralManager ? '(للمدير العام فقط)' : ''}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Custom Password Reset Dialog */}
        <Dialog open={isResetDialogOpen} onOpenChange={setIsResetDialogOpen}>
          <DialogContent className="sm:max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle>تعيين كلمة مرور مخصصة</DialogTitle>
              <DialogDescription>
                {resetTarget && (
                  <>أدخل كلمة المرور الجديدة للموظف <span className="font-semibold">{resetTarget.full_name}</span> ({resetTarget.email})</>
                )}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-4">
              <Label htmlFor="customPwd">كلمة المرور الجديدة</Label>
              <Input
                id="customPwd"
                type="text"
                placeholder="8 أحرف على الأقل"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                ستتم إعادة التعيين فوراً ونسخ البريد + كلمة المرور إلى الحافظة.
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsResetDialogOpen(false)} disabled={isResetLoading}>
                إلغاء
              </Button>
              <Button onClick={handleCustomReset} disabled={isResetLoading || customPassword.length < 8}>
                {isResetLoading ? 'جاري الحفظ...' : 'تعيين ونسخ'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent dir="rtl">
            <AlertDialogHeader>
              <AlertDialogTitle>حذف الموظف</AlertDialogTitle>
              <AlertDialogDescription>
                هل أنت متأكد من حذف الموظف "{employeeToDelete?.full_name}"؟ 
                <br />
                <span className="text-destructive font-medium">هذا الإجراء لا يمكن التراجع عنه.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-row-reverse gap-2">
              <AlertDialogCancel disabled={isDeleteLoading}>إلغاء</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteEmployee}
                disabled={isDeleteLoading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeleteLoading ? 'جاري الحذف...' : 'حذف'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </DashboardLayout>
  );
};

export default Employees;
