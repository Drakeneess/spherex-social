import { ArrowUpRight, CheckCircle2, LoaderCircle, Search, Telescope, XCircle } from 'lucide-react';
import type { SearchTrace } from './SearchProgress';

export type ExplorerBackgroundStatus = {
  trace: SearchTrace | null;
  loading: boolean;
};

export function progressSummary(trace: SearchTrace) {
  const total = trace.frames.length;
  const processed = trace.frames.filter(frame => frame.status === 'ready' || frame.status === 'failed').length;
  const ready = trace.frames.filter(frame => frame.status === 'ready').length;
  const failed = trace.frames.filter(frame => frame.status === 'failed').length;
  const searching = trace.phase === 'catalog';
  const inProgress = trace.phase === 'catalog' || trace.phase === 'frames';
  const percent = total ? Math.round(processed * 100 / total) : 0;
  const label = searching ? 'Buscando observaciones'
    : trace.phase === 'frames' ? 'Preparando imágenes del cielo'
      : trace.phase === 'complete' ? 'Tu búsqueda está lista'
        : trace.phase === 'partial' ? 'Búsqueda lista con imágenes pendientes'
          : trace.phase === 'empty' ? 'No se encontraron observaciones'
            : trace.phase === 'cancelled' ? 'Búsqueda cancelada'
              : 'No se pudo completar la búsqueda';
  const detail = searching ? 'Estamos localizando las observaciones disponibles'
    : trace.phase === 'frames' ? `${processed} de ${total} imágenes procesadas · ${ready} disponibles`
      : trace.phase === 'complete' ? `${ready} imágenes disponibles para explorar`
        : trace.phase === 'partial' ? `${ready} de ${total} imágenes disponibles · ${failed} no se pudieron recuperar`
          : trace.phase === 'empty' ? 'Prueba otra región o detector'
            : trace.phase === 'cancelled' ? 'Se conservan las imágenes ya recibidas'
              : ready > 0 ? `${ready} imágenes disponibles, pero la búsqueda se interrumpió`
                : 'Puedes intentarlo de nuevo desde el explorador';
  return { total, processed, ready, failed, searching, inProgress, percent, label, detail };
}

export default function BackgroundSkyDock({
  status, onOpen, onDismiss,
}: {
  status: ExplorerBackgroundStatus | null;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  if (!status?.trace) return null;
  const summary = progressSummary(status.trace);
  const active = status.loading && summary.inProgress;
  return <aside className={`sky-background-dock ${active ? 'sky-background-active' : ''}`}
    aria-label="Búsqueda del cielo en segundo plano" role="status" aria-live="polite">
    <div className="sky-background-main">
      <div className="sky-background-icon" aria-hidden="true">
        {active ? <LoaderCircle size={20} className="spin"/> :
          status.trace.phase === 'failed' ? <XCircle size={20}/> :
            status.trace.phase === 'complete' || status.trace.phase === 'partial'
              ? <CheckCircle2 size={20}/> : <Telescope size={20}/>}
      </div>
      <div className="sky-background-copy">
        <strong>{summary.label}</strong>
        <span>{summary.detail}</span>
      </div>
      <button className="sky-background-dismiss" type="button" onClick={onDismiss}
        aria-label="Ocultar aviso de búsqueda"><span aria-hidden="true">×</span></button>
    </div>
    {active && <div className={`sky-background-track ${summary.searching ? 'indeterminate' : ''}`}
      role="progressbar" aria-label="Progreso de la búsqueda"
      aria-valuemin={summary.searching ? undefined : 0}
      aria-valuemax={summary.searching ? undefined : summary.total}
      aria-valuenow={summary.searching ? undefined : summary.processed}
      aria-valuetext={summary.searching ? 'Buscando observaciones'
        : `${summary.processed} de ${summary.total} imágenes procesadas`}>
      <span style={summary.searching ? undefined : { width: `${summary.percent}%` }}/>
    </div>}
    <button type="button" className="sky-background-return" onClick={onOpen}>
      {active ? <Search size={15}/> : <Telescope size={15}/>}
      {active ? 'Volver al explorador' : 'Ver mi búsqueda'}
      <ArrowUpRight size={15}/>
    </button>
  </aside>;
}
