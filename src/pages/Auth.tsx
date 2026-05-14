import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { getLandingForRole } from '@/constants/roleLandings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { toast } from 'sonner';
import { Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react';
import { z } from 'zod';
import { checkAndReloadIfStale } from '@/lib/updateChecker';
import cocLogo from '@/assets/coc-logo.jpg';

const loginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صالح'),
  password: z.string().min(6, 'كلمة المرور يجب أن تكون 6 أحرف على الأقل'),
});

const Auth = () => {
  const navigate = useNavigate();
  const { user, role, signIn, loading: authLoading } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  useEffect(() => {
    if (user && !authLoading && role !== null) {
      navigate(getLandingForRole(role), { replace: true });
    }
  }, [user, role, authLoading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      loginSchema.parse({ email: loginEmail, password: loginPassword });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    setIsLoading(true);
    const { error } = await signIn(loginEmail, loginPassword);

    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        toast.error('بيانات تسجيل الدخول غير صحيحة');
      } else if (error.message.includes('Email not confirmed')) {
        toast.error('يرجى تأكيد البريد الإلكتروني أولاً');
      } else {
        toast.error('حدث خطأ أثناء تسجيل الدخول');
      }
    } else {
      toast.success('تم تسجيل الدخول بنجاح');
      const willReload = await checkAndReloadIfStale('post-login');
      if (willReload) {
        toast.info('يوجد تحديث جديد — جارٍ إعادة التحميل...');
        return;
      }
    }

    setIsLoading(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-4 relative overflow-hidden" dir="rtl">
      {/* decorative background blobs */}
      <div className="pointer-events-none absolute -top-32 -right-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-orange-500/10 blur-3xl" />

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-8">
          <div className="relative inline-flex items-center justify-center mb-5">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/30 to-orange-500/30 blur-2xl scale-110" />
            <div className="relative w-32 h-32 rounded-3xl bg-white shadow-2xl ring-1 ring-border/40 p-3 flex items-center justify-center">
              <img
                src={cocLogo}
                alt="شعار شركة نعام العاصمة - Capital Ostrich Company"
                className="w-full h-full object-contain"
                draggable={false}
              />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight">شركة نعام العاصمة</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Capital Ostrich Company</p>
          <p className="text-xs text-muted-foreground/80 mt-2">نظام داخلي — الدخول مقيد للموظفين فقط</p>
        </div>

        <Card className="border-border/50 shadow-xl">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <ShieldCheck className="w-4 h-4 text-primary" />
              <span>تسجيل دخول آمن</span>
            </div>
          </CardHeader>

          <CardContent className="pt-4">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">البريد الإلكتروني</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="example@company.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  disabled={isLoading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="login-password">كلمة المرور</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    disabled={isLoading}
                    className="pl-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-primary-foreground"></div>
                ) : (
                  <>
                    <LogIn className="w-4 h-4 ml-2" />
                    تسجيل الدخول
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground pt-2">
                إنشاء الحسابات الجديدة يتم عبر الإدارة فقط.
              </p>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground mt-6">
          © 2024 شركة نعام العاصمة - جميع الحقوق محفوظة
        </p>
      </div>
    </div>
  );
};

export default Auth;
