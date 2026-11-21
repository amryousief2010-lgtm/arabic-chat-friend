import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModeratorKgCounterCard from '@/components/sales/ModeratorKgCounterCard';
import { EgpInline, IsolatedNumbers } from '@/components/sales/egpInline';

vi.mock('@/hooks/useAvatars', () => ({
  useAvatarUrl: () => null,
}));

describe('egp inline bidi', () => {
  it('keeps the currency after the number, including zero', () => {
    render(<EgpInline amount={0} />);
    const node = document.querySelector('[data-egp]');
    expect(node).toHaveAttribute('dir', 'ltr');
    expect(node?.textContent).toBe('0 ج');
    expect(node?.textContent?.startsWith('0')).toBe(true);
  });

  it('isolates numbers inside an Arabic sentence without changing the words', () => {
    render(<p><IsolatedNumbers text="فاضل 198 كجم على علم الـ 1,000" /></p>);
    const paragraph = screen.getByText((_content, element) => element?.tagName === 'P');
    expect(paragraph.textContent).toBe('فاضل 198 كجم على علم الـ 1,000');
    const isolated = paragraph.querySelectorAll('bdi[dir="ltr"]');
    expect(Array.from(isolated).map((node) => node.textContent)).toEqual(['198', '1,000']);
  });
});

describe('moderator card mobile layout', () => {
  it('stretches the pay cards, reserves hint space, and isolates every pound amount', () => {
    render(
      <ModeratorKgCounterCard
        name="نورا"
        kg={667}
        carriedKg={126}
        baseSalary={2500}
        meatKg={74}
        meatSales={30960}
        meatBonus={0}
        meatTiers={[{ sales: 100000, label: 'الأول' }]}
        boneKg={6}
        boneBonus={0}
        chickCount={0}
        chickBonus={0}
        reduceMotion
        now={new Date('2026-10-21T00:55:00+03:00')}
      />,
    );

    const row = document.querySelector('.coceg-pay-row');
    expect(row).toBeTruthy();
    expect(document.querySelectorAll('.coceg-pay-card')).toHaveLength(2);
    expect(document.querySelectorAll('.coceg-lane')).toHaveLength(3);
    expect(document.querySelectorAll('.coceg-lane-hint')).toHaveLength(3);

    const amounts = document.querySelectorAll('[data-egp]');
    expect(amounts.length).toBeGreaterThan(0);
    for (const node of amounts) {
      expect(node).toHaveAttribute('dir', 'ltr');
      expect(node.textContent).toMatch(/^\d[\d,]*(?:\.\d+)? ج$/);
    }
    expect(Array.from(amounts).some((node) => node.textContent === '0 ج')).toBe(true);
    expect(document.body.textContent).toContain('فاضلِك');
    expect(document.body.textContent).not.toContain('ج 0');
  });
});
