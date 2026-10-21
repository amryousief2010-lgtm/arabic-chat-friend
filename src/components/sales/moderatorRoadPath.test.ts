import { describe, expect, it } from 'vitest';
import { moderatorKgBonus } from '@/lib/moderatorKgBonus';
import { ROAD_FLAGS, pointAtKg, roadCheer } from '@/components/sales/moderatorRoadPath';

describe('moderator road path', () => {
  it('starts at the bottom of the road and ends at the top', () => {
    const start = pointAtKg(0);
    const end = pointAtKg(2500);
    expect(start.y).toBeGreaterThan(900);
    expect(end.y).toBeLessThan(200);
    expect(pointAtKg(1037.5).y).toBeLessThan(pointAtKg(400).y);
    expect(pointAtKg(1037.5).y).toBeGreaterThan(pointAtKg(1500).y);
  });

  it('keeps the adopted bonus on every flag', () => {
    expect(ROAD_FLAGS.map((flag) => flag.kg)).toEqual([400, 750, 1000, 1500, 2000, 2500]);
    expect(moderatorKgBonus(400)).toBe(2400);
    expect(moderatorKgBonus(750)).toBeCloseTo(6076.5, 6);
    expect(moderatorKgBonus(1000)).toBeCloseTo(9829.5, 6);
    expect(moderatorKgBonus(1500)).toBe(15642);
    expect(moderatorKgBonus(2000)).toBe(22392);
    expect(moderatorKgBonus(2500)).toBe(29517);
  });

  it('tells her what is left to the next flag', () => {
    expect(roadCheer(1037.5)).toBe('🎉 عدّيتي الطن! فاضل 462.5 كجم على علم الـ 1,500 💪');
    expect(roadCheer(150)).toBe('فاضل 250 كجم على علم الـ 400');
    expect(roadCheer(2600)).toContain('آخر علم');
    expect(roadCheer(1037.5)).not.toContain('ربح');
  });
});
