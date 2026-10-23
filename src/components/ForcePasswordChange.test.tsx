import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const updateUser = vi.fn();
const signOut = vi.fn();
let authUser: any = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { auth: { updateUser: (...a: unknown[]) => updateUser(...a) } },
}));
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: authUser,
    role: 'sales_moderator',
    roles: ['sales_moderator'],
    loading: false,
    profile: { id: 'u1', full_name: 'سها', email: 'x@y.z' },
    signOut,
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ProtectedRoute from '@/components/ProtectedRoute';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ProtectedRoute>
        <div>SECRET APP CONTENT</div>
      </ProtectedRoute>
    </MemoryRouter>,
  );

describe('force password change gate', () => {
  beforeEach(() => {
    updateUser.mockReset();
    signOut.mockReset();
  });

  it('blocks the app and shows the change-password page when flagged', () => {
    authUser = { id: 'u1', user_metadata: { must_change_password: true } };
    renderAt('/orders');
    expect(screen.getByTestId('force-password-change')).toBeTruthy();
    expect(screen.getByText('غيّري كلمة السر')).toBeTruthy();
    expect(screen.queryByText('SECRET APP CONTENT')).toBeNull();
  });

  it('renders the app normally when not flagged', () => {
    authUser = { id: 'u1', user_metadata: {} };
    renderAt('/orders');
    expect(screen.getByText('SECRET APP CONTENT')).toBeTruthy();
    expect(screen.queryByTestId('force-password-change')).toBeNull();
  });

  it('validates locally, then calls updateUser with the new password and clears the flag', async () => {
    authUser = { id: 'u1', user_metadata: { must_change_password: true } };
    updateUser.mockResolvedValue({ error: null });
    renderAt('/orders');
    const pw = screen.getByLabelText('كلمة السر الجديدة');
    const cf = screen.getByLabelText('أكّدي كلمة السر');
    const submit = screen.getByText('حفظ كلمة السر والدخول');

    fireEvent.change(pw, { target: { value: 'short1' } });
    fireEvent.change(cf, { target: { value: 'short1' } });
    fireEvent.click(submit);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(updateUser).not.toHaveBeenCalled();

    fireEvent.change(pw, { target: { value: 'NewPass2026' } });
    fireEvent.change(cf, { target: { value: 'NewPass2026' } });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({ password: 'NewPass2026', data: { must_change_password: false } }),
    );
  });

  it('shows the server error when the update fails', async () => {
    authUser = { id: 'u1', user_metadata: { must_change_password: true } };
    updateUser.mockResolvedValue({ error: { message: 'New password should be different from the old password.' } });
    renderAt('/orders');
    fireEvent.change(screen.getByLabelText('كلمة السر الجديدة'), { target: { value: 'NewPass2026' } });
    fireEvent.change(screen.getByLabelText('أكّدي كلمة السر'), { target: { value: 'NewPass2026' } });
    fireEvent.click(screen.getByText('حفظ كلمة السر والدخول'));
    expect(await screen.findByText('اختاري كلمة سر جديدة غير اللي اتبعتت لك')).toBeTruthy();
  });

  it('lets her sign out from the gate', () => {
    authUser = { id: 'u1', user_metadata: { must_change_password: true } };
    renderAt('/orders');
    fireEvent.click(screen.getByText('تسجيل الخروج'));
    expect(signOut).toHaveBeenCalled();
  });
});
