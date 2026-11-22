import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const signInWithPassword = vi.fn();
const updateUser = vi.fn();
const reauthenticate = vi.fn();
const toast = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      updateUser: (...args: unknown[]) => updateUser(...args),
      reauthenticate: (...args: unknown[]) => reauthenticate(...args),
    },
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'u1', email: 'soha@coceg.net' },
    profile: { id: 'u1', full_name: 'سها', email: 'soha@coceg.net' },
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

import ChangePasswordCard from '@/components/settings/ChangePasswordCard';

const fillValid = () => {
  fireEvent.change(screen.getByLabelText('كلمة المرور الحالية'), { target: { value: 'OldPass2026' } });
  fireEvent.change(screen.getByLabelText('كلمة المرور الجديدة'), { target: { value: 'NewPass2026' } });
  fireEvent.change(screen.getByLabelText('تأكيد كلمة المرور'), { target: { value: 'NewPass2026' } });
};

describe('ChangePasswordCard', () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    updateUser.mockReset();
    reauthenticate.mockReset();
    toast.mockReset();
    signInWithPassword.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ error: null });
    reauthenticate.mockResolvedValue({ error: null });
  });

  it('does not report success when the password was not changed', async () => {
    render(<ChangePasswordCard />);
    fireEvent.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('أدخل كلمة المرور الحالية');
    expect(updateUser).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'تعذر تغيير كلمة المرور' }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'تم الحفظ' }));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'تم تغيير كلمة المرور' }));
  });

  it('updates the signed-in user password and confirms only after success', async () => {
    render(<ChangePasswordCard />);
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({
      password: 'NewPass2026',
      current_password: 'OldPass2026',
    }));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'soha@coceg.net',
      password: 'OldPass2026',
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'تم تغيير كلمة المرور' }));
    expect(screen.getByLabelText('كلمة المرور الحالية')).toHaveValue('');
  });

  it('asks for the email code when reauthentication is still required', async () => {
    updateUser.mockResolvedValueOnce({ error: { message: 'Reauthentication needed', code: 'reauthentication_needed' } });
    updateUser.mockResolvedValueOnce({ error: null });
    render(<ChangePasswordCard />);
    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'تغيير كلمة المرور' }));

    expect(await screen.findByLabelText('رمز التأكيد')).toBeTruthy();
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'تم تغيير كلمة المرور' }));

    fireEvent.change(screen.getByLabelText('رمز التأكيد'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'تأكيد وتغيير كلمة المرور' }));

    await waitFor(() => expect(updateUser).toHaveBeenLastCalledWith({
      password: 'NewPass2026',
      current_password: 'OldPass2026',
      nonce: '123456',
    }));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'تم تغيير كلمة المرور' }));
  });
});
