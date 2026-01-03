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
import { UserPlus, MoreHorizontal, Shield, Search, Users, UserCheck, Warehouse, Calculator, ShoppingCart } from 'lucide-react';
import { z } from 'zod';
import { AppRole } from '@/hooks/useAuth';

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
};

const roleBadgeVariants: Record<AppRole, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  general_manager: 'default',
  executive_manager: 'default',
  sales_manager: 'default',
  sales_moderator: 'secondary',
  accountant: 'outline',
  warehouse_supervisor: 'outline',
};

const roleIcons: Record<AppRole, React.ElementType> = {
  general_manager: Shield,
  executive_manager: UserCheck,
  sales_manager: Users,
  sales_moderator: ShoppingCart,
  accountant: Calculator,
  warehouse_supervisor: Warehouse,
};

const addEmployeeSchema = z.object({
  fullName: z.string().min(2, 'الاسم يجب أن يكون حرفين على الأقل').max(100),
  email: z.string().email('البريد الإلكتروني غير صالح').max(255),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
  role: z.enum(['general_manager', 'executive_manager', 'sales_manager', 'sales_moderator', 'accountant', 'warehouse_supervisor']),
});

const Employees = () => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isAddLoading, setIsAddLoading] = useState(false);
  
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

  const filteredEmployees = employees.filter(emp =>
    emp.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    emp.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const stats = {
    total: employees.length,
    generalManagers: employees.filter(e => e.role === 'general_manager').length,
    executiveManagers: employees.filter(e => e.role === 'executive_manager').length,
    salesModerators: employees.filter(e => e.role === 'sales_moderator').length,
    accountants: employees.filter(e => e.role === 'accountant').length,
    warehouseSupervisors: employees.filter(e => e.role === 'warehouse_supervisor').length,
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground">إدارة الموظفين</h1>
            <p className="text-muted-foreground mt-1">إضافة وتعديل صلاحيات الموظفين</p>
          </div>

          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
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
                    <SelectContent>
                      <SelectItem value="sales_moderator">مودريتور مبيعات</SelectItem>
                      <SelectItem value="accountant">محاسب</SelectItem>
                      <SelectItem value="warehouse_supervisor">مشرف مخازن</SelectItem>
                      <SelectItem value="executive_manager">مدير تنفيذي</SelectItem>
                      <SelectItem value="general_manager">مدير عام</SelectItem>
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

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">الإجمالي</CardTitle>
              <Users className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">مدراء عام</CardTitle>
              <Shield className="w-4 h-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">{stats.generalManagers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">مدراء تنفيذيين</CardTitle>
              <UserCheck className="w-4 h-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-500">{stats.executiveManagers}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">مودريتور مبيعات</CardTitle>
              <ShoppingCart className="w-4 h-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">{stats.salesModerators}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">محاسبين</CardTitle>
              <Calculator className="w-4 h-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-500">{stats.accountants}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">مشرفي مخازن</CardTitle>
              <Warehouse className="w-4 h-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-500">{stats.warehouseSupervisors}</div>
            </CardContent>
          </Card>
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
                          {new Date(employee.created_at).toLocaleDateString('ar-EG')}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem 
                                onClick={() => handleChangeRole(employee.id, 'general_manager')}
                                disabled={employee.role === 'general_manager'}
                              >
                                <Shield className="w-4 h-4 ml-2" />
                                مدير عام
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleChangeRole(employee.id, 'executive_manager')}
                                disabled={employee.role === 'executive_manager'}
                              >
                                <UserCheck className="w-4 h-4 ml-2" />
                                مدير تنفيذي
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleChangeRole(employee.id, 'sales_moderator')}
                                disabled={employee.role === 'sales_moderator'}
                              >
                                <ShoppingCart className="w-4 h-4 ml-2" />
                                مودريتور مبيعات
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleChangeRole(employee.id, 'accountant')}
                                disabled={employee.role === 'accountant'}
                              >
                                <Calculator className="w-4 h-4 ml-2" />
                                محاسب
                              </DropdownMenuItem>
                              <DropdownMenuItem 
                                onClick={() => handleChangeRole(employee.id, 'warehouse_supervisor')}
                                disabled={employee.role === 'warehouse_supervisor'}
                              >
                                <Warehouse className="w-4 h-4 ml-2" />
                                مشرف مخازن
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
      </div>
    </DashboardLayout>
  );
};

export default Employees;
