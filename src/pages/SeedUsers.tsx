import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, X, Loader2, Users, Copy } from 'lucide-react';
import { toast } from 'sonner';

interface TestUser {
  email: string;
  password: string;
  fullName: string;
  role: 'general_manager' | 'executive_manager' | 'sales_manager' | 'sales_moderator' | 'accountant' | 'warehouse_supervisor';
  roleLabel: string;
}

const testUsers: TestUser[] = [
  {
    email: 'general.manager@test.com',
    password: 'Manager@123',
    fullName: 'أحمد محمد - مدير عام',
    role: 'general_manager',
    roleLabel: 'مدير عام'
  },
  {
    email: 'executive.manager@test.com',
    password: 'Executive@123',
    fullName: 'محمود علي - مدير تنفيذي',
    role: 'executive_manager',
    roleLabel: 'مدير تنفيذي'
  },
  {
    email: 'sales.manager@test.com',
    password: 'Sales@123',
    fullName: 'خالد أحمد - مدير مبيعات',
    role: 'sales_manager',
    roleLabel: 'مدير مبيعات'
  },
  {
    email: 'sales.moderator1@test.com',
    password: 'Moderator1@123',
    fullName: 'عمر حسن - مشرف مبيعات 1',
    role: 'sales_moderator',
    roleLabel: 'مشرف مبيعات'
  },
  {
    email: 'sales.moderator2@test.com',
    password: 'Moderator2@123',
    fullName: 'علي سعيد - مشرف مبيعات 2',
    role: 'sales_moderator',
    roleLabel: 'مشرف مبيعات'
  },
  {
    email: 'sales.moderator3@test.com',
    password: 'Moderator3@123',
    fullName: 'حسام كريم - مشرف مبيعات 3',
    role: 'sales_moderator',
    roleLabel: 'مشرف مبيعات'
  },
  {
    email: 'sales.moderator4@test.com',
    password: 'Moderator4@123',
    fullName: 'طارق محمود - مشرف مبيعات 4',
    role: 'sales_moderator',
    roleLabel: 'مشرف مبيعات'
  },
  {
    email: 'accountant@test.com',
    password: 'Account@123',
    fullName: 'يوسف إبراهيم - محاسب',
    role: 'accountant',
    roleLabel: 'محاسب'
  },
  {
    email: 'warehouse@test.com',
    password: 'Warehouse@123',
    fullName: 'سعيد محمود - مشرف مخزن',
    role: 'warehouse_supervisor',
    roleLabel: 'مشرف مخزن'
  }
];

export default function SeedUsers() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<{ email: string; success: boolean; error?: string }[]>([]);
  const [createdUsers, setCreatedUsers] = useState<TestUser[]>([]);

  const createUsers = async () => {
    setLoading(true);
    setResults([]);
    const newResults: { email: string; success: boolean; error?: string }[] = [];
    const successfulUsers: TestUser[] = [];

    for (const user of testUsers) {
      try {
        // Sign up the user
        const { data, error } = await supabase.auth.signUp({
          email: user.email,
          password: user.password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: {
              full_name: user.fullName
            }
          }
        });

        if (error) {
          if (error.message.includes('already registered')) {
            newResults.push({ email: user.email, success: true, error: 'المستخدم موجود مسبقاً' });
          } else {
            newResults.push({ email: user.email, success: false, error: error.message });
          }
          continue;
        }

        if (data.user) {
          // Update the user's role
          const { error: roleError } = await supabase
            .from('user_roles')
            .update({ role: user.role })
            .eq('user_id', data.user.id);

          if (roleError) {
            newResults.push({ email: user.email, success: false, error: roleError.message });
          } else {
            newResults.push({ email: user.email, success: true });
            successfulUsers.push(user);
          }
        }
      } catch (err) {
        newResults.push({ email: user.email, success: false, error: String(err) });
      }
    }

    setResults(newResults);
    setCreatedUsers(successfulUsers);
    setLoading(false);
    
    const successCount = newResults.filter(r => r.success).length;
    toast.success(`تم إنشاء ${successCount} من ${testUsers.length} مستخدم`);
  };

  const copyCredentials = (user: TestUser) => {
    navigator.clipboard.writeText(`Email: ${user.email}\nPassword: ${user.password}`);
    toast.success('تم نسخ بيانات الدخول');
  };

  return (
    <div className="min-h-screen bg-background p-8" dir="rtl">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-6 w-6" />
              إنشاء المستخدمين التجريبيين
            </CardTitle>
            <CardDescription>
              اضغط على الزر أدناه لإنشاء حسابات تجريبية لكل دور في النظام
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={createUsers} disabled={loading} size="lg" className="w-full">
              {loading ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  جاري إنشاء المستخدمين...
                </>
              ) : (
                'إنشاء المستخدمين التجريبيين'
              )}
            </Button>
          </CardContent>
        </Card>

        {results.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>نتائج الإنشاء</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {result.success ? (
                        <Check className="h-5 w-5 text-green-600" />
                      ) : (
                        <X className="h-5 w-5 text-red-600" />
                      )}
                      <span className="font-medium">{result.email}</span>
                    </div>
                    {result.error && (
                      <span className="text-sm text-muted-foreground">{result.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>بيانات دخول المستخدمين</CardTitle>
            <CardDescription>
              استخدم هذه البيانات لتسجيل الدخول بكل دور
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {testUsers.map((user, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{user.fullName}</span>
                      <Badge variant="outline">{user.roleLabel}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground space-y-0.5">
                      <p>البريد: <code className="bg-muted px-1 rounded">{user.email}</code></p>
                      <p>كلمة المرور: <code className="bg-muted px-1 rounded">{user.password}</code></p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => copyCredentials(user)}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
