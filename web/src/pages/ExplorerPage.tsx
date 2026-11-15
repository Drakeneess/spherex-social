import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Pause, Play, Search, Save, Trash2 } from 'lucide-react';
import { api, ApiError, hasToken, type ObservationParams, type SkyFrame, type SkySearch } from '../lib/api';
import { formatDec, formatRa } from '../lib/coordinates';
import EpochCanvas, { type EpochMark } from '../components/EpochCanvas';
import SearchProgress, { type SearchTrace } from '../components/SearchProgress';

const presets = [
  { name: 'WISE 0855', ra: 133.795129, dec: -7.245147 },
  { name: "Barnard's Star", ra: 269.4521, dec: 4.6934 },
  { name: 'Luhman 16', ra: 162.299, dec: -53.318 },
];

type Params = {
  ra: number; dec: number; size: number; detector: number; frames: number; demo: boolean;
  catalogMethod: 'sia2' | 'tap';
};

export default function ExplorerPage({
  observationId, initialRa, initialDec, onPublish, onLogin, onProgress, onGoHome, active,
}: {
  observationId?: string;
  initialRa?: number;
  initialDec?: number;
  onPublish: (region: ObservationParams) => void;
  onLogin: () => void;
  onProgress: (status: {trace: SearchTrace | null;loading: boolean}) => void;
  onGoHome: () => void;
  active: boolean;
}) {
  const [ra, setRa] = useState('133.795129');
  const [dec, setDec] = useState('-7.245147');
  const [size, setSize] = useState('6');
  const [detector, setDetector] = useState('2');
  const [epochs, setEpochs] = useState('12');
  const [demo, setDemo] = useState(false);
  // The explorer uses the fast discovery method by default; TAP remains a backend fallback.
  const catalogMethod: 'sia2' | 'tap' = 'sia2';

  const [result, setResult] = useState<SkySearch | null>(null);
  const [frames, setFrames] = useState<Record<number, SkyFrame>>({});
  const [activeParams, setActiveParams] = useState<Params | null>(null);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(3);
  const [compare, setCompare] = useState(false);
  const [marks, setMarks] = useState<EpochMark[]>([]);
  const [loading, setLoading] = useState(false);
  const [trace, setTrace] = useState<SearchTrace | null>(null);
  const [retryUntil, setRetryUntil] = useState(0);
  const retryUntilRef = useRef(0);
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (retryUntil <= Date.now()) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryUntil]);
  const retrySeconds = Math.max(0, Math.ceil((retryUntil - nowTick) / 1000));
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);

  const controller = useRef<AbortController | null>(null);
  const remoteJob = useRef<string | null>(null);
  const available = useMemo(
    () => Object.keys(frames).map(Number).sort((a, b) => a - b),
    [frames],
  );
  const current = frames[position];
  const metadata = result?.observations[position];
  const loadedCount = available.length;

  useEffect(() => {
    onProgress({ trace, loading });
  }, [trace, loading, onProgress]);

  // Cycle only through frames that are actually available, never empty indices.
  useEffect(() => {
    if (!active || !playing || available.length < 2) return;
    const interval = window.setInterval(() => setPosition(previous => {
      return available.find(index => index > previous) ?? available[0];
    }), 1000 / fps);
    return () => window.clearInterval(interval);
  }, [active, playing, fps, available]);

  // This component remains mounted during in-app navigation.
  // Abort only when the whole application is actually unmounted.
  useEffect(() => () => {
    controller.current?.abort();
    if (remoteJob.current) void api.cancelSkyJob(remoteJob.current).catch(() => {});
  }, []);

  const load = useCallback(async (params: Params) => {
    if (!params.demo && params.catalogMethod === 'tap' &&
        Date.now() < retryUntilRef.current) {
      setError('TAP continúa en espera de reintento. Puedes buscar con SIA2 mientras tanto.');
      return;
    }
    controller.current?.abort();
    if (remoteJob.current) {
      void api.cancelSkyJob(remoteJob.current).catch(() => {});
      remoteJob.current = null;
    }
    const request = new AbortController();
    controller.current = request;
    const startedAt = Date.now();
    setLoading(true);
    retryUntilRef.current = 0;
    setRetryUntil(0);
    setTrace({
      phase: 'catalog', startedAt,
      source: params.demo ? 'simulated' : params.catalogMethod === 'tap' ? 'irsa' : 'sia2', frames: [],
    });
    setPlaying(false);
    setCompare(false);
    setPosition(0);
    setResult(null);
    setFrames({});
    setActiveParams(null);
    setMarks([]);
    setSavedId(null);
    setNotice('');
    setError('');

    const frameErrorMessage = (cause: unknown) =>
      cause instanceof Error ? cause.message.slice(0, 220) : 'Error inesperado';

    // Ignore stale state changes if a newer search replaced this request.
    const updateTrace = (fn: (old: SearchTrace) => SearchTrace) => {
      if (request.signal.aborted) return;
      setTrace(previous =>
        previous && previous.startedAt === startedAt ? fn(previous) : previous
      );
    };

    let fallbackFailure = '';
    let tapAttempted = false;
    try {
      const catalogStartedAt = Date.now();
      let search: SkySearch | null = null;
      if (params.demo) {
        search = await api.searchSky(params, request.signal);
      } else {
        if (params.catalogMethod === 'sia2') {
          try {
            search = await api.searchSia2(params, request.signal);
          } catch (cause) {
            if (request.signal.aborted) return;
            if (!(cause instanceof ApiError) || ![502, 503, 504].includes(cause.status)) {
              throw cause;
            }
            fallbackFailure = frameErrorMessage(cause);
            updateTrace(old => ({
              ...old, source: 'irsa', remotePhase: undefined,
              catalogWarning: 'La primera búsqueda no respondió. Estamos buscando por otra vía.',
            }));
          }
        }
        if (search === null) {
          // Exactly one TAP submission; never retry this non-idempotent POST.
          tapAttempted = true;
          const started = await api.startSkyJob(params, request.signal);
          if (request.signal.aborted) return;
          remoteJob.current = started.job_id;
          updateTrace(old => ({
            ...old, source: 'irsa', remotePhase: started.phase, tapTiming: started.timing,
          }));
          while (true) {
            if (request.signal.aborted) return;
            const snapshot = await api.pollSkyJob(started.job_id, request.signal);
            if (request.signal.aborted) return;
            updateTrace(old => ({
              ...old,
              remotePhase: snapshot.phase,
              remoteWarning: snapshot.warning,
              retryAfterSeconds: snapshot.retry_after_seconds,
              tapTiming: snapshot.timing ?? old.tapTiming,
            }));
            if (snapshot.phase === 'COMPLETED') {
              if (!snapshot.result) throw new Error('IRSA completó el trabajo sin devolver datos');
              search = snapshot.result;
              remoteJob.current = null;
              void api.cancelSkyJob(started.job_id).catch(() => {});
              break;
            }
            if (snapshot.phase === 'ERROR' || snapshot.phase === 'ABORTED') {
              throw new Error(snapshot.error ?? 'El trabajo TAP terminó sin resultados');
            }
            if (Date.now() - catalogStartedAt > 15 * 60_000) {
              throw new Error('El catálogo continúa procesando tras 15 minutos. Cancela o repite la búsqueda.');
            }
            await new Promise<void>((resolve, reject) => {
              const timer = window.setTimeout(() => {
                request.signal.removeEventListener('abort', onAbort);
                resolve();
              }, Math.max(2500, (snapshot.retry_after_seconds ?? 0) * 1000));
              const onAbort = () => {
                window.clearTimeout(timer);
                request.signal.removeEventListener('abort', onAbort);
                reject(new DOMException('Búsqueda cancelada', 'AbortError'));
              };
              request.signal.addEventListener('abort', onAbort, { once: true });
              if (request.signal.aborted) onAbort();
            });
          }
        }
      }
      if (!search) throw new Error('El catálogo no devolvió una respuesta válida');
      if (request.signal.aborted) return;
      const catalogMs = Date.now() - catalogStartedAt;
      setResult(search);
      setActiveParams(params);
      updateTrace(previous => ({
        ...previous,
        source: search.source,
        sia2Timing: search.discovery,
        phase: search.count > 0 ? 'frames' : 'empty',
        catalogMs,
        totalMatches: search.total_matches,
        count: search.count,
        frames: Array.from({ length: search.count }, (_, index) =>
          ({ index, status: 'pending' as const })),
        ...(search.count === 0 ? { finishedAt: Date.now() } : {}),
      }));
      if (search.count === 0) {
        setNotice('El catálogo consultado no devolvió épocas para este campo y detector.');
        return;
      }
      let cursor = 0;
      const failures: number[] = [];
      let successes = 0;

      // At most three independent /api/frame requests. The backend sends
      // completed PNGs, not intermediate FITS-processing events.
      const worker = async () => {
        while (!request.signal.aborted) {
          const index = cursor++;
          if (index >= search.count) return;
          const frameStartedAt = Date.now();
          updateTrace(previous => ({
            ...previous,
            frames: previous.frames.map(frame =>
              frame.index === index
                ? { ...frame, status: 'loading', startedAt: frameStartedAt }
                : frame
            ),
          }));
          try {
            const frame = await api.frame(search.search_id, index, request.signal);
            if (!request.signal.aborted) {
              setFrames(previous => ({ ...previous, [index]: frame }));
              successes += 1;
              updateTrace(previous => ({
                ...previous,
                frames: previous.frames.map(entry =>
                  entry.index === index
                    ? { ...entry, status: 'ready', durationMs: Date.now() - frameStartedAt, serverTiming: frame.timing_ms }
                    : entry
                ),
              }));
            }
          } catch (cause) {
            if (!request.signal.aborted) {
              failures.push(index);
              updateTrace(previous => ({
                ...previous,
                frames: previous.frames.map(entry =>
                  entry.index === index
                    ? {
                      ...entry, status: 'failed',
                      durationMs: Date.now() - frameStartedAt,
                      error: frameErrorMessage(cause),
                    }
                    : entry
                ),
              }));
            }
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(3, search.count) }, () => worker()),
      );
      if (request.signal.aborted) return;

      updateTrace(previous => ({
        ...previous,
        phase: successes === 0 ? 'failed' : failures.length ? 'partial' : 'complete',
        finishedAt: Date.now(),
      }));
      if (successes === 0) {
        setError('No pudimos preparar las imágenes de esta región. Puedes intentar otra búsqueda.');
      } else {
        if (failures.length) {
          setNotice(`${failures.length} de ${search.count} épocas no pudieron cargarse. Puedes consultar las disponibles.`);
        }
        if (successes >= 2) setPlaying(true);
      }
    } catch (cause) {
      if (remoteJob.current) {
        void api.cancelSkyJob(remoteJob.current).catch(() => {});
        remoteJob.current = null;
      }
      if (!request.signal.aborted) {
        const detail = frameErrorMessage(cause);
        if (tapAttempted && cause instanceof ApiError && cause.status === 503) {
          // Retry only after a separate user action. POST /TAP/async is not
          // idempotent and auto-retrying could create orphaned remote jobs.
          const deadline = Date.now() + 30_000;
          retryUntilRef.current = deadline;
          setRetryUntil(deadline);
          setNowTick(Date.now());
        }
        const friendly = 'No conseguimos recuperar las observaciones ahora. Puedes volver a intentarlo.';
        // Detailed errors remain available in developer instrumentation, not the public UI.
        console.warn('[AstroGram] Catalog search failed', { fallback: fallbackFailure, detail });
        setError(friendly);
        updateTrace(previous => ({
          ...previous, phase: 'failed', catalogError: friendly, finishedAt: Date.now(),
        }));
      }
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, []);

  function cancelSearch() {
    if (!controller.current || controller.current.signal.aborted) return;
    controller.current.abort();
    if (remoteJob.current) {
      void api.cancelSkyJob(remoteJob.current).catch(() => {});
      remoteJob.current = null;
    }
    setLoading(false);
    setPlaying(false);
    setTrace(previous => previous && ['catalog', 'frames'].includes(previous.phase)
      ? { ...previous, phase: 'cancelled', finishedAt: Date.now() }
      : previous);
    setNotice('Solicitud cancelada desde el navegador; las imágenes ya recibidas siguen disponibles.');
  }

  useEffect(() => {
    if (!observationId) return;
    let active = true;
    api.observation(observationId).then(saved => {
      if (!active) return;
      if (saved.detector == null) throw new Error('La observación no tiene detector');
      setRa(String(saved.ra_deg));
      setDec(String(saved.dec_deg));
      setSize(String(saved.fov_arcmin));
      setDetector(String(saved.detector));
      setDemo(false);
      void load({
        ra: saved.ra_deg, dec: saved.dec_deg, size: saved.fov_arcmin,
        detector: saved.detector, frames: 12, demo: false, catalogMethod: 'sia2',
      });
      setSavedId(saved.id);
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : 'Observación no encontrada');
    });
    return () => { active = false; };
  }, [observationId, load]);

  useEffect(() => {
    if (observationId || initialRa === undefined || initialDec === undefined) return;
    if (!Number.isFinite(initialRa) || !Number.isFinite(initialDec)) return;
    setRa(String(initialRa));
    setDec(String(initialDec));
    void load({ ra: initialRa, dec: initialDec, size: 6, detector: 2,
      frames: 12, demo: false, catalogMethod: 'sia2' });

  }, [observationId, initialRa, initialDec, load]);

  // Advance to the first loaded image even when a later epoch arrives first.
  useEffect(() => {
    if (available.length && !frames[position] && position === 0) {
      setPosition(available[0]);
    }
  }, [available, frames, position]);

  function readParams(): Params | null {
    if (![ra, dec, size, detector, epochs].every(value => value.trim() !== '')) {
      setError('Completa las coordenadas, el tamaño, detector y número de épocas.');
      return null;
    }
    const params = {
      ra: Number(ra), dec: Number(dec), size: Number(size),
      detector: Number(detector), frames: Number(epochs), demo, catalogMethod,
    };
    if (!Number.isFinite(params.ra) || params.ra < 0 || params.ra >= 360 ||
        !Number.isFinite(params.dec) || params.dec < -90 || params.dec > 90 ||
        !Number.isFinite(params.size) || params.size < 1 || params.size > 12 ||
        !Number.isInteger(params.detector) || params.detector < 1 || params.detector > 6 ||
        !Number.isInteger(params.frames) || params.frames < 2 || params.frames > 16) {
      setError('RA: 0–360°, Dec: −90–90°, tamaño: 1–12′, detector: 1–6 y épocas: 2–16.');
      return null;
    }
    return params;
  }
  function retrySearch() {
    const params = readParams();
    if (params) void load(params);
  }

  function runSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = readParams();
    if (params) void load(params);
  }
  function applyPreset(preset: (typeof presets)[number]) {
    setRa(String(preset.ra));
    setDec(String(preset.dec));
    const params = {
      ra: preset.ra, dec: preset.dec, size: Number(size),
      detector: Number(detector), frames: Number(epochs), demo, catalogMethod,
    };
    if (params.size >= 1 && params.size <= 12 && params.detector >= 1 &&
        params.detector <= 6 && Number.isInteger(params.frames) &&
        params.frames >= 2 && params.frames <= 16) {
      void load(params);
    }
  }

  function addMark(x: number, y: number) {
    if (!current) return;
    setMarks(previous => [
      ...previous.filter(mark => mark.index !== position),
      { index: position, x, y },
    ].sort((left, right) => left.index - right.index));
    setNotice(`Época ${position + 1}: posición marcada. ${marks.some(mark => mark.index === position) ? 'Marca reemplazada.' : 'Marca registrada.'}`);
  }

  async function saveRegion() {
    const params = readParams();
    if (!params) return;
    if (!hasToken()) { onLogin(); return; }
    setSaveBusy(true); setError('');
    try {
      const saved = await api.createObservation({
        ra_deg: params.ra, dec_deg: params.dec,
        fov_arcmin: params.size, detector: params.detector,
      });
      setSavedId(saved.id);
      setNotice('Región guardada en tu cuenta. Las marcas siguen siendo locales a esta sesión.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la región');
    } finally {
      setSaveBusy(false);
    }
  }

  function publish() {
    if (!activeParams || !result || loadedCount === 0) {
      setError('Primero realiza una búsqueda y carga al menos una época.');
      return;
    }
    if (!hasToken()) { onLogin(); return; }
    if (marks.length) setNotice('Las marcas no se guardan en PostgreSQL; solo se compartirán las coordenadas de la región.');
    onPublish({
      ra_deg: activeParams.ra,
      dec_deg: activeParams.dec,
      fov_arcmin: activeParams.size,
      detector: activeParams.detector,
    });
  }

  const badge = result
    ? `RA ${formatRa(result.ra)} · Dec ${formatDec(result.dec)}`
    : '–';
  return <main className="wrap single epoch-explorer" aria-hidden={!active ? true : undefined}>
    <div className="xgrid epoch-grid">
      <section className="card epoch-viewer">
        <div className="card-h"><span>🔭 Explorador de épocas</span><span className="chip">{badge}</span></div>
        <EpochCanvas key={result?.search_id ?? 'empty'} frame={current}
          previous={compare && position > 0 ? frames[position - 1] : undefined}
          index={position} total={result?.count ?? 0}
          marks={marks} onMark={addMark} metaLabel={metadata?.date}
          loading={loading} hasSearch={Boolean(result)}/>
        {error && <div className="epoch-inline-error" role="alert">{error}</div>}
        {notice && <div className="epoch-inline-note" role="status">{notice}</div>}
        <div className="xctrl epoch-playback">
          <button type="button" className="btn sm" aria-label={playing ? 'Pausar' : 'Reproducir'}
            disabled={available.length < 2} onClick={() => setPlaying(value => !value)}>
            {playing ? <Pause size={17} fill="currentColor"/> : <Play size={17} fill="currentColor"/>}
          </button>
          <input type="range" min={0} max={Math.max(0, (result?.count ?? 1) - 1)}
            value={position} disabled={!result?.count}
            aria-label={`Época ${position + 1}`}
            onChange={event => { setPlaying(false); setPosition(Number(event.target.value)); }}/>
          <select aria-label="Velocidad de reproducción" value={fps}
            onChange={event => setFps(Number(event.target.value))}>
            <option value={1}>1 fps</option><option value={3}>3 fps</option><option value={6}>6 fps</option>
          </select>
          <button type="button" className="btn sm" disabled={!marks.length} onClick={() => { setMarks([]); setNotice('Marcas borradas.'); }}>
            <Trash2 size={14}/> Borrar marcas
          </button>
        </div>
        <div className="epoch-player-foot">
          <span>{result ? `${loadedCount}/${result.count} épocas cargadas` : 'Sin búsqueda activa'}</span>
          <span>{result?.source === 'simulated' ? 'Simulación elegida por el usuario' : 'Datos IRSA · vista preliminar'}</span>
        </div>
        <div className="epoch-help">Las estrellas se quedan quietas; lo que se mueve es el hallazgo.
          Toca la imagen para <strong>marcar</strong> su posición en cada época.
          {result?.source !== 'simulated' && result &&
            ' Para comparar movimiento real, verifica la calidad y calibración de cada imagen.'}
        </div>
      </section>

      <aside className="epoch-side">
        <section className="card epoch-search-card">
          <div className="card-h"><span>Buscar en el cielo</span></div>
          <form className="xform epoch-search-form" onSubmit={runSearch}>
            <div className="quick">
              {presets.map(preset => <button key={preset.name} type="button"
                disabled={loading}
                onClick={() => applyPreset(preset)}>{preset.name}</button>)}
            </div>
            <div className="two">
              <div className="field"><label htmlFor="epoch-ra">RA (°, 0–360)</label>
                <input id="epoch-ra" type="number" step="any" min={0} max={359.999999}
                  required value={ra} onChange={event => setRa(event.target.value)}/></div>
              <div className="field"><label htmlFor="epoch-dec">Dec (°, −90–90)</label>
                <input id="epoch-dec" type="number" step="any" min={-90} max={90}
                  required value={dec} onChange={event => setDec(event.target.value)}/></div>
            </div>
            <div className="two">
              <div className="field"><label htmlFor="epoch-size">Tamaño (′, 1–12)</label>
                <input id="epoch-size" type="number" step="any" min={1} max={12}
                  required value={size} onChange={event => setSize(event.target.value)}/></div>
              <div className="field"><label htmlFor="epoch-detector">Detector (1–6)</label>
                <select id="epoch-detector" value={detector} onChange={event => setDetector(event.target.value)}>
                  {[1, 2, 3, 4, 5, 6].map(value => <option key={value} value={value}>{value}</option>)}
                </select></div>
            </div>
            <div className="two epoch-final-row">
              <div className="field"><label htmlFor="epoch-count">Épocas (2–16)</label>
                <input id="epoch-count" type="number" step={1} min={2} max={16}
                  required value={epochs} onChange={event => setEpochs(event.target.value)}/></div>
              <label className="epoch-demo"><input type="checkbox" checked={demo}
                onChange={event => setDemo(event.target.checked)}/> Vista de demostración</label>
            </div>
            <button className="btn p full" disabled={loading}
              type="submit">
              {loading ? <LoaderCircle size={15} className="spin"/> : <Search size={15}/>}
              {loading ? 'Procesando búsqueda…'
                : 'Buscar'}
            </button>
          </form>
          <div className="epoch-secondary-actions">
            <button type="button" className="btn epoch-publish" onClick={publish}>✦ Publicar este hallazgo</button>
            <button type="button" className="btn epoch-save" disabled={saveBusy} onClick={() => void saveRegion()}>
              <Save size={14}/> {saveBusy ? 'Guardando…' : 'Guardar región'}
            </button>
          </div>
          {savedId && <div className="epoch-saved">Región guardada: <code>{savedId}</code></div>}

        </section>
        <SearchProgress trace={trace} loading={loading} onCancel={cancelSearch}
          onRetry={retrySearch} onHome={onGoHome} retrySeconds={retrySeconds}/>
        <div className="epoch-science-note">
          Imágenes reales de NASA/IPAC IRSA, presentadas como vista preliminar.
          Cada detector abarca distintas longitudes de onda, y las imágenes pueden tener diferencias de calidad.
          Las marcas son personales y no se guardan automáticamente.
        </div>
        {result && <button type="button" className="epoch-compare btn sm"
          disabled={!frames[position - 1]} aria-pressed={compare} onClick={() => setCompare(value => !value)}>
          {compare ? '✓ ' : ''}Superponer época anterior
        </button>}
      </aside>
    </div>
  </main>;
}
