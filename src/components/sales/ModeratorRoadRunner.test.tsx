import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ModeratorKgCounterCard from '@/components/sales/ModeratorKgCounterCard';

const avatar = vi.hoisted(() => ({ url: null as string | null }));

vi.mock('@/hooks/useAvatars', () => ({
  useAvatarUrl: () => avatar.url,
}));

const reducedMedia = () => ({
  matches: true,
  media: '(prefers-reduced-motion: reduce)',
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});

describe('moderator road girl', () => {
  beforeEach(() => {
    avatar.url = null;
    window.matchMedia = vi.fn().mockImplementation(reducedMedia) as unknown as typeof window.matchMedia;
  });

  it('draws the girl on the road with the real bonus labels and a photo fallback', () => {
    render(
      <ModeratorKgCounterCard
        name="آية"
        kg={917}
        carriedKg={120.5}
        baseSalary={3000}
        chickCount={4}
        chickBonus={200}
        periodLabel="أكتوبر 2026"
        now={new Date('2026-10-21T00:55:00+03:00')}
      />,
    );

    expect(screen.getByTestId('bonus-road-girl')).toHaveAttribute('data-avatar-state', 'initial');
    expect(screen.getByTestId('bonus-road-girl').textContent).toContain('آ');
    expect(screen.getByTestId('road-cheer').textContent).toContain('فاضل 462.5 كجم على علم الـ 1,500');
    const road = screen.getByTestId('bonus-road-runner');
    expect(road.textContent).toContain('15,642 ج');
    expect(road.textContent).toContain('2,400 ج');
    expect(road.textContent).toContain('طن ونص');
    expect(road.textContent).toContain('29,517 ج');
    expect(screen.getAllByText(/كتاكيت|كتكوت/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('ربح الشركة');
    const girl = screen.getByTestId('bonus-road-girl');
    const me = girl.getAttribute('transform') ?? '';
    expect(me).toContain('translate(');
    expect(screen.getByTestId('bonus-road-runner')).toHaveAttribute('data-motion', 'reduced');
  });

  it('clips the signed avatar into the head', () => {
    avatar.url = 'https://example.test/aya.png';
    render(
      <ModeratorKgCounterCard
        name="آية"
        kg={1037.5}
        baseSalary={3000}
        avatarUrl="https://example.test/aya.png"
      />,
    );
    const girl = screen.getByTestId('bonus-road-girl');
    expect(girl).toHaveAttribute('data-avatar-state', 'photo');
    const image = girl.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://example.test/aya.png');
    expect(image?.parentElement?.parentElement?.getAttribute('clip-path') || image?.closest('foreignObject')?.getAttribute('clip-path')).toBeTruthy();
  });
});
