import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Database, ExternalLink, LoaderCircle, Pause, Play, Save, Search, Telescope } from 'lucide-react';
import { api, hasToken, type ObservationParams, type SkyFrame, type SkySearch } from '../lib/api';

const presets = [
  {name:'WISE 0855',ra:133.795129,dec:-7.245147},
  {name:"Estrella de Barnard",ra:269.4521,dec:4.6934},
  {name:'Luhman 16',ra:162.299,dec:-53.318},
];
type Params = {ra:number;dec:number;size:number;detector:number;demo:boolean};
export default function ExplorerPage({observationId,initialRa,initialDec,onPublish,onLogin}: {
  observationId?:string;
  initialRa?:number;
  initialDec?:number;
  onPublish:(region:ObservationParams)=>void;
  onLogin:()=>void;
}) {
  const [ra,setRa] = useState('133.795129');
  const [dec,setDec] = useState('-7.245147');
  const [size,setSize] = useState('6');
  const [detector,setDetector] = useState('2');
  const [demo,setDemo] = useState(true);
  const [result,setResult] = useState<SkySearch|null>(null);
  const [frames,setFrames] = useState<Record<number,SkyFrame>>({});
  const [position,setPosition] = useState(0);
  const [playing,setPlaying] = useState(false);
  const [blink,setBlink] = useState(false);
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [savedId,setSavedId] = useState<string|null>(null);
  const controller = useRef<AbortController|null>(null);
  const available = Object.keys(frames).map(Number).sort((a,b)=>a-b);
  const current = frames[position];
  const prev = frames[position-1];
  useEffect(()=>{
    if(!playing || available.length<2)return;
    const clock=window.setInterval(()=>setPosition(p=>{
      const idx=available.indexOf(p);return available[(idx+1+available.length)%available.length];
    }),680);
    return ()=>window.clearInterval(clock);
  },[playing,available.join(',')]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  useEffect(()=>{if(!observationId && initialRa!==undefined && initialDec!==undefined){setRa(String(initialRa));setDec(String(initialDec));}},[observationId,initialRa,initialDec]);

  const load = useCallback(async (params:Params)=>{
    controller.current?.abort();
    const signalController = new AbortController();
    controller.current=signalController;
    setLoading(true);setError('');setResult(null);setFrames({});
    setPosition(0);setPlaying(false);setBlink(false);
    try{
      const search=await api.searchSky(params,signalController.signal);
      if(signalController.signal.aborted)return;
      setResult(search);
      for(let i=0;i<search.count;i++){
        if(signalController.signal.aborted)break;
        try{
          const frame=await api.frame(search.search_id,i,signalController.signal);
          if(!signalController.signal.aborted)setFrames(prevFrames=>({...prevFrames,[i]:frame}));
        }catch(e){
          if(signalController.signal.aborted)break;
          setError(e instanceof Error?`Época ${i+1}: ${e.message}`:'Error al cargar fotograma');
          break;
        }
      }
    }catch(e){if(!signalController.signal.aborted)setError(e instanceof Error?e.message:'Error al consultar IRSA');}
    finally{if(!signalController.signal.aborted)setLoading(false);}
  },[]);

  useEffect(()=>{
    if(!observationId)return;
    let active=true;
    api.observation(observationId).then(saved=>{
      if(!active)return;
      if(saved.detector==null)throw new Error('La observación no especifica detector');
      setRa(String(saved.ra_deg));setDec(String(saved.dec_deg));
      setSize(String(saved.fov_arcmin));setDetector(String(saved.detector));
      setDemo(false);setSavedId(saved.id);
      void load({ra:saved.ra_deg,dec:saved.dec_deg,size:saved.fov_arcmin,detector:saved.detector,demo:false});
    }).catch(e=>{if(active)setError(e instanceof Error?e.message:'No se encontró la observación');});
    return ()=>{active=false;controller.current?.abort();};
  },[observationId,load]);

  function readParams():Params|null{
    const p={ra:Number(ra),dec:Number(dec),size:Number(size),detector:Number(detector),demo};
    if(!Number.isFinite(p.ra)||p.ra<0||p.ra>=360||!Number.isFinite(p.dec)||Math.abs(p.dec)>90||
      !Number.isFinite(p.size)||p.size<1||p.size>12||!Number.isInteger(p.detector)||p.detector<1||p.detector>6){
      setError('Verifica RA (0–360°), Dec (−90 a 90°), campo de visión (1–12′) y detector (1–6).');return null;
    }
    return p;
  }
  function runSearch(event?:FormEvent){
    event?.preventDefault();
    const p=readParams();if(!p)return;
    setSavedId(null);void load(p);
  }
  async function saveRegion(){
    const p=readParams();if(!p)return;
    if(!hasToken()){onLogin();return;}
    try{
      const saved=await api.createObservation({ra_deg:p.ra,dec_deg:p.dec,fov_arcmin:p.size,detector:p.detector});
      setSavedId(saved.id);setError('');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar la región');}
  }
  const field:ObservationParams={
    ra_deg:Number(ra),dec_deg:Number(dec),fov_arcmin:Number(size),detector:Number(detector),
  };
  return <main className="wrap single">
    <div className="explore-heading"><div><div className="eyebrow"><Telescope size={16}/> EXPLORADOR TEMPORAL</div>
      <h1>El universo no está <span className="grad">quieto.</span></h1>
      <p>Compara observaciones de una región del cielo entre distintas épocas.</p></div>
      <a target="_blank" rel="noopener noreferrer" href="https://irsa.ipac.caltech.edu/Missions/spherex.html" className="link-official">NASA/IPAC IRSA <ExternalLink size={15}/></a>
    </div>
    <div className="xgrid">
      <section className="card">
        <div className="card-h"><span>🔭 Visualizador celeste</span><span className="chip">{result?.source==='simulated'?'SIMULACIÓN':result?'IRSA · Vista preliminar':'SIN DATOS'}</span></div>
        <div className="xview">
          {current?<div className="real-frame">
            {blink&&prev&&<img alt="Fotograma anterior" src={prev.image} className="reference-img"/>}
            <img alt={`Observación del ${current.date}`} src={current.image} className={blink&&prev?'overlay-img':''}/>
            {result?.source==='simulated'&&<span className="watermark">DATOS SINTÉTICOS · NO NASA</span>}
          </div>:<div className="x-placeholder"><Telescope size={54}/>
            <strong>{loading?'Descargando fotogramas…':result?.count===0?'Sin observaciones en esta región':'Tu ventana al cielo'}</strong>
            <small>{loading?'Procesando recortes FITS…':'Busca coordenadas o prueba la secuencia simulada.'}</small></div>}
        </div>
        <div className="xctrl">
          <button className="btn sm" disabled={position===0} onClick={()=>{setPlaying(false);setPosition(p=>Math.max(p-1,0));}} aria-label="Anterior"><ChevronLeft size={18}/></button>
          <button className="btn sm" disabled={available.length<2} onClick={()=>setPlaying(v=>!v)} aria-label={playing?'Pausar':'Reproducir'}>{playing?<Pause size={17}/>:<Play size={17}/>}</button>
          <button className="btn sm" disabled={position>=(result?.count??0)-1} onClick={()=>{setPlaying(false);setPosition(p=>p+1);}} aria-label="Siguiente"><ChevronRight size={18}/></button>
          <input type="range" min={0} max={Math.max(0,(result?.count??1)-1)} value={position} disabled={!result?.count}
            onChange={e=>{setPlaying(false);setPosition(Number(e.target.value));}} aria-label="Época"/>
          <span className="player-date">{current?.date?.slice(0,10)??'—'}</span>
          <button className="btn sm" disabled={!prev} onClick={()=>setBlink(v=>!v)}>{blink?'Ocultar':'Superponer'} anterior</button>
        </div>
        <div className="xnote">{result?.source==='simulated'?'Datos sintéticos solo para probar la interfaz.':
          'Vista orientativa: detector ≠ banda monocromática; no extraigas conclusiones científicas sin calibración.'}</div>
      </section>
      <aside className="x-side">
        <form className="card xform" onSubmit={runSearch}>
          <div className="card-h xform-heading"><span><Search size={16}/> Buscar región</span></div>
          <div className="quick">{presets.map(item=><button type="button" key={item.name} onClick={()=>{setRa(String(item.ra));setDec(String(item.dec));}}>{item.name}</button>)}</div>
          <div className="two">
            <div className="field"><label htmlFor="ra">Ascensión recta · RA (°)</label><input id="ra" type="number" required step="any" min="0" max="359.999999" value={ra} onChange={e=>setRa(e.target.value)}/></div>
            <div className="field"><label htmlFor="dec">Declinación · Dec (°)</label><input id="dec" type="number" required step="any" min="-90" max="90" value={dec} onChange={e=>setDec(e.target.value)}/></div>
            <div className="field"><label htmlFor="fov">Campo de visión</label><select id="fov" value={size} onChange={e=>setSize(e.target.value)}>
              {[2,4,6,8,12].map(i=><option key={i} value={i}>{i}′</option>)}</select></div>
            <div className="field"><label htmlFor="det">Detector</label><select id="det" value={detector} onChange={e=>setDetector(e.target.value)}>
              {[1,2,3,4,5,6].map(i=><option key={i} value={i}>D{i}</option>)}</select></div>
          </div>
          <label className="toggle-demo"><input type="checkbox" checked={demo} onChange={e=>setDemo(e.target.checked)}/> Modo demo (datos sintéticos)</label>
          <button type="submit" className="btn p full" disabled={loading}>{loading?<LoaderCircle className="spin" size={15}/>:<Search size={15}/>}
            {loading?'Consultando…':demo?'Probar animación':'Buscar en IRSA'}</button>
          <div className="form-extras"><button type="button" className="btn sm" onClick={()=>void saveRegion()}><Save size={15}/> Guardar región</button>
            <button type="button" className="btn sm" onClick={()=>{if(!readParams())return;onPublish(field)}}>✦ Publicar</button></div>
          {savedId&&<p className="hint">Región guardada: <code>{savedId}</code></p>}
          {error&&<p className="form-error" role="alert">{error}</p>}
        </form>
        <div className="card info-panel">
          <div className="card-h"><span><Database size={15}/> Metadatos</span></div>
          <div className="sec"><div className="row"><span>Fuente</span><b>{result?.source==='simulated'?'Simulada':result?'NASA/IPAC':'—'}</b></div>
            <div className="row"><span>Fotogramas</span><b>{available.length}/{result?.count??0}</b></div>
            <div className="row"><span>Época</span><b>{current?.release??'—'}</b></div>
            <div className="row"><span>Longitud de onda</span><b>{current?.wavelength_um!=null?`${current.wavelength_um.toFixed(3)} μm`:'—'}</b></div></div>
        </div>
      </aside>
    </div>
    <p className="footnote"><ArrowLeft size={13}/> Cada búsqueda real consulta el archivo IRSA. La región guardada solo conserva los parámetros, no las imágenes.</p>
  </main>;
}
