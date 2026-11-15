import { useEffect, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react';
import type { SkyFrame, MotionCandidate } from '../lib/api';

export type EpochMark = { index: number; x: number; y: number };

type Props = {
  frame?: SkyFrame;
  previous?: SkyFrame;
  index: number;
  total: number;
  marks: EpochMark[];
  onMark: (x: number, y: number) => void;
  metaLabel?: string;
  loading: boolean;
  hasSearch: boolean;
  candidate?: MotionCandidate|null;
};

function fitted(image: HTMLImageElement, w: number, h: number) {
  const scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  return { x: (w - width) / 2, y: (h - height) / 2, width, height };
}

export default function EpochCanvas({
  frame, previous, index, total, marks, onMark, metaLabel, loading, hasSearch, candidate,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cache = useRef(new Map<string, HTMLImageElement>());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    for (const source of [frame?.image, previous?.image]) {
      if (!source || cache.current.has(source)) continue;
      const image = new Image();
      cache.current.set(source, image);
      image.onload = () => setVersion(value => value + 1);
      image.onerror = () => setVersion(value => value + 1);
      image.src = source;
    }
  }, [frame?.image, previous?.image]);

  useEffect(() => {
    const currentCache = cache.current;
    return () => {
      for (const image of currentCache.values()) {
        image.onload = null;
        image.onerror = null;
      }
      currentCache.clear();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const bounds = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(bounds.width * ratio));
      const h = Math.max(1, Math.round(bounds.height * ratio));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#04060d';
      ctx.fillRect(0, 0, w, h);
      const current = frame ? cache.current.get(frame.image) : null;
      if (!current?.naturalWidth || !current.naturalHeight) return;
      const box = fitted(current, w, h);
      ctx.imageSmoothingEnabled = false;

      const earlier = previous ? cache.current.get(previous.image) : null;
      if (earlier?.naturalWidth && earlier.naturalHeight) {
        ctx.save();
        ctx.globalAlpha = .6;
        ctx.drawImage(earlier, box.x, box.y, box.width, box.height);
        ctx.restore();
        ctx.globalAlpha = .55;
      }
      ctx.drawImage(current, box.x, box.y, box.width, box.height);
      ctx.globalAlpha = 1;

      if (marks.length) {
        const scale = Math.max(1, w / 500);
        const ordered = [...marks].sort((a, b) => a.index - b.index);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,107,181,.82)';
        ctx.lineWidth = 1.5 * scale;
        ctx.setLineDash([5 * scale, 5 * scale]);
        ctx.beginPath();
        ordered.forEach((mark, n) => {
          const x = box.x + mark.x * box.width;
          const y = box.y + mark.y * box.height;
          if (n === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ordered.forEach(mark => {
          ctx.globalAlpha = mark.index === index ? 1 : .35;
          const x = box.x + mark.x * box.width;
          const y = box.y + mark.y * box.height;
          ctx.strokeStyle = '#ff6bb5';
          ctx.lineWidth = 2 * scale;
          ctx.beginPath();
          ctx.arc(x, y, 12 * scale, 0, 2 * Math.PI);
          ctx.stroke();
        });
        ctx.restore();
      }
      if (candidate?.detections.length) {
        const ordered = [...candidate.detections].sort((a,b)=>a.mjd-b.mjd);
        ctx.save();
        ctx.strokeStyle = '#75e5ec';
        ctx.fillStyle = '#75e5ec';
        ctx.lineWidth = Math.max(1.6, w / 350);
        ctx.setLineDash([5, 6]);
        ctx.beginPath();
        ordered.forEach((point,n)=>{
          const x = box.x + point.x * box.width;
          const y = box.y + point.y * box.height;
          if(n===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
        });
        ctx.stroke();ctx.setLineDash([]);
        for(const point of ordered){
          const selected=point.index===index;
          const x=box.x+point.x*box.width;
          const y=box.y+point.y*box.height;
          ctx.globalAlpha=selected?1:0.4;
          ctx.beginPath();ctx.arc(x,y,selected?11:6,0,2*Math.PI);ctx.stroke();
          if(selected){
            ctx.beginPath();ctx.moveTo(x-18,y);ctx.lineTo(x-13,y);
            ctx.moveTo(x+13,y);ctx.lineTo(x+18,y);
            ctx.moveTo(x,y-18);ctx.lineTo(x,y-13);
            ctx.moveTo(x,y+13);ctx.lineTo(x,y+18);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [frame, previous, index, marks, candidate, version]);

  function markAt(clientX: number, clientY: number) {
    const canvas = canvasRef.current;
    const image = frame ? cache.current.get(frame.image) : null;
    if (!canvas || !image?.naturalWidth || !image.naturalHeight) return;
    const bounds = canvas.getBoundingClientRect();
    const box = fitted(image, bounds.width, bounds.height);
    const x = (clientX - bounds.left - box.x) / box.width;
    const y = (clientY - bounds.top - box.y) / box.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onMark(x, y);
  }

  function click(event: MouseEvent<HTMLCanvasElement>) {
    markAt(event.clientX, event.clientY);
  }
  function keyDown(event: KeyboardEvent<HTMLCanvasElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const box = canvasRef.current?.getBoundingClientRect();
      if (box) markAt(box.left + box.width / 2, box.top + box.height / 2);
    }
  }

  const label = frame?.date ? `${frame.date.slice(0, 19)} · ${index + 1}/${total}` : metaLabel;
  const ready = Boolean(frame);
  return <div className="epoch-stage">
    <canvas ref={canvasRef} onClick={click} onKeyDown={keyDown}
      role="button" tabIndex={ready ? 0 : -1}
      aria-disabled={!ready}
      aria-label="Marcar posición en esta época; con teclado, Enter marca el centro de la imagen"/>
    {ready && candidate && <div className="epoch-candidate-label" role="status">
      {candidate.id} · trayectoria preliminar (sin confirmar)
    </div>}
    {ready && <div className="epoch-image-label">{label ?? `Época ${index + 1}/${total}`}</div>}
    {frame?.mode === 'simulated' && <div className="epoch-simulation-label">SIMULACIÓN · NO ES UNA IMAGEN NASA</div>}
    {!frame && <div className={`epoch-placeholder ${loading ? 'sky-canvas-waiting' : ''}`}
      role="status">
      {loading ? <>
        <div className="sky-canvas-orbit" aria-hidden="true">
          <span className="sky-canvas-core"/>
          <span className="sky-canvas-satellite"/>
        </div>
        <strong>Preparando tu ventana al universo</strong>
        <span>Estamos buscando las mejores vistas de esta región.</span>
        <small>Puedes visitar Inicio: la búsqueda seguirá aquí.</small>
      </> :
        hasSearch && total === 0 ? 'No hay observaciones disponibles para esta región.' :
        hasSearch ? 'Esta imagen no está disponible. Puedes elegir otra época.' :
        <>Elige coordenadas y pulsa <strong>Buscar</strong></>}
    </div>}
    {ready && <div className="epoch-mark-guide">{marks.length===0
      ? 'Marca un objeto y vuelve a marcarlo en otra época'
      : marks.length===1
        ? '1 época marcada · cambia de época para trazar'
        : `${marks.length} épocas marcadas · trayectoria local`}</div>}
  </div>;
}
