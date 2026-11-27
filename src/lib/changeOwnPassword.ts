import { validateNewPassword } from '@/lib/mustChangePassword';

/** Minimal auth client surface used to change the signed-in user's password. */
export type PasswordChangeClient = {
  auth: {
    signInWithPassword: (credentials: {
      email: string;
      password: string;
    }) => Promise<{ error: AuthErrorLike | null }>;
    updateUser: (attributes: {
      password: string;
      current_password?: string;
      nonce?: string;
    }) => Promise<{ error: AuthErrorLike | null }>;
    reauthenticate: () => Promise<{ error: AuthErrorLike | null }>;
  };
};

export type AuthErrorLike = {
  message: string;
  code?: string;
};

export type ChangeOwnPasswordInput = {
  email: string | null | undefined;
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

export type ChangeOwnPasswordResult =
  | { ok: true }
  | { ok: false; message: string; needsCode?: false }
  | { ok: false; message: string; needsCode: true };

const WRONG_CURRENT = 'كلمة المرور الحالية غير صحيحة';
const MUST_DIFFER = 'كلمة المرور الجديدة يجب أن تختلف عن الحالية';
const NEED_CURRENT = 'أدخل كلمة المرور الحالية';
const NEED_EMAIL = 'الحساب غير مربوط ببريد إلكتروني، لا يمكن تغيير كلمة المرور من هنا';
const NEED_CODE = 'أدخل رمز التأكيد الذي وصل إلى بريدك';
const CODE_SENT = 'أرسلنا رمز تأكيد إلى بريدك. أدخله لإكمال تغيير كلمة المرور.';

/**
 * Local checks only. Returns an Arabic message, or null when the form can be submitted.
 * Does not talk to Supabase.
 */
export const localPasswordChangeError = (input: ChangeOwnPasswordInput): string | null => {
  if (!input.currentPassword) return NEED_CURRENT;
  const rule = validateNewPassword(input.newPassword, input.confirmPassword);
  if (rule) return rule;
  if (input.newPassword === input.currentPassword) return MUST_DIFFER;
  if (!input.email?.trim()) return NEED_EMAIL;
  return null;
};

const isReauthenticationNeeded = (error: AuthErrorLike): boolean => {
  if (error.code === 'reauthentication_needed') return true;
  return /reauthenticat/i.test(error.message);
};

const mapSignInError = (error: AuthErrorLike): string => {
  if (
    error.code === 'invalid_credentials' ||
    /invalid login|invalid credentials/i.test(error.message)
  ) {
    return WRONG_CURRENT;
  }
  return `تعذر التحقق من كلمة المرور الحالية: ${error.message}`;
};

const mapUpdateError = (error: AuthErrorLike): string => {
  if (/different from the old|same password|should be different/i.test(error.message)) {
    return MUST_DIFFER;
  }
  if (/weak|easy to guess|pwned|leaked|known to be/i.test(error.message)) {
    return 'كلمة المرور ضعيفة أو معروفة. اختر كلمة أقوى (حروف كبيرة وصغيرة وأرقام).';
  }
  if (/session/i.test(error.message) && /missing|expired/i.test(error.message)) {
    return 'انتهت الجلسة. سجّل الدخول من جديد ثم أعد المحاولة.';
  }
  return `تعذر تغيير كلمة المرور: ${error.message}`;
};

const applyNewPassword = async (
  client: PasswordChangeClient,
  newPassword: string,
  currentPassword: string,
  nonce?: string,
): Promise<ChangeOwnPasswordResult> => {
  const { error } = await client.auth.updateUser({
    password: newPassword,
    current_password: currentPassword,
    ...(nonce ? { nonce } : {}),
  });
  if (!error) return { ok: true };
  if (isReauthenticationNeeded(error) && !nonce) {
    const { error: sendError } = await client.auth.reauthenticate();
    if (sendError) {
      return { ok: false, message: `تعذر إرسال رمز التأكيد: ${sendError.message}` };
    }
    return { ok: false, needsCode: true, message: CODE_SENT };
  }
  return { ok: false, message: mapUpdateError(error) };
};

/**
 * Verifies the current password (and refreshes the session so Supabase's
 * secure-password-change window is satisfied), then sets the new password.
 * When the project still requires an email nonce, returns needsCode after
 * sending that nonce. No database writes.
 */
export const changeOwnPassword = async (
  client: PasswordChangeClient,
  input: ChangeOwnPasswordInput,
): Promise<ChangeOwnPasswordResult> => {
  const local = localPasswordChangeError(input);
  if (local) return { ok: false, message: local };

  const email = input.email!.trim();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: input.currentPassword,
  });
  if (signInError) return { ok: false, message: mapSignInError(signInError) };

  return applyNewPassword(client, input.newPassword, input.currentPassword);
};

/** Completes a password change after `changeOwnPassword` asked for the email nonce. */
export const confirmPasswordChangeWithCode = async (
  client: PasswordChangeClient,
  input: { currentPassword: string; newPassword: string; code: string },
): Promise<ChangeOwnPasswordResult> => {
  const code = input.code.trim();
  if (!code) return { ok: false, message: NEED_CODE };
  if (!input.newPassword || !input.currentPassword) {
    return { ok: false, message: NEED_CURRENT };
  }
  return applyNewPassword(client, input.newPassword, input.currentPassword, code);
};
