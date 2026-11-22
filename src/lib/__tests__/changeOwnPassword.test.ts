import { describe, it, expect, vi, beforeEach } from 'vitest';
import { changeOwnPassword, confirmPasswordChangeWithCode, type PasswordChangeClient } from '@/lib/changeOwnPassword';

const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const reauthenticate = vi.fn();

const client = {
  auth: { signInWithPassword, updateUser, reauthenticate },
} as PasswordChangeClient;

const valid = {
  email: 'soha@coceg.net',
  currentPassword: 'OldPass2026',
  newPassword: 'NewPass2026',
  confirmPassword: 'NewPass2026',
};

describe('changeOwnPassword', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    updateUser.mockReset();
    reauthenticate.mockReset();
    signInWithPassword.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ error: null });
    reauthenticate.mockResolvedValue({ error: null });
  });

  it('rejects an empty current password without calling auth', async () => {
    const result = await changeOwnPassword(client, { ...valid, currentPassword: '' });
    expect(result).toEqual({ ok: false, message: 'أدخل كلمة المرور الحالية' });
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('rejects a weak or mismatched new password without calling auth', async () => {
    const weak = await changeOwnPassword(client, { ...valid, newPassword: 'short1', confirmPassword: 'short1' });
    expect(weak.ok).toBe(false);
    const mismatch = await changeOwnPassword(client, { ...valid, confirmPassword: 'NewPass2027' });
    expect(mismatch).toMatchObject({ ok: false });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('rejects a new password that matches the current one', async () => {
    const result = await changeOwnPassword(client, {
      ...valid,
      newPassword: valid.currentPassword,
      confirmPassword: valid.currentPassword,
    });
    expect(result).toEqual({ ok: false, message: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية' });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it('does not change the password when the current password is wrong', async () => {
    signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials', code: 'invalid_credentials' } });
    const result = await changeOwnPassword(client, valid);
    expect(result).toEqual({ ok: false, message: 'كلمة المرور الحالية غير صحيحة' });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('re-authenticates, then updates the password and nothing else', async () => {
    const result = await changeOwnPassword(client, valid);
    expect(result).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'soha@coceg.net', password: 'OldPass2026' });
    expect(updateUser).toHaveBeenCalledWith({ password: 'NewPass2026', current_password: 'OldPass2026' });
    expect(reauthenticate).not.toHaveBeenCalled();
  });

  it('sends a nonce when secure password change still requires one', async () => {
    updateUser.mockResolvedValue({ error: { message: 'Reauthentication needed', code: 'reauthentication_needed' } });
    const result = await changeOwnPassword(client, valid);
    expect(result).toEqual({
      ok: false,
      needsCode: true,
      message: 'أرسلنا رمز تأكيد إلى بريدك. أدخله لإكمال تغيير كلمة المرور.',
    });
    expect(reauthenticate).toHaveBeenCalledOnce();
  });

  it('finishes the change with the email nonce', async () => {
    const missing = await confirmPasswordChangeWithCode(client, {
      currentPassword: 'OldPass2026',
      newPassword: 'NewPass2026',
      code: '  ',
    });
    expect(missing.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();

    const result = await confirmPasswordChangeWithCode(client, {
      currentPassword: 'OldPass2026',
      newPassword: 'NewPass2026',
      code: ' 123456 ',
    });
    expect(result).toEqual({ ok: true });
    expect(updateUser).toHaveBeenCalledWith({
      password: 'NewPass2026',
      current_password: 'OldPass2026',
      nonce: '123456',
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});
