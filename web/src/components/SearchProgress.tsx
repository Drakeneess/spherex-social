import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, XCircle } from 'lucide-react';
import type { FrameTiming, TapTiming } from '../lib/api';

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
  source: 'irsa' | 'simulated';
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
};

function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const statusLabel: Record<SearchTrace['phase'], string> = {
  catalog: 'Buscando coincidencias',
  frames: 'Recuperando imágenes',
  complete: 'Búsqueda finalizada',
  partial: 'Finalizada con errores parciales',
  empty: 'Sin resultados',
  failed: 'No se pudo completar',
  cancelled: 'Cancelada en este navegador',
};

function Marker({ done, bad, active }: { done?: boolean; bad?: boolean; active?: boolean }) {
  if (bad) return <XCircle size={17} color="#ff9aa7" aria-hidden="true"/>;
  if (done) return <CheckCircle2 size={17} color="#8fe8ad" aria-hidden="true"/>;
  if (active) return <LoaderCircle size={17} className="spin" aria-hidden="true"/>;
  return <Clock3 size={17} aria-hidden="true"/>;
}

export default function SearchProgress({
  trace, loading, onCancel, onRetry, retrySeconds,
}: {
  trace: SearchTrace | null;
  loading: boolean;
  onCancel: () => void;
  onRetry: () => void;
  retrySeconds: number;
}) {
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!trace || !loading) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [trace?.startedAt, loading]);

  if (!trace) return null;
  const finished = trace.frames.filter(frame => frame.status === 'ready' || frame.status === 'failed').length;
  const successful = trace.frames.filter(frame => frame.status === 'ready').length;
  const failed = trace.frames.filter(frame => frame.status === 'failed').length;
  const inFlight = trace.frames.filter(frame => frame.status === 'loading').length;
  const catalogDone = trace.catalogMs !== undefined;
  const catalogActive = trace.phase === 'catalog';
  const catalogBad = trace.phase === 'failed' && !catalogDone;
  const framesActive = trace.phase === 'frames';
  const completed = ['complete', 'partial', 'empty'].includes(trace.phase);
  const elapsedMs = Math.max(0, (loading ? now : trace.finishedAt ?? now) - trace.startedAt);
  const total = trace.frames.length;
  const percent = total ? Math.round(finished / total * 100) : 0;
  const timing = trace.tapTiming;
  const phaseLabels: Record<string, string> = {
    QUEUED: 'En cola (observado)',
    EXECUTING: 'Ejecutando (observado)',
    PENDING: 'Pendiente (observado)',
    HELD: 'Retenido (observado)',
    SUSPENDED: 'Suspendido (observado)',
    UNKNOWN: 'Desconocido (observado)',
    COMPLETED: 'Completado, incluida recuperación',
  };
  const frameStageLabels: {key:keyof FrameTiming;name:string}[] = [
    {key:'apertura_fits',name:'Abrir FITS'},
    {key:'lectura_pixeles',name:'Leer píxeles'},
    {key:'reproyeccion',name:'Reproyectar'},
    {key:'metadatos',name:'Metadatos'},
    {key:'png',name:'Generar PNG'},
  ];
  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({
        source: trace.source,
        catalog_ms_browser: trace.catalogMs ?? null,
        total_ms_browser: (trace.finishedAt ?? Date.now()) - trace.startedAt,
        total_matches: trace.totalMatches ?? null,
        catalog_phase: trace.remotePhase ?? null,
        tap_timing: trace.tapTiming ?? null,
        frames: trace.frames,
      }, null, 2));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return <section className="irsa-progress" aria-label="Progreso de búsqueda">
    <div className="irsa-progress-heading">
      <div>
        <strong>Estado de la consulta</strong>
        <span className="irsa-progress-phase" role="status" aria-live="polite">{statusLabel[trace.phase]}</span>
      </div>
      <div className="irsa-progress-elapsed"><Clock3 size={14}/> {duration(elapsedMs)}</div>
    </div>
    <ol className="irsa-progress-steps">
      <li>
        <Marker done={catalogDone} bad={catalogBad} active={catalogActive}/>
        <div>
          <b>1. Catálogo {trace.source === 'irsa' ? 'NASA/IPAC IRSA' : 'de demostración'}</b>
          <p>{catalogActive ? (trace.remotePhase === 'RETRYING'
              ? `${trace.remoteWarning ?? 'El servidor IRSA no respondió.'} Reintento en ${trace.retryAfterSeconds ?? '?'} s; el trabajo sigue conservado.`
              : trace.remotePhase
                ? `Trabajo TAP asíncrono: ${trace.remotePhase}. Consultando IRSA cada 2,5 s.`
                : 'Enviando consulta al catálogo TAP…') :
            catalogBad ? (trace.catalogError ?? 'La consulta no devolvió resultados válidos.') :
            catalogDone ? `${trace.totalMatches ?? 0} coincidencias encontradas · ${duration(trace.catalogMs!)}` :
            'Pendiente'}</p>
        </div>
      </li>
      <li>
        <Marker done={completed && !failed} bad={trace.phase === 'failed' && catalogDone}
          active={framesActive}/>
        <div>
          <b>2. Fotogramas FITS y procesamiento</b>
          <p>{!catalogDone ? 'Pendiente de los resultados del catálogo' :
            total === 0 ? 'No hay épocas que procesar' :
            `${finished}/${total} solicitudes finalizadas · ${successful} listas · ${failed} fallidas · ${inFlight} en curso`}</p>
          {catalogDone && total > 0 && <>
            <div className="irsa-progress-meter" role="progressbar" aria-valuenow={finished}
              aria-valuemin={0} aria-valuemax={total}
              aria-label="Solicitudes de fotogramas finalizadas">
              <span style={{width:`${percent}%`}}/>
            </div>
            <small className="irsa-progress-explain">
              {percent}% de respuestas completadas, no del procesamiento interno. Cada solicitud incluye descarga del recorte, tratamiento FITS y conversión a PNG.
            </small>
          </>}
        </div>
      </li>
      <li>
        <Marker done={successful > 0} bad={trace.phase === 'failed' && successful === 0}
          active={false}/>
        <div>
          <b>3. Imágenes disponibles en el visor</b>
          <p>{successful ? `${successful} ${successful === 1 ? 'imagen recibida' : 'imágenes recibidas'} para visualizar` :
            'Aún no se recibió ninguna imagen'}</p>
        </div>
      </li>
    </ol>
    {timing && <details className="irsa-timing-details">
      <summary>Desglose TAP · {timing.poll_count} sondeos</summary>
      <dl className="irsa-timing-grid">
        <dt>Crear trabajo (POST)</dt><dd>{duration(timing.submit_ms)}</dd>
        <dt>Iniciar ejecución (RUN)</dt><dd>{duration(timing.run_ms)}</dd>
        {Object.entries(timing.phase_observed_ms).map(([phase, ms]) => <div
          key={phase} className="irsa-timing-pair">
          <dt>{phaseLabels[phase] ?? `${phase} (observado)`}</dt><dd>{duration(ms)}</dd>
        </div>)}
        <dt>Red: consulta de estado (acumulado)</dt><dd>{duration(timing.phase_http_ms)}</dd>
        {timing.result_fetch_ms !== null && <><dt>Recuperar tabla</dt><dd>{duration(timing.result_fetch_ms)}</dd></>}
        {timing.result_parse_ms !== null && <><dt>Validar y preparar observaciones</dt><dd>{duration(timing.result_parse_ms)}</dd></>}
        <dt>Sondeos fallidos</dt><dd>{timing.poll_errors} / {timing.poll_count}</dd>
      </dl>
      <p className="irsa-progress-disclaimer">Los tiempos de fase son intervalos entre estados
        observados en sondeos, no tiempos exactos de CPU de IRSA. La duración de red
        está incluida en esos intervalos; <strong>no deben sumarse todas las filas.</strong></p>
      <div className="irsa-phase-events">
        {timing.phase_events.map((event, index) => <span key={index}>
          {event.phase} · {duration(event.at_ms)}{index < timing.phase_events.length - 1 ? ' → ' : ''}
        </span>)}
      </div>
    </details>}
    {total > 0 && <details className="irsa-frame-details">
      <summary>Detalles por época ({finished}/{total})</summary>
      <div className="irsa-frame-list">
        {trace.frames.map(frame => <div key={frame.index} className="irsa-frame-entry">
          <span>Época {frame.index + 1}</span>
          <span className={`irsa-frame-${frame.status}`}>
            {frame.status === 'pending' ? 'En cola' :
              frame.status === 'loading' ? 'Esperando servidor' :
              frame.status === 'ready' ? 'Lista' : 'Error'}
          </span>
          <span>{frame.durationMs !== undefined ? duration(frame.durationMs) :
            frame.startedAt ? duration(Math.max(0, now - frame.startedAt)) : '—'}</span>
          {frame.error && <span className="irsa-frame-error" title={frame.error}><AlertCircle size={12}/> {frame.error}</span>}
          {frame.serverTiming && <span className="irsa-frame-server">
            Servidor: {duration(frame.serverTiming.total)} · {frameStageLabels.map(
              ({key, name}) => `${name}: ${duration(frame.serverTiming![key])}`
            ).join(' · ')}
          </span>}
        </div>)}
      </div>
    </details>}
    {!loading && (catalogDone || trace.phase === 'failed') &&
      <button type="button" className="btn sm irsa-diagnostic-copy" onClick={() => void copyDiagnostic()}>
        {copied ? 'Diagnóstico copiado' : 'Copiar diagnóstico JSON'}
      </button>}
    {loading && <button type="button" className="btn sm irsa-cancel" onClick={onCancel}>
      Cancelar búsqueda
    </button>}
    {trace.phase === 'failed' && !loading && <div className="irsa-retry-actions">
      <p>Si IRSA no acepta nuevos trabajos, la creación no se repite automáticamente para evitar duplicados.</p>
      <button type="button" className="btn sm" onClick={onRetry}
        disabled={retrySeconds > 0}>
        {retrySeconds > 0 ? `Volver a intentar en ${retrySeconds} s` : 'Volver a intentar la búsqueda'}
      </button>
    </div>}
    <p className="irsa-progress-disclaimer">
      El total es el tiempo observado por tu navegador; las etapas TAP se miden en FastAPI.
      Cancelar detiene las solicitudes del navegador, pero el procesamiento remoto puede continuar
      temporalmente si IRSA ya lo inició.
    </p>
  </section>;
}
