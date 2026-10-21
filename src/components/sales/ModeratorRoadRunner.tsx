import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useAvatarUrl } from '@/hooks/useAvatars';
import { formatBonusEgp, formatBonusKg, moderatorKgBonus } from '@/lib/moderatorKgBonus';
import {
  ROAD_D,
  ROAD_FLAGS,
  ROAD_H,
  ROAD_MAX,
  ROAD_VIEW,
  ROAD_W,
  hitCheer,
  pointAtKg,
  roadCheer,
} from '@/components/sales/moderatorRoadPath';

const PURPLE = '#A4288A';
const ORANGE = '#F37346';
const INK = '#1A1A1A';
const MUTED = '#5C5C5C';
const LINE = '#E6E6E6';
const RUN_MS = 5000;
const GIRL_SCALE = 1;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const rnd = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

type Burst = {
  x: number;
  y: number;
  a: number;
  v: number;
  c: string;
  t0: number;
  r: number;
};

const reachedKgs = (kg: number) => ROAD_FLAGS.filter((flag) => kg >= flag.kg).map((flag) => flag.kg);

/**
 * البنت بتجري مرة من صفر لحد كيلوها، وبعدين حلقة خفيفة وهي واقفة.
 * التحويلات بتتتكتب على عناصر الرسم مباشرة عشان مفيش إعادة رسم كل فريم.
 */
const ModeratorRoadRunner = ({
  kg,
  name,
  userId = null,
  avatarUrl,
  reduceMotion = false,
  hold = false,
}: {
  kg: number;
  name: string;
  userId?: string | null;
  /** رابط جاهز للمعاينة. الإنتاج يسيبه فاضي ويستخدم الصورة الموقّعة. */
  avatarUrl?: string | null;
  /** يثبت اللقطة الأخيرة. للمعاينة ولتقليل الحركة. */
  reduceMotion?: boolean;
  /** تقف عند صفر لحد ما المعاينة تسيبها تجري. */
  hold?: boolean;
}) => {
  const signedUrl = useAvatarUrl(userId);
  const photoUrl = avatarUrl !== undefined ? avatarUrl : signedUrl;
  const [failed, setFailed] = useState(false);
  const photo = Boolean(photoUrl) && !failed;
  const initial = name.trim().charAt(0) || 'م';
  const clipId = `head-${useId().replace(/:/g, '')}`;
  const gradId = `road-${useId().replace(/:/g, '')}`;
  const rootRef = useRef<SVGGElement>(null);
  const [reduced, setReduced] = useState(() => reduceMotion || prefersReducedMotion());
  const safeKg = Number.isFinite(kg) && kg > 0 ? kg : 0;
  const settled = roadCheer(safeKg);
  const startCheer = `يلا يا ${name.trim() || 'بطلة'}! 💪`;
  const [cheer, setCheer] = useState(() => ((reduceMotion || prefersReducedMotion()) ? settled : startCheer));
  const [reached, setReached] = useState<number[]>(() => ((reduceMotion || prefersReducedMotion()) ? reachedKgs(safeKg) : []));
  const kgRef = useRef<HTMLElement>(null);
  const pulseKg = ROAD_FLAGS.find((flag) => safeKg < flag.kg)?.kg ?? null;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const q = <T extends Element>(part: string) => root.querySelector(`[data-part="${part}"]`) as T | null;
    const done = q<SVGPathElement>('done');
    const me = q<SVGGElement>('me');
    const dir = q<SVGGElement>('dir');
    const girl = q<SVGGElement>('girl');
    const face = q<SVGGElement>('faceplate');
    const legF = q<SVGGElement>('legF');
    const legB = q<SVGGElement>('legB');
    const shinF = q<SVGGElement>('shinF');
    const shinB = q<SVGGElement>('shinB');
    const armF = q<SVGGElement>('armF');
    const armB = q<SVGGElement>('armB');
    const foreF = q<SVGGElement>('foreF');
    const foreB = q<SVGGElement>('foreB');
    const shadow = q<SVGEllipseElement>('shadow');
    const lines = q<SVGGElement>('lines');
    const trail = q<SVGGElement>('trail');
    const conf = q<SVGGElement>('conf');
    if (!done || !me || !dir || !girl || !face || !legF || !legB || !shinF || !shinB || !armF || !armB || !foreF || !foreB || !shadow || !lines || !trail || !conf) {
      return;
    }

    const target = Math.max(0, Math.min(ROAD_MAX, safeKg));
    const hit = new Set<number>(reduced ? reachedKgs(target) : []);
    const hitAt: number[] = [];
    let bursts: Burst[] = [];
    let settledOnce = reduced;
    let cancelled = false;
    let raf = 0;
    const colors = [PURPLE, ORANGE, '#ffd23f', '#5ec2b7'];

    const burst = (flagKg: number, t0: number) => {
      const p = pointAtKg(flagKg);
      for (let i = 0; i < 40; i += 1) {
        bursts.push({
          x: p.x,
          y: p.y - 30,
          a: rnd(i + flagKg) * 6.283,
          v: 2 + rnd(i * 7 + flagKg) * 4,
          c: colors[i % 4],
          t0,
          r: rnd(i * 3) * 6,
        });
      }
    };

    const poseLimb = (node: SVGGElement, base: string, angle: number) => {
      node.setAttribute('transform', `${base} rotate(${angle})`);
    };

    const apply = (t: number, fx: boolean) => {
      const e = Math.min(Math.max(t, 0) / RUN_MS, 1);
      const ease = 1 - (1 - e) ** 3;
      const k = target * ease;
      const p = pointAtKg(k);
      const p2 = pointAtKg(Math.min(k + 18, ROAD_MAX));
      const moving = e < 1 && target > 0;
      const ph = t / 110;
      let jump = 0;
      let joy = 0;
      if (fx) {
        hitAt.forEach((h) => {
          const d = t - h;
          if (d >= 0 && d < 650) {
            const u = d / 650;
            jump = Math.max(jump, Math.sin(u * Math.PI) * 26);
            joy = Math.max(joy, Math.sin(u * Math.PI));
          }
        });
      }
      if (!moving) {
        const d = t - RUN_MS;
        if (target <= 0) joy = 0;
        else if (fx && d >= 0 && d < 700) {
          const u = d / 700;
          jump = Math.max(jump, Math.sin(u * Math.PI) * 22);
          joy = Math.max(joy, Math.sin(u * Math.PI));
        } else joy = Math.max(joy, 0.6);
      }
      const run = moving && !joy ? 1 : moving ? 0.4 : 0;
      const sw = Math.sin(ph) * run;
      const bob = Math.abs(Math.cos(ph)) * 4 * run + (!moving ? Math.abs(Math.sin(t / 300)) * 2 : 0);
      const faceDir = p2.x - p.x > 0 ? -1 : 1;
      me.setAttribute('transform', `translate(${p.x},${p.y - 8})`);
      dir.setAttribute('transform', `scale(${faceDir},1)`);
      girl.setAttribute('transform', `translate(0,${(-bob - jump).toFixed(2)}) scale(${GIRL_SCALE}) rotate(${(-12 * run).toFixed(2)})`);
      face.setAttribute('transform', `scale(${faceDir},1)`);
      const leg = (node: SVGGElement, shin: SVGGElement, angle: number) => {
        poseLimb(node, 'translate(0,-24)', angle);
        poseLimb(shin, 'translate(0,12)', Math.max(0, -angle) * 1.3 + 8 * run);
      };
      leg(legF, shinF, 40 * sw - (jump ? 20 : 0));
      leg(legB, shinB, -40 * sw + (jump ? 25 : 0));
      const arm = (node: SVGGElement, fore: SVGGElement, angle: number, foreAngle: number, dx: number) => {
        poseLimb(node, `translate(${dx},-56)`, angle);
        poseLimb(fore, 'translate(0,13)', foreAngle);
      };
      arm(armF, foreF, -45 * sw * (1 - joy) + 125 * joy, -70 * (1 - joy) + 10 * joy, -12 * joy);
      arm(armB, foreB, 45 * sw * (1 - joy) - 125 * joy, -70 * (1 - joy) - 10 * joy, 12 * joy);
      shadow.setAttribute('rx', String(20 - jump * 0.35));
      lines.setAttribute('opacity', run > 0.5 ? '0.8' : '0');
      lines.setAttribute('transform', `scale(${faceDir},1) translate(${Math.sin(ph * 2) * 4},0)`);
      done.setAttribute('stroke-dasharray', `${k} ${ROAD_MAX}`);
      if (kgRef.current) kgRef.current.textContent = formatBonusKg(k);

      if (!fx) {
        trail.innerHTML = '';
        conf.innerHTML = '';
        return;
      }

      if (moving) {
        let spark = '';
        for (let i = 1; i <= 10; i += 1) {
          const kk = k - i * 14;
          if (kk < 0) break;
          const q = pointAtKg(kk);
          const j = rnd(i + Math.floor(t / 90));
          const j2 = rnd(i * 5 + Math.floor(t / 90));
          spark += `<circle cx="${q.x + (j - 0.5) * 12}" cy="${q.y + (j2 - 0.5) * 14}" r="${(10 - i) * 0.45 + 1}" fill="${i % 2 ? ORANGE : '#ffd23f'}" opacity="${(1 - i / 11).toFixed(3)}"/>`;
        }
        trail.innerHTML = spark;
      } else if (trail.innerHTML) trail.innerHTML = '';

      let crossed = false;
      ROAD_FLAGS.forEach((flag) => {
        if (k + 0.05 < flag.kg || hit.has(flag.kg)) return;
        hit.add(flag.kg);
        hitAt.push(t);
        burst(flag.kg, t);
        crossed = true;
      });
      if (crossed && !cancelled) {
        setReached(Array.from(hit));
        const ordered = Array.from(hit).sort((a, b) => a - b);
        const last = ordered[ordered.length - 1];
        if (last != null) setCheer(hitCheer(last));
      }
      if (!moving && !settledOnce) {
        settledOnce = true;
        if (!cancelled) {
          setReached(Array.from(hit));
          setCheer(roadCheer(target));
        }
      }

      bursts = bursts.filter((item) => t - item.t0 < 1400);
      if (bursts.length) {
        let bits = '';
        bursts.forEach((item) => {
          const d = (t - item.t0) / 16;
          const x = item.x + Math.cos(item.a) * item.v * d;
          const y = item.y + Math.sin(item.a) * item.v * d + 0.04 * d * d;
          const opacity = 1 - (t - item.t0) / 1400;
          bits += `<rect x="${x}" y="${y}" width="7" height="4" fill="${item.c}" opacity="${opacity.toFixed(3)}" transform="rotate(${item.r * 60 + d * 8} ${x} ${y})"/>`;
        });
        conf.innerHTML = bits;
      } else if (conf.innerHTML) conf.innerHTML = '';
    };

    if (hold && !reduced) {
      apply(0, false);
      setCheer(startCheer);
      setReached([]);
      return () => {
        cancelled = true;
      };
    }

    if (reduced) {
      apply(RUN_MS + 900, false);
      const flags = reachedKgs(target);
      setReached((prev) => (prev.length === flags.length && prev.every((value, index) => value === flags[index]) ? prev : flags));
      setCheer(roadCheer(target));
      return () => {
        cancelled = true;
      };
    }

    let started = performance.now();
    let hiddenAt = 0;
    const loop = (now: number) => {
      if (cancelled) return;
      if (document.hidden) {
        if (!hiddenAt) hiddenAt = now;
        return;
      }
      apply(now - started, true);
      raf = window.requestAnimationFrame(loop);
    };
    const onVisible = () => {
      if (cancelled || document.hidden) return;
      if (hiddenAt) {
        started += performance.now() - hiddenAt;
        hiddenAt = 0;
      }
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(loop);
    };
    document.addEventListener('visibilitychange', onVisible);
    apply(0, false);
    setCheer(startCheer);
    raf = window.requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.cancelAnimationFrame(raf);
    };
  }, [reduced, safeKg, startCheer, hold]);

  const next = ROAD_FLAGS.find((flag) => safeKg < flag.kg) ?? null;

  return (
    <div data-testid="bonus-road-runner" data-motion={reduced ? 'reduced' : 'run'}>
      <style>
        {`@keyframes coceg-flag-pulse{0%,100%{transform:translateY(-50%) scale(1)}50%{transform:translateY(-50%) scale(1.06)}}
.coceg-flag-pulse{animation:coceg-flag-pulse 1s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.coceg-flag-pulse{animation:none}}`}
      </style>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.618fr 1fr 1fr',
          gap: 13,
          padding: '0 21px 13px',
        }}
      >
        <div style={{ background: '#faf3f8', borderRadius: 13, padding: 13 }}>
          <b ref={kgRef} className="tabular-nums" style={{ display: 'block', fontSize: 21, lineHeight: 1.3, color: PURPLE }}>{formatBonusKg(reduced ? safeKg : 0)}</b>
          <span style={{ fontSize: 13, lineHeight: 1.618, color: MUTED }}>كجم لحد النهارده</span>
        </div>
        <div style={{ background: '#faf3f8', borderRadius: 13, padding: 13 }}>
          <b className="tabular-nums" style={{ display: 'block', fontSize: 21, lineHeight: 1.3, color: ORANGE }}>{next ? formatBonusKg(next.kg) : '—'}</b>
          <span style={{ fontSize: 13, lineHeight: 1.618, color: MUTED }}>العلم الجاي (كجم)</span>
        </div>
        <div style={{ background: '#faf3f8', borderRadius: 13, padding: 13 }}>
          <b className="tabular-nums" style={{ display: 'block', fontSize: 21, lineHeight: 1.3, color: PURPLE }}>{next ? formatBonusKg(next.kg - safeKg) : '0'}</b>
          <span style={{ fontSize: 13, lineHeight: 1.618, color: MUTED }}>كجم فاضلين</span>
        </div>
      </div>
      <div style={{ position: 'relative', width: '100%', aspectRatio: `${ROAD_W} / ${ROAD_H}` }}>
      <svg
        viewBox={`${ROAD_VIEW.x} ${ROAD_VIEW.y} ${ROAD_VIEW.w} ${ROAD_VIEW.h}`}
        width="100%"
        height="100%"
        role="img"
        aria-label={`طريق الأعلام. ${settled}`}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor={PURPLE} />
            <stop offset="1" stopColor={ORANGE} />
          </linearGradient>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>
        <g ref={rootRef}>
          <path d={ROAD_D} fill="none" stroke={LINE} strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
          <path
            data-part="done"
            d={ROAD_D}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="28"
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={ROAD_MAX}
          />
          <path d={ROAD_D} fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth="3" strokeDasharray="8 12" strokeLinecap="round" />
          {ROAD_FLAGS.map((flag, index) => {
            const spot = pointAtKg(flag.kg);
            const passed = reached.includes(flag.kg);
            const current = flag.kg === pulseKg && !passed;
            const edge = index % 2 === 0 ? 108 : 252;
            return (
              <g key={flag.kg} data-flag-state={passed ? 'passed' : current ? 'next' : 'ahead'}>
                <line x1={spot.x} y1={spot.y} x2={edge} y2={spot.y} stroke={passed ? PURPLE : current ? ORANGE : LINE} strokeWidth="2" />
                <g transform={`translate(${spot.x} ${spot.y})`}>
                  <line x1="0" y1="0" x2="0" y2="-28" stroke="#5b2a52" strokeWidth="2.5" />
                  <path d="M0 -28 L-16 -22 L0 -16Z" fill={passed ? PURPLE : ORANGE} />
                </g>
                <circle cx={spot.x} cy={spot.y} r={current ? 5 : 4} fill="#fff" stroke={passed ? PURPLE : current ? ORANGE : LINE} strokeWidth="2" />
              </g>
            );
          })}
          <g data-part="trail" />
          <g data-part="conf" />
          <g data-part="me" data-testid="bonus-road-girl" data-avatar-state={photo ? 'photo' : 'initial'}>
            <ellipse data-part="shadow" cx="0" cy="2" rx="20" ry="4" fill="rgba(0,0,0,0.15)" />
            <g data-part="lines" stroke={ORANGE} strokeWidth="3" strokeLinecap="round">
              <line x1="26" y1="-60" x2="46" y2="-60" />
              <line x1="28" y1="-44" x2="54" y2="-44" />
              <line x1="26" y1="-28" x2="44" y2="-28" />
            </g>
            <g data-part="dir">
              <g data-part="girl">
                <g data-part="legB">
                  <line x1="0" y1="0" x2="0" y2="12" stroke="#5b2a52" strokeWidth="6" strokeLinecap="round" />
                  <g data-part="shinB">
                    <line x1="0" y1="0" x2="0" y2="12" stroke="#5b2a52" strokeWidth="5.5" strokeLinecap="round" />
                    <ellipse cx="-3" cy="13" rx="5.5" ry="3" fill="#2b1630" />
                  </g>
                </g>
                <g data-part="armB">
                  <line x1="0" y1="0" x2="0" y2="13" stroke="#8a1f73" strokeWidth="6" strokeLinecap="round" />
                  <g data-part="foreB">
                    <line x1="0" y1="0" x2="0" y2="13" stroke="#8a1f73" strokeWidth="5" strokeLinecap="round" />
                    <circle cy="14" r="3.8" fill="#f2c9a8" />
                  </g>
                </g>
                <path d="M-10 -58 Q0 -62 10 -58 L15 -22 Q0 -17 -15 -22 Z" fill={PURPLE} />
                <path d="M-12 -34 L12 -34 L15 -22 Q0 -17 -15 -22Z" fill={ORANGE} />
                <path d="M-9 -45 L9 -45" stroke={ORANGE} strokeWidth="3" />
                <g data-part="legF">
                  <line x1="0" y1="0" x2="0" y2="12" stroke="#6d3363" strokeWidth="6" strokeLinecap="round" />
                  <g data-part="shinF">
                    <line x1="0" y1="0" x2="0" y2="12" stroke="#6d3363" strokeWidth="5.5" strokeLinecap="round" />
                    <ellipse cx="-3" cy="13" rx="5.5" ry="3" fill="#2b1630" />
                  </g>
                </g>
                <path d="M-23 -80 A23 23 0 0 1 23 -80 L22 -64 Q14 -52 0 -52 Q-14 -52 -22 -64Z" fill={PURPLE} />
                <circle cx="0" cy="-80" r="23" fill={PURPLE} />
                <g data-part="faceplate">
                  {photo ? (
                    <foreignObject x="-18" y="-98" width="36" height="36" clipPath={`url(#${clipId})`}>
                      <div
                        {...{ xmlns: 'http://www.w3.org/1999/xhtml' }}
                        style={{ width: 36, height: 36, borderRadius: 18, overflow: 'hidden', background: '#f3dbe9' }}
                      >
                        <img
                          src={photoUrl ?? ''}
                          alt=""
                          width={36}
                          height={36}
                          style={{ width: 36, height: 36, objectFit: 'cover', display: 'block' }}
                          onError={() => setFailed(true)}
                        />
                      </div>
                    </foreignObject>
                  ) : (
                    <>
                      <circle cx="0" cy="-80" r="18" fill="#f3dbe9" />
                      <text
                        x="0"
                        y="-80"
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize="16"
                        fontWeight="800"
                        fill={PURPLE}
                        fontFamily="Cairo, sans-serif"
                      >
                        {initial}
                      </text>
                    </>
                  )}
                </g>
                <circle cx="0" cy="-80" r="18" fill="none" stroke={ORANGE} strokeWidth="2.5" />
                <g data-part="armF">
                  <line x1="0" y1="0" x2="0" y2="13" stroke="#c23aa5" strokeWidth="6" strokeLinecap="round" />
                  <g data-part="foreF">
                    <line x1="0" y1="0" x2="0" y2="13" stroke="#c23aa5" strokeWidth="5" strokeLinecap="round" />
                    <circle cy="14" r="4" fill="#f2c9a8" />
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
      {ROAD_FLAGS.map((flag, index) => {
        const spot = pointAtKg(flag.kg);
        const passed = reached.includes(flag.kg);
        const current = flag.kg === pulseKg && !passed;
        const onLeft = index % 2 === 0;
        return (
          <div
            key={flag.kg}
            className={current && !reduced ? 'coceg-flag-pulse' : undefined}
            style={{
              position: 'absolute',
              left: onLeft ? '2%' : 'auto',
              right: onLeft ? 'auto' : '2%',
              width: '30%',
              top: `${(spot.y / ROAD_H) * 100}%`,
              transform: 'translateY(-50%)',
              textAlign: 'center',
              background: passed ? PURPLE : current ? ORANGE : '#fff',
              color: passed || current ? '#fff' : INK,
              border: passed || current ? 'none' : `1px solid ${LINE}`,
              borderRadius: 13,
              padding: '8px 8px',
              boxShadow: current ? '0 8px 21px rgba(243,115,70,0.35)' : '0 4px 13px rgba(26,26,26,0.06)',
            }}
          >
            <p style={{ margin: 0, fontSize: 13, fontWeight: 800, lineHeight: 1.35 }}>{flag.title}</p>
            <p className="tabular-nums" style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 800, lineHeight: 1.35, direction: 'ltr' }}>
              {`${formatBonusEgp(moderatorKgBonus(flag.kg))} ج`}
            </p>
            {current && (
              <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 800, lineHeight: 1.45 }}>
                {`فاضلِك ${formatBonusKg(flag.kg - safeKg)} كجم`}
              </p>
            )}
          </div>
        );
      })}
      </div>
      <p
        data-testid="road-cheer"
        style={{
          margin: '13px 21px 0',
          textAlign: 'center',
          fontWeight: 800,
          color: ORANGE,
          fontSize: 13,
          lineHeight: 1.618,
        }}
      >
        {cheer}
      </p>
    </div>
  );
};

export default ModeratorRoadRunner;
