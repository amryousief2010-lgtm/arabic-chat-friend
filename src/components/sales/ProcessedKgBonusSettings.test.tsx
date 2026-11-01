import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  roles: [] as string[],
  loading: false,
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => auth,
}));

import ProcessedKgBonusSettings from '@/components/sales/ProcessedKgBonusSettings';

describe('ProcessedKgBonusSettings', () => {
  beforeEach(() => {
    auth.roles = [];
    auth.loading = false;
  });

  it('hides the general curve from moderators and from a sales manager without the marketing role', () => {
    for (const roles of [['sales_moderator'], ['sales_manager'], ['marketing_sales_viewer'], []]) {
      auth.roles = roles;
      const { unmount } = render(<ProcessedKgBonusSettings />);
      expect(screen.queryByTestId('rising-bonus-table')).toBeNull();
      unmount();
    }
  });

  it('shows the curve to the general manager, the executive manager, and the marketing sales manager', () => {
    for (const role of ['general_manager', 'executive_manager', 'marketing_sales_manager']) {
      auth.roles = [role];
      const { unmount } = render(<ProcessedKgBonusSettings />);
      expect(screen.getByTestId('rising-bonus-table')).toBeTruthy();
      expect(screen.getByText('نظام البونص المعتمد')).toBeTruthy();
      unmount();
    }
  });

  it('stays hidden while roles are still loading', () => {
    auth.loading = true;
    auth.roles = ['general_manager'];
    render(<ProcessedKgBonusSettings />);
    expect(screen.queryByTestId('rising-bonus-table')).toBeNull();
  });
});
