import { useState } from 'react';
import { Shield } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { changeOwnPassword, confirmPasswordChangeWithCode } from '@/lib/changeOwnPassword';

/**
 * Settings → الأمان. The previous button only toasted "تم الحفظ" and left
 * the Supabase password unchanged. This form verifies the current password
 * and calls auth.updateUser.
 */
const ChangePasswordCard = () => {
  const { toast } = useToast();
  const { user, profile } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const email = user?.email || profile?.email;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const result = needsCode
      ? await confirmPasswordChangeWithCode(supabase, {
          currentPassword,
          newPassword,
          code,
        })
      : await changeOwnPassword(supabase, {
          email,
          currentPassword,
          newPassword,
          confirmPassword,
        });

    setSaving(false);

    if (result.ok === false) {
      setError(result.message);
      if (result.needsCode === true) setNeedsCode(true);
      toast({
        title: 'تعذر تغيير كلمة المرور',
        description: result.message,
        variant: 'destructive',
      });
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setCode('');
    setNeedsCode(false);
    toast({
      title: 'تم تغيير كلمة المرور',
      description: 'استخدم كلمة المرور الجديدة عند تسجيل الدخول القادم.',
    });
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-destructive" />
          الأمان
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6" data-testid="change-password-form">
          <div className="space-y-2">
            <Label htmlFor="settings-current-password">كلمة المرور الحالية</Label>
            <Input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="input-modern"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-new-password">كلمة المرور الجديدة</Label>
            <Input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="input-modern"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-confirm-password">تأكيد كلمة المرور</Label>
            <Input
              id="settings-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="input-modern"
            />
          </div>
          <p className="text-xs text-muted-foreground">٨ حروف على الأقل، فيها حروف وأرقام.</p>

          {needsCode && (
            <div className="space-y-2">
              <Label htmlFor="settings-password-code">رمز التأكيد</Label>
              <Input
                id="settings-password-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="input-modern"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" disabled={saving} className="btn-primary w-full">
            {saving ? 'جاري الحفظ…' : needsCode ? 'تأكيد وتغيير كلمة المرور' : 'تغيير كلمة المرور'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default ChangePasswordCard;
