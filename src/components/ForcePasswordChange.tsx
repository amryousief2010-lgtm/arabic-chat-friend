import { useState } from 'react';
import { KeyRound, Eye, EyeOff, LogOut } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MUST_CHANGE_PASSWORD_KEY, validateNewPassword } from '@/lib/mustChangePassword';
import { toast } from 'sonner';

/**
 * Full-screen, blocking "change your password" page shown on first login to
 * users flagged with user_metadata.must_change_password. Nothing else in the
 * app is reachable until the new password is saved (or she signs out).
 * Brand colors: #A4288A → #F37346.
 */
const ForcePasswordChange = () => {
  const { user, profile, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const name = profile?.full_name || (user?.user_metadata?.full_name as string | undefined) || '';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = validateNewPassword(password, confirm);
    setError(msg);
    if (msg) return;
    setSaving(true);
    const { error: upErr } = await supabase.auth.updateUser({
      password,
      data: { [MUST_CHANGE_PASSWORD_KEY]: false },
    });
    setSaving(false);
    if (upErr) {
      const same = /different from the old|same.*password/i.test(upErr.message);
      setError(same ? 'اختاري كلمة سر جديدة غير اللي اتبعتت لك' : `حصلت مشكلة: ${upErr.message}`);
      return;
    }
    // onAuthStateChange(USER_UPDATED) refreshes `user`, which lifts the gate.
    toast.success('تم تغيير كلمة السر بنجاح 🎉');
  };

  return (
    <div
      dir="rtl"
      data-testid="force-password-change"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto p-4"
      style={{ background: 'linear-gradient(135deg, #A4288A 0%, #F37346 100%)' }}
    >
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl space-y-4 text-right"
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-full text-white"
            style={{ background: 'linear-gradient(135deg, #A4288A, #F37346)' }}
          >
            <KeyRound className="h-7 w-7" />
          </div>
          <h1 className="text-xl font-bold" style={{ color: '#A4288A' }}>غيّري كلمة السر</h1>
          <p className="text-sm text-gray-600">
            {name ? `أهلاً ${name} 👋 ` : 'أهلاً 👋 '}
            دي أول مرة تدخلي، اختاري كلمة سر جديدة خاصة بيكي عشان تكملي.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="new-password">كلمة السر الجديدة</Label>
          <div className="relative">
            <Input
              id="new-password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pl-10"
            />
            <button
              type="button"
              aria-label={show ? 'إخفاء' : 'إظهار'}
              onClick={() => setShow((s) => !s)}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500"
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="confirm-password">أكّدي كلمة السر</Label>
          <Input
            id="confirm-password"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <p className="text-xs text-gray-500">٨ حروف على الأقل، فيها حروف وأرقام.</p>

        {error && (
          <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full rounded-lg py-2.5 font-semibold text-white shadow disabled:opacity-60"
          style={{ background: 'linear-gradient(90deg, #A4288A, #F37346)' }}
        >
          {saving ? 'جاري الحفظ…' : 'حفظ كلمة السر والدخول'}
        </button>

        <button
          type="button"
          onClick={() => signOut()}
          className="mx-auto flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
        >
          <LogOut className="h-3 w-3" /> تسجيل الخروج
        </button>
      </form>
    </div>
  );
};

export default ForcePasswordChange;
