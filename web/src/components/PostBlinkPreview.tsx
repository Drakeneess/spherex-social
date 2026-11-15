import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, CirclePause, CirclePlay, LoaderCircle, Telescope } from 'lucide-react';
import { api, type PersistentSkyJob, type SkyFrame, type RevealRecipe } from '../lib/api';

type ReadyFrame = { index: number; date: string | null };
const DONE = new Set(['complete', 'partial', 'empty', 'failed', 'cancelled']);

function readableDate(date: string | null): string {
  if (!date) return 'Fecha no disponible';
  const parsed = new Date(date.endsWith('Z') ? date : `${date}Z`);
  if (!Number.isFinite(parsed.getTime())) return date.slice(0, 10);
  return new Intl.DateTimeFormat('es', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(parsed);
}

function picks(job: PersistentSkyJob): ReadyFrame[] {
  const ready = job.frames
    .filter(frame => frame.status === 'ready')
    .map(frame => frame.index)
    .sort((a, b) => a - b);
  if (!ready.length) return [];
  const byIndex = new Map(job.result?.observations.map(obs => [obs.index, obs.date]) ?? []);
  const selected = ready.length > 1 ? [ready[0], ready[ready.length - 1]] : [ready[0]];
  return selected.map(index => ({index, date: byIndex.get(index) ?? null}));
}

export default function PostBlinkPreview({
  postId, onExplore,
}: {
  postId: string;
  onExplore: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<Record<number, SkyFrame>>({});
  const [images, setImages] = useState<Record<number, SkyFrame>>({});
  const [visible, setVisible] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [job, setJob] = useState<PersistentSkyJob | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [blinkIndex, setBlinkIndex] = useState(0);
  const [playing, setPlaying] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [attempt, setAttempt] = useState(0);
  const [revealFallback,setRevealFallback] = useState(false);
  const linkedRecipe = useRef<RevealRecipe|null>(null);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      setVisible(entries[0]?.isIntersecting ?? false);
    }, {threshold: .06, rootMargin: '180px'});
    observer.observe(node);
    const visibility = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    visibility();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const signal = controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wait = (duration: number) => new Promise<void>(resolve => {
      timer = window.setTimeout(resolve, duration);
      signal.addEventListener('abort', () => {
        if (timer !== undefined) clearTimeout(timer);
        resolve();
      }, {once:true});
    });
    const hydrate = async (state: PersistentSkyJob) => {
      const wanted = picks(state);
      await Promise.allSettled(wanted.map(async choice => {
        if (imagesRef.current[choice.index]) return;
        const frame = await api.getPersistentSkyFrame(state.job_id, choice.index, signal);
        if (signal.aborted) return;
        const recipe = linkedRecipe.current;
        if (recipe) {
          try {
            const styled = await api.revealSkyFrame(state.job_id, choice.index, recipe, signal);
            frame.image = styled.image;
          } catch (error) {
            // Legacy jobs may have only 8-bit PNGs. Preserve the original
            // scientifically labeled preview rather than inventing pixels.
            if (signal.aborted) return;
            setRevealFallback(true);
          }
        }
        if (signal.aborted) return;
        imagesRef.current[choice.index] = frame;
        setImages({...imagesRef.current});
      }));
    };
    const run = async () => {
      try {
        setIsLoading(true);
        setError('');
        // POST is intentionally idempotent: an old publication may need a
        // single stored background job; all subsequent visits reuse that job.
        const linked = await api.preparePostBlink(postId, signal);
        if (signal.aborted) return;
        linkedRecipe.current = linked.display_recipe;
        setRevealFallback(false);
        while (!signal.aborted) {
          try {
            const state = await api.getPersistentSkyJob(linked.job_id, signal);
            if (signal.aborted) return;
            setJob(state);
            await hydrate(state);
            if (DONE.has(state.status)) break;
          } catch (cause) {
            if (signal.aborted) return;
            console.warn('[AstroGram] Preview will reconnect', cause instanceof Error ? cause.name : 'unknown');
          }
          await wait(4800);
        }
        if (!signal.aborted) setIsLoading(false);
      } catch (cause) {
        if (signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'No se pudo cargar la vista');
        setIsLoading(false);
      }
    };
    // Only the visible card owns this request sequence.
    void run();
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [visible, postId, attempt]);

  const wanted = job ? picks(job) : [];
  const available = wanted.filter(item => Boolean(images[item.index]));
  const canBlink = available.length >= 2;
  useEffect(() => {
    if (!playing || !visible || !tabVisible || !canBlink) return;
    const timer = window.setInterval(() => setBlinkIndex(value => (value + 1) % 2), 1100);
    return () => window.clearInterval(timer);
  }, [playing, visible, tabVisible, canBlink]);
  const shown = available[Math.min(blinkIndex, available.length - 1)] ?? available[0];
  const picture = shown ? images[shown.index] : null;
  const terminal = job ? DONE.has(job.status) : false;
  const failed = terminal && !picture;
  const selectedDate = shown?.date ?? null;
  const readyCount = job?.frames.filter(frame => frame.status === 'ready').length ?? 0;
  const unavailable = Boolean(error || failed);
  const unavailableTitle = job?.status === 'empty'
    ? 'Sin imágenes en esta región'
    : job?.status === 'cancelled'
      ? 'La búsqueda fue cancelada'
      : 'La vista aún no está disponible';
  const unavailableDescription = job?.status === 'empty'
    ? 'No se encontraron épocas para generar una vista. La observación sigue guardada.'
    : 'La observación sigue guardada. Puedes consultarla en el explorador.';

  return <div ref={root} className={[
    'post-blink-preview',
    picture ? 'has-picture' : 'is-placeholder',
    unavailable ? 'is-unavailable' : '',
    linkedRecipe.current ? `format-${linkedRecipe.current.format}` : '',
  ].filter(Boolean).join(' ')} aria-label="Parpadeo astronómico de la publicación">
    {picture && <img className={`post-blink-photo ${linkedRecipe.current&&!revealFallback?'is-revealed':''}`} src={picture.image}
      alt={`Fotograma astronómico real, época ${shown.index + 1}, ${readableDate(selectedDate)}`}
      decoding="async" />}
    {!picture && <div className="post-blink-placeholder">
      {error || failed
        ? <>
          <Telescope size={28} aria-hidden="true"/>
          <strong>{unavailableTitle}</strong>
          <span>{unavailableDescription}</span>
        </>
        : <>
          <LoaderCircle size={27} className="spin" aria-hidden="true"/>
          <strong>Preparando el parpadeo</strong>
          <span>{readyCount ? `${readyCount} imágenes disponibles · buscando otra época`
            : 'Recuperando imágenes reales de esta región'}</span>
        </>}
    </div>}
    <div className="post-blink-top">
      <span className="post-blink-chip"><span className="post-blink-dot"/> SPHEREx · NASA/IPAC</span>
      {job && <span className="post-blink-chip">D{job.query.detector}</span>}
    </div>
    <div className="post-blink-bottom">
      <div className="post-blink-description" aria-live="off">
        <strong>{canBlink ? 'Parpadeo entre épocas' : picture ? 'Observación disponible' : unavailable ? 'Observación guardada' : 'Vista astronómica'}</strong>
        <span>{picture ? `Época ${shown.index + 1} de ${job?.result?.count ?? '?'} · ${readableDate(selectedDate)}`
          : unavailable ? 'Sin vista previa · sin datos simulados' : 'Vista preliminar · sin movimiento simulado'}</span>
        {canBlink && <small>Alternando dos observaciones reales</small>}
        {linkedRecipe.current && <small>{revealFallback
          ? 'Vista original (revelado no disponible)'
          : 'Falso color · revelado artístico sobre datos reales'}</small>}
      </div>
      <div className="post-blink-controls">
        {canBlink && <button type="button" className="post-blink-control"
          aria-label={playing ? 'Pausar parpadeo' : 'Reproducir parpadeo'}
          onClick={() => setPlaying(value => !value)}>
          {playing ? <CirclePause size={25}/> : <CirclePlay size={25}/>}
        </button>}
        {(error || failed) && <button type="button" className="post-blink-retry"
          onClick={() => { setError(''); setAttempt(value => value + 1); }}>
          Reintentar
        </button>}
        <button type="button" className="post-blink-open" onClick={onExplore}
          title="Abrir región en el explorador">
          <ArrowUpRight size={19}/> <span>Explorar</span>
        </button>
      </div>
    </div>
    {canBlink && <div className="post-blink-epoch-indicators" aria-hidden="true">
      {available.map(frame => <span
        key={frame.index} className={shown.index === frame.index ? 'active' : ''}/>)}
    </div>}
    {!visible && isLoading && <span className="sr-only">Vista pendiente de cargar cuando esté visible</span>}
    <span className="sr-only">Fotogramas astronómicos de vista preliminar. El parpadeo no confirma movimiento propio.</span>
  </div>;
}
