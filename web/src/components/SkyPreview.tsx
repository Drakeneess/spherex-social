import { useEffect, useMemo, useRef } from 'react';

type Point = { x: number; y: number; radius: number; phase: number; color: string };
function hash(text: string): number {
  let n = 2166136261;
  for (const ch of text) { n ^= ch.charCodeAt(0); n = Math.imul(n, 16777619); }
  return n >>> 0;
}
function random(seed: number) {
  let value = seed;
  return () => {
    value = (value + 0x6D2B79F5) | 0;
    let t = Math.imul(value ^ value >>> 15, 1 | value);
    t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export function SkyPreview({ seed, moving = true, label = 'ILUSTRACIÓN SINTÉTICA', onClick }: {
  seed: string; moving?: boolean; label?: string; onClick?: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useMemo(() => {
    const code = hash(seed);
    const next = random(code);
    const stars: Point[] = Array.from({ length: 220 }, () => ({
      x: next(), y: next(), radius: next() * 1.3 + .3,
      phase: next() * Math.PI * 2,
      color: next() < .15 ? '#ffd9b0' : next() < .3 ? '#b8d4ff' : '#fff',
    }));
    const trajectory = random(code + 99);
    const x0 = .2 + trajectory() * .3, y0 = .5 + trajectory() * .3;
    return {
      stars,
      path: { x0, y0, x1: x0 + .15 + trajectory() * .3, y1: y0 - .1 - trajectory() * .3 },
    };
  }, [seed]);

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext('2d');
    if (!element || !ctx) return;
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let active = true, visible = true, frame = 0, lastDraw = -Infinity;
    let ratio = 1;
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.max(1, Math.round(bounds.width * ratio));
      element.height = Math.max(1, Math.round(bounds.height * ratio));
    };
    const draw = (time: number) => {
      if (!active) return;
      if (visible && (time - lastDraw > 32 || lastDraw === -Infinity)) {
        lastDraw = time;
        const w = element.width, h = element.height;
        const bg = ctx.createLinearGradient(0, 0, w, h);
        bg.addColorStop(0, '#04060d');
        bg.addColorStop(1, '#121a34');
        ctx.globalAlpha = 1;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        const scale = w / 400;
        for (const star of scene.stars) {
          ctx.globalAlpha = prefersReducedMotion ? .8 : .7 + .3 * Math.sin(time / 700 + star.phase);
          ctx.fillStyle = star.color;
          ctx.beginPath();
          ctx.arc(star.x * w, star.y * h, star.radius * (scale + .4), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (moving) {
          const progress = prefersReducedMotion ? .5 : Math.floor(time / 1200 % 5) / 4;
          const { x0, x1, y0, y1 } = scene.path;
          const x = (x0 + (x1 - x0) * progress) * w;
          const y = (y0 + (y1 - y0) * progress) * h;
          const glow = ctx.createRadialGradient(x, y, 0, x, y, 20 * (scale + .4));
          glow.addColorStop(0, '#ffb066');
          glow.addColorStop(.3, '#ff9f5a99');
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(x, y, 20 * (scale + .4), 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(x, y, 2.4 * (scale + .4), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!prefersReducedMotion) frame = requestAnimationFrame(draw);
    };
    const resizeObserver = new ResizeObserver(() => { resize(); if (prefersReducedMotion) draw(0); });
    const visibilityObserver = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false;
    }, { threshold: .05 });
    resize();
    resizeObserver.observe(element);
    visibilityObserver.observe(element);
    draw(0);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
    };
  }, [scene, moving]);

  return <div className={`star-preview ${onClick ? 'clickable' : ''}`}
    role={onClick ? 'button' : 'img'}
    tabIndex={onClick ? 0 : undefined}
    onClick={onClick}
    onKeyDown={event => {
      if (onClick && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        onClick();
      }
    }}
    aria-label="Campo estelar ilustrativo generado por computadora, no una fotografía SPHEREx">
    <canvas ref={canvas} aria-hidden="true" />
    <span className="preview-mark">{label}</span>
    {onClick && <span className="preview-open">Ver parpadeo ▶</span>}
  </div>;
}
