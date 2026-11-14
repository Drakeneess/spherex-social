import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronLeft, ChevronRight, CircleAlert, Database, ExternalLink, Layers, LoaderCircle, Pause, Play, Search, Sparkles } from 'lucide-react';

type Observation = { index: number; date: string; release: string; mjd: number };
type SearchResponse = {
  search_id: string; source: 'simulated' | 'irsa'; total_matches: number;
  count: number; ra: number; dec: number; detector: number; observations: Observation[];
};
type Frame = { image: string; wavelength_um: number | null; bandwidth_um: number | null; pixel_flags_nonzero_fraction: number | null; mode: 'real' | 'simulated'; index: number; date: string; release: string };
const presets = [
  { name: 'WISE 0855', description: 'Enana marrón de movimiento rápido', ra: 133.795129, dec: -7.245147 },
  { name: "Estrella de Barnard", description: 'Alto movimiento propio', ra: 269.4521, dec: 4.6934 },
];
const API = '/api';

export default function App() {
  const [ra, setRa] = useState('133.795129');
  const [dec, setDec] = useState('-7.245147');
  const [size, setSize] = useState('6');
  const [detector, setDetector] = useState('2');
  const [demo, setDemo] = useState(true);
  const [searchResult, setSearchResult] = useState<SearchResponse | null>(null);
  const [frames, setFrames] = useState<Record<number, Frame>>({});
  const [selected, setSelected] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [blink, setBlink] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abort = useRef<AbortController | null>(null);

  const count = searchResult?.count ?? 0;
  const available = Object.keys(frames).map(Number).sort((a, b) => a - b);
  const current = frames[selected];
  const predecessor = frames[selected - 1];
  const loaded = available.length;

  useEffect(() => {
    if (!playing || available.length < 2) return;
    const interval = window.setInterval(() => {
      setSelected((prev) => {
        const pos = available.indexOf(prev);
        return available[(pos + 1 + available.length) % available.length];
      });
    }, 600);
    return () => window.clearInterval(interval);
  }, [playing, loaded]);

  useEffect(() => () => abort.current?.abort(), []);

  async function startSearch() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setLoading(true); setError(''); setSearchResult(null); setFrames({}); setSelected(0);
    setPlaying(false); setBlink(false);
    try {
      const q = new URLSearchParams({ ra, dec, size_arcmin: size, detector, max_frames: '12', demo: String(demo) });
      const result = await fetch(`${API}/search?${q}`, { signal: controller.signal });
      const data = await result.json();
      if (!result.ok) throw new Error(data.detail || 'No se pudo consultar IRSA');
      const search: SearchResponse = data;
      setSearchResult(search);
      if (search.count === 0) { setLoading(false); return; }
      // Bounded sequential download: respect IRSA and show frames progressively.
      for (let i = 0; i < search.count; i++) {
        if (controller.signal.aborted) break;
        const response = await fetch(`${API}/frame/${encodeURIComponent(search.search_id)}/${i}`, { signal: controller.signal });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          throw new Error(`Fotograma ${i + 1}: ${failure.detail || 'Error al descargar FITS'}`);
        }
        const frame: Frame = await response.json();
        setFrames(previous => ({ ...previous, [i]: frame }));
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function showPrevious() {
    if (count > 0) { setPlaying(false); setSelected(v => Math.max(0, v - 1)); }
  }
  function showNext() {
    if (count > 0) { setPlaying(false); setSelected(v => Math.min(count - 1, v + 1)); }
  }

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-icon"><Sparkles size={20}/></div>
          <div><strong>SPHEREx</strong><span>TIME EXPLORER</span></div></div>
        <div className="top-right"><span className="status-dot"/> NASA OPEN DATA <span className="header-divider"/> <span>PROTOTYPE / 0.1</span></div>
      </header>

      <main>
        <section className="intro">
          <div className="eyebrow"><Activity size={15}/> ASTRONOMICAL TIME DOMAIN EXPLORER</div>
          <h1>El universo no está <em>quieto.</em></h1>
          <p>Explora observaciones infrarrojas de SPHEREx a lo largo del tiempo. Busca coordenadas, reproduce imágenes del cielo y examina qué cambia.</p>
        </section>

        <div className="workspace">
          <aside className="panel controls">
            <div className="panel-heading"><Search size={16}/> <h2>Buscar región</h2></div>
            <div className="field-pair">
              <label>Ascensión recta (°)<input type="number" min="0" max="359.99999" step="any" value={ra} onChange={e => setRa(e.target.value)}/></label>
              <label>Declinación (°)<input type="number" min="-90" max="90" step="any" value={dec} onChange={e => setDec(e.target.value)}/></label>
            </div>
            <div className="field-pair">
              <label>Campo de visión<select value={size} onChange={e => setSize(e.target.value)}>
                <option value="2">2 arcmin</option><option value="4">4 arcmin</option><option value="6">6 arcmin</option><option value="8">8 arcmin</option><option value="12">12 arcmin</option>
              </select></label>
              <label>Detector<select value={detector} onChange={e => setDetector(e.target.value)}>
                {[1, 2, 3, 4, 5, 6].map(i => <option key={i} value={i}>SPHEREx-D{i}</option>)}
              </select></label>
            </div>
            <div className="option-row"><div><strong>Modo de prueba</strong><span>Fotogramas sintéticos (sin datos NASA)</span></div><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)}/></div>
            <button className="primary" onClick={startSearch} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={17}/> : <Search size={17}/>} {loading ? 'Consultando y cargando…' : demo ? 'Probar animación' : 'Buscar en IRSA'}
            </button>
            <div className="section-separator"/>
            <h3>OBJETOS DE PRUEBA</h3>
            {presets.map(p => <button className="preset" key={p.name} onClick={() => {setRa(String(p.ra)); setDec(String(p.dec));}}>
              <span className="preset-star">✦</span><span><strong>{p.name}</strong><small>{p.description}</small></span><ChevronRight size={16}/>
            </button>)}
            <p className="hint">Coordenadas ICRS/J2000 de referencia. Para objetos de alto movimiento propio conviene considerar su posición en la época observada.</p>
          </aside>

          <section className="panel viewer-panel">
            <div className="viewer-heading"><div><span className="viewer-title">VISUALIZADOR CELESTE</span><h2>{searchResult ? `${searchResult.ra.toFixed(5)}° / ${searchResult.dec.toFixed(5)}°` : 'Selecciona una región del cielo'}</h2></div>
              <span className={`source-badge ${searchResult?.source === 'simulated' ? 'sim' : ''}`}>{!searchResult ? 'SIN DATOS' : searchResult.source === 'simulated' ? 'SIMULACIÓN' : 'IRSA · DR1/QR3'}</span>
            </div>
            <div className="sky-container">
              <div className="crosshair crosshair-h"/><div className="crosshair crosshair-v"/>
              {current ? <div className="image-frame">
                {blink && predecessor && <img className="sky-image reference" src={predecessor.image} alt="Fotograma anterior superpuesto"/>}
                <img className={`sky-image ${blink && predecessor ? 'overlay' : ''}`} src={current.image} alt={`Campo infrarrojo observado ${current.date}`}/>
                {searchResult?.source === 'simulated' && <span className="watermark">SIMULATED DATA · NOT NASA</span>}
              </div> : <div className="empty-state"><div className="empty-icon"><Layers size={34}/></div>
                <strong>{loading ? 'Descargando observaciones…' : searchResult?.count === 0 ? 'No se encontraron observaciones' : 'Tu ventana al cielo'}</strong>
                <span>{loading ? 'Los recortes FITS se procesan uno por uno.' : searchResult?.count === 0 ? 'Prueba otro detector o campo.' : 'Busca un objetivo o activa el modo de prueba.'}</span>
              </div>}
              <div className="compass"><span>N ↑</span><span>E ←</span></div>
            </div>
            <div className="playback">
              <div className="player-top"><strong>SECUENCIA TEMPORAL</strong><span>{loaded} / {count} fotogramas cargados</span></div>
              <input aria-label="Fotograma actual" type="range" min="0" max={Math.max(0, count - 1)} step="1" value={selected} disabled={count === 0} onChange={e => {setPlaying(false); setSelected(Number(e.target.value));}}/>
              <div className="playback-bottom"><div className="transport">
                <button aria-label="Anterior" onClick={showPrevious} disabled={selected <= 0}><ChevronLeft size={21}/></button>
                <button aria-label={playing ? 'Pausar' : 'Reproducir'} className="play-button" onClick={() => setPlaying(v => !v)} disabled={available.length < 2}>{playing ? <Pause size={19}/> : <Play size={19}/>}</button>
                <button aria-label="Siguiente" onClick={showNext} disabled={selected >= count - 1}><ChevronRight size={21}/></button>
                <span className="timeline-date">{current?.date?.replace('T', ' ').slice(0, 19) || '—'}</span>
              </div>
                <button className={`blink-button ${blink ? 'active' : ''}`} disabled={!predecessor || !current} onClick={() => setBlink(v => !v)}><Layers size={15}/> Superponer anterior</button>
              </div>
            </div>
          </section>

          <aside className="panel metadata">
            <div className="panel-heading"><Database size={16}/><h2>Información</h2></div>
            <div className="metric"><span>FUENTE DE DATOS</span><strong>{searchResult ? searchResult.source === 'simulated' ? 'Datos sintéticos' : 'NASA/IPAC · IRSA' : '—'}</strong></div>
            <div className="metric"><span>OBSERVACIONES ENCONTRADAS</span><strong>{searchResult?.total_matches ?? '—'}</strong></div>
            <div className="metric"><span>PRODUCTO</span><strong>{current?.release ?? '—'}</strong></div>
            <div className="metric"><span>DETECTOR</span><strong>{searchResult ? `D${searchResult.detector}` : '—'}</strong></div>
            <div className="metric"><span>LONGITUD DE ONDA CENTRAL</span><strong>{current?.wavelength_um != null ? `${current.wavelength_um.toFixed(4)} μm` : '—'}</strong></div>
            <div className="metric"><span>ANCHO DE BANDA</span><strong>{current?.bandwidth_um != null ? `${current.bandwidth_um.toFixed(4)} μm` : '—'}</strong></div>
            <div className="metric"><span>FECHA DE OBSERVACIÓN</span><strong>{current?.date?.slice(0, 10) ?? '—'}</strong></div>
            <div className="science-note"><CircleAlert size={18}/><div><strong>Importante</strong><p>Vista preliminar. La escala de brillo se ajusta por imagen y seleccionar un detector no garantiza la misma longitud de onda. No utilizar para afirmar variabilidad física sin calibración adicional.</p></div></div>
            <a className="external-link" href="https://irsa.ipac.caltech.edu/Missions/spherex.html" target="_blank" rel="noopener noreferrer">Archivo oficial de SPHEREx <ExternalLink size={14}/></a>
          </aside>
        </div>
        {error && <div className="error"><CircleAlert size={18}/>{error}</div>}
        <footer>Visualización experimental independiente · Datos SPHEREx cortesía de NASA/IPAC/IRSA · No afiliado ni respaldado por NASA.</footer>
      </main>
    </div>
  );
}
