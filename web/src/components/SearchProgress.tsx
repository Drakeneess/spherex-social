import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, LoaderCircle, Orbit, XCircle } from 'lucide-react';
import type { FrameTiming, Sia2Discovery, TapTiming } from '../lib/api';
import { progressSummary } from './BackgroundSkyDock';

export type FrameState = 'pending' | 'loading' | 'ready' | 'failed';
export type FrameTrace = {
  index: number;
  status: FrameState;
  startedAt?: number;
  durationMs?: number;
  error?: string;
  serverTiming?: FrameTiming;
};
export type SearchTrace = {
  phase: 'catalog' | 'frames' | 'complete' | 'partial' | 'empty' | 'failed' | 'cancelled';
  startedAt: number;
  source: 'irsa' | 'simulated' | 'sia2';
  catalogMs?: number;
  totalMatches?: number;
  count?: number;
  frames: FrameTrace[];
  catalogError?: string;
  finishedAt?: number;
  remotePhase?: string;
  remoteWarning?: string;
  retryAfterSeconds?: number;
  tapTiming?: TapTiming;
  sia2Timing?: Sia2Discovery;
  catalogWarning?: string;
};

export default function SearchProgress({
  trace, loading, onCancel, onRetry, onHome, retrySeconds,
}: {
  trace: SearchTrace | null;
  loading: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onHome: () => void;
  retrySeconds: number;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!trace || !loading) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [trace?.startedAt, loading]);
  if (!trace) return null;

  const summary = progressSummary(trace);
  const active = loading && summary.inProgress;
  const isWaiting = active && summary.searching;
  const seconds = Math.max(0, Math.floor(((active ? now : trace.finishedAt ?? now) - trace.startedAt) / 1000));
  const timeLabel = seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
  const finished = ['complete', 'partial', 'empty', 'failed', 'cancelled'].includes(trace.phase);
  const isReal = trace.source !== 'simulated';

  return <section className={`sky-search-progress ${active ? 'is-active' : ''}`}
    aria-label="Estado de tu exploración">
    <div className="sky-search-heading">
      <div className="sky-search-symbol" aria-hidden="true">
        {active ? <Orbit size={22} className="sky-search-orbit"/> :
          trace.phase === 'failed' ? <XCircle size={22}/> : <CheckCircle2 size={22}/>}
      </div>
      <div className="sky-search-heading-copy">
        <strong>{summary.label}</strong>
        <span>{active ? 'Tu búsqueda continúa incluso si visitas Inicio.' :
          finished ? 'Los resultados permanecerán aquí mientras sigas en AstroGram.' : 'Explorando el cielo'}</span>
      </div>
      <span className="sky-search-time"><Clock3 size={13}/>{timeLabel}</span>
    </div>
    {(active || trace.phase === 'complete' || trace.phase === 'partial') &&
      <div className={`sky-search-track ${isWaiting ? 'is-indeterminate' : ''}`}
        role="progressbar" aria-label="Avance de la búsqueda"
        aria-valuemin={isWaiting ? undefined : 0}
        aria-valuemax={isWaiting ? undefined : summary.total}
        aria-valuenow={isWaiting ? undefined : summary.processed}
        aria-valuetext={isWaiting ? 'Buscando observaciones'
          : `${summary.processed} de ${summary.total} imágenes procesadas`}>
        <span style={isWaiting ? undefined : {width: `${summary.percent}%`}}/>
      </div>}
    <p className="sky-search-detail">{summary.detail}</p>
    {active && !isWaiting && summary.ready > 0 &&
      <p className="sky-search-subtle">Ya puedes explorar las imágenes que están disponibles.</p>}
    {trace.phase === 'partial' &&
      <p className="sky-search-subtle">Algunas imágenes no pudieron obtenerse; las disponibles se conservaron.</p>}
    {trace.phase === 'failed' &&
      <p className="sky-search-subtle" role="alert">No fue posible completar esta búsqueda. Puedes intentarlo nuevamente.</p>}
    <div className="sky-search-actions">
      {active && <>
        <button type="button" className="btn p sm" onClick={onHome}>Seguir explorando Inicio <ArrowRight size={14}/></button>
        <button type="button" className="btn sm sky-search-quiet" onClick={onCancel}>Cancelar</button>
      </>}
      {trace.phase === 'failed' && !loading &&
        <button type="button" className="btn p sm" onClick={onRetry} disabled={retrySeconds > 0}>
          {retrySeconds > 0 ? `Reintentar en ${retrySeconds} s` : 'Intentar otra vez'}
        </button>}
    </div>
    <p className="sky-search-credibility">
      {isReal ? 'Observaciones reales · NASA/IPAC IRSA' : 'Vista de demostración · imágenes simuladas'}
      {isReal && ' · Vista preliminar: la disponibilidad de cada imagen puede variar.'}
    </p>
  </section>;
}
