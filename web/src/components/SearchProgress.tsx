import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, LoaderCircle, XCircle } from 'lucide-react';

export type FrameState = 'pending' | 'loading' | 'ready' | 'failed';
export type FrameTrace = {
  index: number;
  status: FrameState;
  startedAt?: number;
  durationMs?: number;
  error?: string;
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
  trace, loading, onCancel,
}: {
  trace: SearchTrace | null;
  loading: boolean;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());
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
          <p>{catalogActive ? 'Esperando respuesta de /api/search. El servidor consulta el catálogo TAP; no transmite porcentajes internos.' :
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
        </div>)}
      </div>
    </details>}
    {loading && <button type="button" className="btn sm irsa-cancel" onClick={onCancel}>
      Cancelar búsqueda
    </button>}
    <p className="irsa-progress-disclaimer">
      El tiempo mostrado es el observado por tu navegador. Cancelar detiene las solicitudes del navegador,
      pero un procesamiento ya iniciado podría continuar temporalmente en Railway.
    </p>
  </section>;
}
