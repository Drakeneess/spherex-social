import { useMemo } from 'react';

function hash(text: string) {
  let value = 2166136261;
  for (const char of text) { value ^= char.charCodeAt(0); value = Math.imul(value, 16777619); }
  return value >>> 0;
}
function random(seed: number) {
  let value = seed;
  return () => { value = (Math.imul(1664525, value) + 1013904223) | 0; return (value >>> 0) / 4294967296; };
}
export function SkyPreview({ seed, moving = true, label = 'SIMULACIÓN VISUAL', onClick }: {
  seed: string; moving?: boolean; label?: string; onClick?: () => void;
}) {
  const stars = useMemo(() => {
    const next = random(hash(seed));
    return Array.from({length: 105}, (_, i) => ({
      id:i, x:next()*400,y:next()*400,r:next()*1.6+.35,
      opacity:next()*.65+.3,color:next()<.14?'#fed7b2':next()<.3?'#accfff':'#fff',
    }));
  },[seed]);
  return (
    <div className={`star-preview ${onClick ? 'clickable' : ''}`}
      onClick={onClick} role={onClick ? 'button' : 'img'} tabIndex={onClick ? 0 : undefined}
      onKeyDown={e => {if(onClick && (e.key === 'Enter' || e.key === ' ')){e.preventDefault();onClick();}}}
      aria-label="Representación estelar sintética. No es una observación SPHEREx">
      <svg viewBox="0 0 400 400" width="100%" height="100%" aria-hidden="true">
        <defs><radialGradient id={`glow-${seed.replace(/[^a-z0-9]/gi,'').slice(0,12)}`}>
          <stop offset="0" stopColor="#4d58bd" stopOpacity=".22"/>
          <stop offset="1" stopColor="#060a14" stopOpacity="0"/>
        </radialGradient></defs>
        <rect width="400" height="400" fill="#050710"/>
        <circle cx="200" cy="200" r="195" fill="#17234b" opacity=".15"/>
        {stars.map(s => <circle key={s.id} cx={s.x} cy={s.y} r={s.r} opacity={s.opacity} fill={s.color}/>)}
        {moving && <g className="moving-source"><circle cx="168" cy="228" r="9" fill="#86a9ff" opacity=".09"/>
          <circle cx="168" cy="228" r="2.9" fill="#ebf4ff" /></g>}
      </svg>
      <span className="preview-mark">{label}</span>
      {onClick && <span className="preview-open">Ver parpadeo ▶</span>}
    </div>
  );
}
