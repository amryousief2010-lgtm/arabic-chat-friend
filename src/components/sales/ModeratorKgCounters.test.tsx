import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const progressMock = vi.fn();
vi.mock('@/hooks/useModeratorBonusProgress', () => ({
  useModeratorBonusProgress: (...args: unknown[]) => progressMock(...args),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, role: null }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock('@/components/sales/ModeratorKgCounterCard', () => ({
  default: () => <div data-testid="kg-card">0</div>,
}));

import { ModeratorKgCounterBoard } from './ModeratorKgCounters';

const state = (o: Partial<Record<string, unknown>>) => ({
  isPending: false, isError: false, isReady: false, error: null, retry: vi.fn(), ...o,
});

describe('ModeratorKgCounterBoard', () => {
  beforeEach(() => progressMock.mockReset());

  it('shows no cards (no zeros) while month quantities are loading', () => {
    progressMock.mockReturnValue({ rows: [], girls: ['X'], isLoading: true, queryState: state({ isPending: true }) });
    render(<ModeratorKgCounterBoard year={2026} month={10} onlyPayrollKey="X" />);
    expect(screen.queryByTestId('kg-card')).toBeNull();
    expect(screen.getByTestId('query-state-loading')).toBeTruthy();
  });

  it('shows error + retry instead of zero cards when the query fails', () => {
    const retry = vi.fn();
    progressMock.mockReturnValue({ rows: [], girls: ['X'], isError: true, queryState: state({ isError: true, retry }) });
    render(<ModeratorKgCounterBoard year={2026} month={10} onlyPayrollKey="X" />);
    expect(screen.queryByTestId('kg-card')).toBeNull();
    expect(screen.getByText('تعذّر تحميل الكميات')).toBeTruthy();
    fireEvent.click(screen.getByText('إعادة المحاولة'));
    expect(retry).toHaveBeenCalled();
  });

  it('scopes the query to the moderator own key', () => {
    progressMock.mockReturnValue({ rows: [], girls: ['X'], queryState: state({ isPending: true }) });
    render(<ModeratorKgCounterBoard year={2026} month={10} onlyPayrollKey="X" />);
    expect(progressMock).toHaveBeenCalledWith(2026, 10, { onlyGirl: 'X' });
  });
});

describe('bonus screens guard', () => {
  it('no bonus/target screen defaults quantities to zeros without a state gate', () => {
    const files = [
      'src/components/sales/ModeratorPayrollTable.tsx',
      'src/components/sales/GirlsSalesQuantityTable.tsx',
      'src/components/sales/ModeratorKgCounters.tsx',
      'src/hooks/useModeratorBonusProgress.ts',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(process.cwd(), f), 'utf8');
      const zeroDefault = /data:\s*\w+\s*=\s*\{\s*meat:\s*\{\}/.test(src) || /\?\?\s*\{\s*meat:\s*\{\}/.test(src);
      if (zeroDefault) expect(src, `${f} must gate with combineQueryStates`).toMatch(/combineQueryStates|QueryStateGate/);
    }
  });
});
