import { useEffect, useRef } from 'react';

type Star = { x: number; y: number; size: number; phase: number; color: string };

// Direct React adaptation of the supplied INT.html login canvas.
// Fixed seed keeps the same star positions between renders.
function random(seed: number) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const stars: Star[] = (() => {
  const next = random(5);
  return Array.from({ length: 260 }, () => {
    const x = next(), y = next(), size = next() * 1.3 + .3;
    const phase = next() * Math.PI * 2;
    const color = next() < .15 ? '#ffd9b0' : next() < .3 ? '#b8d4ff' : '#fff';
    return { x, y, size, phase, color };
  });
})();

export default function HeroStarfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    let pixelRatio = 1;
    let running = true;

    function resize() {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(rect.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(rect.height * pixelRatio));
    }

    function draw(time: number) {
      if (!context || !canvas || !running) return;
      const width = canvas.width, height = canvas.height;
      context.fillStyle = '#04060d';
      context.fillRect(0, 0, width, height);
      for (const star of stars) {
        context.globalAlpha = .5 + .5 * Math.sin(time / 900 + star.phase);
        context.fillStyle = star.color;
        context.beginPath();
        context.arc(star.x * width, star.y * height, star.size * 1.4 * pixelRatio, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      const k = reducedMotion ? .5 : (time / 9000) % 1;
      const x = (.3 + .4 * k) * width, y = (.7 - .35 * k) * height;
      const glow = context.createRadialGradient(x, y, 0, x, y, 26 * pixelRatio);
      glow.addColorStop(0, '#ffb066');
      glow.addColorStop(1, 'transparent');
      context.fillStyle = glow;
      context.beginPath();
      context.arc(x, y, 26 * pixelRatio, 0, Math.PI * 2);
      context.fill();
      if (!reducedMotion) frame = window.requestAnimationFrame(draw);
    }

    resize();
    const observer = new ResizeObserver(() => {
      resize();
      if (reducedMotion) draw(0);
    });
    observer.observe(canvas);
    draw(0);

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="auth-starfield" />;
}
