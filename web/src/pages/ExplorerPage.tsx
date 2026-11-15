import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LoaderCircle, Pause, Play, Search, Save, Trash2 } from 'lucide-react';
import { api, hasToken, type ObservationParams, type PersistentSkyJob, type SkyFrame, type SkySearch, DEFAULT_REVEAL, type RevealRecipe } from '../lib/api';
import { formatDec, formatRa } from '../lib/coordinates';
import EpochCanvas, { type EpochMark } from '../components/EpochCanvas';
import AstroGlyph from '../components/AstroGlyph';
import SearchProgress, { type SearchTrace } from '../components/SearchProgress';
import { signalTask, signalNudge } from '../lib/onboarding';
import RevealEditor from '../components/RevealEditor';

const CURRENT_SKY_JOB = 'astrogram.sky.active.v1';
const terminalStatuses = new Set(['complete', 'partial', 'empty', 'failed', 'cancelled']);
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
  onPublish: (region: ObservationParams & {sky_job_id?:string;display_recipe?:RevealRecipe}) => void;
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
  // Persistent searches have no user-visible expiration countdown.
  const retrySeconds = 0;
  const [saveBusy, setSaveBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savedId, setSavedId] = useState<string | null>(null);
  const [revealRecipe,setRevealRecipe] = useState<RevealRecipe>({...DEFAULT_REVEAL});
  const [revealEnabled,setRevealEnabled] = useState(true);
  const [skyState,setSkyState] = useState<PersistentSkyJob|null>(null);

  const controller = useRef<AbortController | null>(null);
  const activeJobId = useRef<string | null>(null);
  const loadedFrames = useRef<Record<number, SkyFrame>>({});
  const inFlightFrames = useRef(new Set<number>());
  const available = useMemo(
    () => Object.keys(frames).map(Number).sort((a, b) => a - b),
    [frames],
  );
  const current = frames[position];
  const metadata = result?.observations[position];
  const loadedCount = available.length;
  const revealable = available.filter(index =>
    skyState?.frames.some(frame=>frame.index===index&&frame.raw_available));
  const rawAvailable = revealable.length>0;
  // Live playback can advance faster than the server render debounce.
  // Keep the editorial preview on one stable frame while animation runs.
  const revealPreviewIndex = playing ? (revealable[0] ?? position) : position;

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

  // Disconnecting a browser watcher never cancels the server-side job.
  useEffect(() => () => { controller.current?.abort(); }, []);

  const watchSearch = useCallback((jobId: string, params: Params) => {
    if (activeJobId.current === jobId && controller.current &&
        !controller.current.signal.aborted) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    activeJobId.current = jobId;
    loadedFrames.current = {};
    inFlightFrames.current.clear();
    setLoading(true);
    setTrace({
      phase: 'catalog', startedAt: Date.now(),
      source: params.demo ? 'simulated' : 'sia2', frames: [],
    });
    setResult(null);
    setFrames({});
    setSkyState(null);
    setRevealRecipe({...DEFAULT_REVEAL});
    setRevealEnabled(true);
    setActiveParams(params);
    setMarks([]);
    setCompare(false);
    setPlaying(false);
    setPosition(0);
    setError('');
    setNotice('');
    setSavedId(null);
    setDemo(params.demo);
    setRa(String(params.ra));
    setDec(String(params.dec));
    setSize(String(params.size));
    setDetector(String(params.detector));
    setEpochs(String(params.frames));

    const hydrateFrame = (index: number) => {
      if (loadedFrames.current[index] || inFlightFrames.current.has(index)) return Promise.resolve();
      inFlightFrames.current.add(index);
      return api.getPersistentSkyFrame(jobId, index, request.signal)
        .then(frame => {
          if (request.signal.aborted || activeJobId.current !== jobId) return;
          loadedFrames.current = { ...loadedFrames.current, [index]: frame };
          setFrames(previous => ({ ...previous, [index]: frame }));
        }).catch(() => {
          // The image remains marked ready on the server. The next poll, or
          // reopening the search, can safely retry its retrieval.
        }).finally(() => { inFlightFrames.current.delete(index); });
    };

    const run = async () => {
      let networkFailures = 0;
      let lastSnapshot: PersistentSkyJob | null = null;
      try {
        // A stable UUID makes concurrent tab POSTs idempotent.
        await api.createPersistentSkyJob(jobId, params, request.signal);
        while (!request.signal.aborted) {
          try {
            const state = await api.getPersistentSkyJob(jobId, request.signal);
            if (request.signal.aborted) return;
            networkFailures = 0;
            lastSnapshot = state;
            if(state.source==='sia2' && state.result && state.frames.some(frame=>frame.status==='ready'))
              signalTask('explore');
            setSkyState(state);
            const fromQuery = state.query;
            const completed = terminalStatuses.has(state.status);
            const phase = state.status === 'queued' || state.status === 'catalog'
              ? 'catalog' : state.status as SearchTrace['phase'];
            const frameTrace = state.frames.map(item => ({
              index: item.index,
              status: item.status,
              ...(item.error ? {error: item.error} : {}),
            }));
            setTrace({
              phase, source: state.source,
              startedAt: Date.parse(state.created_at) || Date.now(),
              ...(completed ? {finishedAt: Date.parse(state.updated_at) || Date.now()} : {}),
              totalMatches: state.total_matches ?? undefined,
              count: state.result?.count,
              catalogMs: state.result ? state.discovery?.elapsed_ms ?? 0 : undefined,
              frames: frameTrace,
            });
            if (state.result) {
              setResult(state.result);
              setActiveParams({
                ra: fromQuery.ra, dec: fromQuery.dec,
                size: fromQuery.size_arcmin, detector: fromQuery.detector,
                frames: fromQuery.max_frames, demo: fromQuery.demo,
                catalogMethod: 'sia2',
              });
            }
            const pending = state.frames
              .filter(item => item.status === 'ready' && !loadedFrames.current[item.index])
              .map(item => item.index);
            // The server continues rendering even if this tab is hidden.
            // Client hydration is bounded independently of its workers.
            await Promise.allSettled(pending.slice(0, 3).map(hydrateFrame));
            if (completed) {
              if (state.status === 'empty') setNotice('No se encontraron observaciones en esta región.');
              else if (state.status === 'partial') setNotice('Algunas imágenes no pudieron recuperarse.');
              else if (state.status === 'failed') setError('No pudimos completar esta búsqueda. Inténtalo de nuevo.');
              const ready = state.frames.filter(item => item.status === 'ready').length;
              if (ready >= 2 && state.status !== 'cancelled') setPlaying(true);
              setLoading(false);
              // Remaining image assets can still hydrate from a completed job.
              const rest = state.frames
                .filter(item => item.status === 'ready' && !loadedFrames.current[item.index])
                .map(item => item.index);
              await Promise.allSettled(rest.map(hydrateFrame));
              return;
            }
            await new Promise<void>(resolve => {
              const timer = window.setTimeout(() => {
                request.signal.removeEventListener('abort', onAbort);
                resolve();
              }, 2200);
              const onAbort = () => {
                window.clearTimeout(timer);
                request.signal.removeEventListener('abort', onAbort);
                resolve();
              };
              request.signal.addEventListener('abort', onAbort, {once:true});
              if (request.signal.aborted) onAbort();
            });
          } catch (cause) {
            if (request.signal.aborted) return;
            networkFailures++;
            if (cause instanceof Error) console.warn('[AstroGram] Waiting to reconnect to sky job', cause.name);
            setNotice('Conexión interrumpida. Tu búsqueda sigue guardada; intentando reconectar.');
            await new Promise(resolve => window.setTimeout(resolve, Math.min(15000, 2000 * networkFailures)));
          }
        }
      } catch (cause) {
        if (request.signal.aborted) return;
        console.warn('[AstroGram] Could not open sky job', cause);
        setError('No pudimos abrir tu búsqueda guardada. Inténtalo de nuevo.');
        setTrace(previous => previous ? {...previous, phase:'failed',finishedAt:Date.now()} : previous);
        setLoading(false);
      } finally {
        // Do not abort the job or erase localStorage when the tab leaves.
        if (!request.signal.aborted && lastSnapshot && terminalStatuses.has(lastSnapshot.status)) {
          setLoading(false);
        }
      }
    };
    void run();
  }, []);

  const load = useCallback((params: Params) => {
    const jobId = crypto.randomUUID();
    const value = JSON.stringify({jobId, params});
    // Save *before* the network request. Reopening the tab can safely retry
    // the idempotent POST even if this tab closes midway through creation.
    localStorage.setItem(CURRENT_SKY_JOB, value);
    watchSearch(jobId, params);
  }, [watchSearch]);

  function cancelSearch() {
    const id = activeJobId.current;
    if (!id) return;
    void api.cancelPersistentSkyJob(id).catch(() =>
      setNotice('No pudimos confirmar la cancelación; vuelve a intentarlo.'));
    // Keep monitoring until the server confirms cancellation, including
    // across tabs. Aborting a watcher would make the state ambiguous.
  }

  useEffect(() => {
    const attachFromStorage = () => {
      try {
        const raw = localStorage.getItem(CURRENT_SKY_JOB);
        if (!raw) return;
        const parsed = JSON.parse(raw) as {jobId?:string;params?:Params};
        if (typeof parsed.jobId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(parsed.jobId) ||
            !parsed.params) return;
        if (activeJobId.current !== parsed.jobId) watchSearch(parsed.jobId, parsed.params);
      } catch {
        // Older/malformed localStorage entries must not interrupt the app.
      }
    };
    if (!observationId && (initialRa === undefined || initialDec === undefined)) {
      attachFromStorage();
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key === CURRENT_SKY_JOB && event.newValue) attachFromStorage();
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [watchSearch, observationId, initialRa, initialDec]);

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
    }).catch(() => {
      if (active) setError('No pudimos abrir esta región guardada. Intenta nuevamente.');
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
    const replacing=marks.some(mark=>mark.index===position);
    const nextMarks=[
      ...marks.filter(mark=>mark.index!==position),
      {index:position,x,y},
    ].sort((left,right)=>left.index-right.index);
    setMarks(nextMarks);
    if(nextMarks.length>=2){
      // Two distinct epochs are necessary for the visual trajectory mission.
      signalTask('mark');
      setNotice(`${nextMarks.length} épocas marcadas. La línea punteada une las posiciones que seleccionaste; no confirma movimiento.`);
    }else{
      setNotice(`Época ${position+1}: ${replacing?'marca actualizada':'posición marcada'}. Cambia de época y marca el mismo objeto para trazar su trayectoria.`);
      if(!replacing)signalNudge('mark');
    }
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
      setNotice('Región guardada en tu cuenta. Tus marcas siguen en esta sesión.');
    } catch {
      setError('No pudimos guardar la región. Intenta nuevamente.');
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
    if (marks.length) setNotice('Compartirás la región, pero no las marcas realizadas sobre cada imagen.');
    onPublish({
      ra_deg: activeParams.ra,
      dec_deg: activeParams.dec,
      fov_arcmin: activeParams.size,
      detector: activeParams.detector,
      ...(activeParams.demo ? {} : {sky_job_id: activeJobId.current ?? undefined}),
      ...(!activeParams.demo && rawAvailable && revealEnabled
          ? {display_recipe:{...revealRecipe}} : {}),
    });
  }

  const badge = result
    ? `RA ${formatRa(result.ra)} · Dec ${formatDec(result.dec)}`
    : '–';
  return <main className="wrap single epoch-explorer" aria-hidden={!active ? true : undefined}>
    <div className="xgrid epoch-grid">
      <section className="card epoch-viewer">
        <div className="card-h"><span><AstroGlyph name="telescope" size={17}/> Explorador de épocas</span><span className="chip">{badge}</span></div>
        <div data-tour="explore-canvas"><EpochCanvas key={result?.search_id ?? 'empty'} frame={current}
          previous={compare && position > 0 ? frames[position - 1] : undefined}
          index={position} total={result?.count ?? 0}
          marks={marks} onMark={addMark} metaLabel={metadata?.date}
          loading={loading} hasSearch={Boolean(result)}/></div>
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
          <span>{result?.source === 'simulated' ? 'Imágenes simuladas · demostración' : 'NASA/IPAC · vista preliminar'}</span>
          {marks.length>0&&<span aria-live="polite">
            {marks.length===1?'1 época marcada · marca otra para trazar':`${marks.length} épocas marcadas · trayectoria visual`}
          </span>}
        </div>
        <div className="epoch-help">Marca manualmente la posición del mismo objeto en dos épocas para dibujar
          una <strong>trayectoria punteada</strong>. Esta herramienta no detecta ni confirma movimiento por sí sola.
          Las marcas son temporales y todavía no se incluyen al publicar.
        </div>
      </section>

      <aside className="epoch-side">
        <section className="card epoch-search-card">
          <div className="card-h"><span>Buscar en el cielo</span></div>
          <form className="xform epoch-search-form" onSubmit={runSearch}>
            <div className="quick" data-tour="explore-presets">
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
            <button type="button" data-tour="explore-publish" className="btn epoch-publish" onClick={publish}>✦ Publicar este hallazgo</button>
            <button type="button" className="btn epoch-save" disabled={saveBusy} onClick={() => void saveRegion()}>
              <Save size={14}/> {saveBusy ? 'Guardando…' : 'Guardar región'}
            </button>
          </div>
          {savedId && <div className="epoch-saved">✓ Región guardada en tu cuenta</div>}

        </section>
        {result?.source !== 'simulated' && result && <RevealEditor
          active={active} jobId={activeJobId.current}
          index={revealPreviewIndex} rawAvailable={Boolean(skyState?.frames.find(f=>f.index===revealPreviewIndex)?.raw_available)}
          hasRaw={rawAvailable} searching={loading} recipe={revealRecipe}
          onChange={recipe=>{setPlaying(false);setRevealRecipe(recipe)}}
          enabled={revealEnabled} onEnabled={setRevealEnabled}/>}
        <SearchProgress trace={trace} loading={loading} onCancel={cancelSearch}
          onRetry={retrySearch} onHome={onGoHome} retrySeconds={retrySeconds}/>
        <div className="epoch-science-note">
          {result?.source === 'simulated'
            ? 'Demostración con imágenes simuladas: no son observaciones de NASA.'
            : 'Las búsquedas reales consultan observaciones NASA/IPAC IRSA. La vista es preliminar y la calidad puede variar entre imágenes.'}
          {' '}Las marcas son personales y no se guardan automáticamente.
        </div>
        {result && <button type="button" className="epoch-compare btn sm"
          disabled={!frames[position - 1]} aria-pressed={compare} onClick={() => setCompare(value => !value)}>
          {compare ? '✓ ' : ''}Superponer época anterior
        </button>}
      </aside>
    </div>
  </main>;
}
