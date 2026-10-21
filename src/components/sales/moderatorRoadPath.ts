import { formatBonusKg } from '@/lib/moderatorKgBonus';

/**
 * طريق الأعلام الرأسي للكارت. الكيلو بيطلع من تحت لفوق،
 * والنقطة محسوبة بنفس منحنى الكارت عشان البنت تمشي على الخط.
 */

export const ROAD_MAX = 2500;
export const ROAD_W = 360;
export const ROAD_H = 1040;
const ROAD_TOP = 168;
const ROAD_BOTTOM = 960;

export const ROAD_FLAGS = [
  { kg: 400, title: '٤٠٠' },
  { kg: 750, title: '٧٥٠' },
  { kg: 1000, title: 'طن' },
  { kg: 1500, title: 'طن ونص' },
  { kg: 2000, title: '٢ طن' },
  { kg: 2500, title: '٢٫٥ طن' },
] as const;

export type RoadFlag = (typeof ROAD_FLAGS)[number];

export const ROAD_VIEW = { x: 0, y: 0, w: ROAD_W, h: ROAD_H };

/** نقطة التصميم: الصادي خطي مع الكيلو، والسين بيتموّج. */
export const roadAnchor = (kg: number) => {
  const t = Math.max(0, Math.min(1, (Number.isFinite(kg) ? kg : 0) / ROAD_MAX));
  return {
    x: 180 + Math.sin(t * Math.PI * 3) * 26,
    y: ROAD_BOTTOM - t * (ROAD_BOTTOM - ROAD_TOP),
  };
};

export const ROAD_D = (() => {
  let d = '';
  for (let kg = 0; kg <= ROAD_MAX; kg += 25) {
    const { x, y } = roadAnchor(kg);
    d += `${kg === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
})();

export const pointAtKg = (kg: number) => roadAnchor(Math.max(0, Math.min(ROAD_MAX, Number.isFinite(kg) ? kg : 0)));

const passedPhrase = (flag: RoadFlag) => {
  if (flag.kg === 1000) return 'عدّيتي الطن!';
  if (flag.kg === 1500) return 'عدّيتي الطن ونص!';
  if (flag.kg === 2000) return 'عدّيتي الـ ٢ طن!';
  if (flag.kg === 2500) return 'عدّيتي الـ ٢٫٥ طن!';
  return `عدّيتي علم الـ ${formatBonusKg(flag.kg)}!`;
};

/** جملة العلم الجاي بعد ما البنت توصل لمكانها. */
export const roadCheer = (kg: number) => {
  const safe = Number.isFinite(kg) && kg > 0 ? kg : 0;
  const next = ROAD_FLAGS.find((flag) => safe < flag.kg) ?? null;
  const passed = [...ROAD_FLAGS].reverse().find((flag) => safe >= flag.kg) ?? null;
  if (!next) return '🎉 عدّيتي آخر علم! كل كيلو زيادة لسه بيزوّد البونص 💪';
  const left = formatBonusKg(next.kg - safe);
  const goal = formatBonusKg(next.kg);
  const rest = `فاضل ${left} كجم على علم الـ ${goal}`;
  if (!passed) return rest;
  return `🎉 ${passedPhrase(passed)} ${rest} 💪`;
};

export const hitCheer = (kg: number) => `🎉 وصلتي ${formatBonusKg(kg)} كجم!`;
