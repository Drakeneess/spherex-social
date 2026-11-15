import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal, LoaderCircle, RotateCcw } from 'lucide-react';
import { api, DEFAULT_REVEAL, type RevealRecipe } from '../lib/api';

type Props = {
  active:boolean;jobId:string|null;index:number;rawAvailable:boolean;hasRaw:boolean;
  recipe:RevealRecipe;onChange:(recipe:RevealRecipe)=>void;
  enabled:boolean;onEnabled:(value:boolean)=>void;
};
const paletteNames:Record<RevealRecipe['palette'],string> = {
  gray:'Blanco y negro',cyan:'Cian estelar',violet:'Nebulosa violeta',
  ember:'Ámbar infrarrojo',custom:'Personalizada',
};
const renderFormats:Record<RevealRecipe['format'],string> = {
  square:'Cuadrado 1:1',portrait:'Vertical 4:5',wide:'Panorámico 16:9',
};

export default function RevealEditor({active,jobId,index,rawAvailable,hasRaw,recipe,onChange,enabled,onEnabled}:Props){
  const [image,setImage]=useState('');
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const cache=useRef(new Map<string,string>());
  const key=JSON.stringify([jobId,index,recipe]);
  useEffect(()=>{
    if(!active||!enabled||!jobId||!rawAvailable){setLoading(false);return;}
    const cached=cache.current.get(key);
    if(cached){setImage(cached);setError('');setLoading(false);return;}
    const controller=new AbortController();
    setLoading(true);setError('');setImage('');
    const timer=window.setTimeout(()=>{
      api.revealSkyFrame(jobId,index,recipe,controller.signal)
        .then(result=>{
          if(controller.signal.aborted)return;
          if(cache.current.size>16)cache.current.clear();
          cache.current.set(key,result.image);
          setImage(result.image);
        })
        .catch(cause=>{
          if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Revelado no disponible');
        })
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },350);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[active,enabled,jobId,index,rawAvailable,key,recipe]);
  function change<K extends keyof RevealRecipe>(field:K,value:RevealRecipe[K]){
    onChange({...recipe,[field]:value});
  }
  return <section className="card reveal-editor" aria-label="Estudio de revelado astronómico">
    <div className="card-h"><span><SlidersHorizontal size={17}/> Revelado</span><span className="chip">FITS · no destructivo</span></div>
    {!hasRaw?<div className="reveal-no-data">
      Los PNG anteriores no conservan los valores originales. Realiza una búsqueda nueva
      para editar color, contraste y formato desde los datos FITS.
    </div>:<>
      <label className="reveal-toggle"><input type="checkbox" checked={enabled}
        onChange={event=>onEnabled(event.target.checked)}/> Aplicar este revelado al publicar</label>
      {enabled&&<>
        <div className={`reveal-stage format-${recipe.format}`}>
          {rawAvailable&&image&&!error?<img src={image} alt="Revelado preliminar en falso color" decoding="async" />:
            <div className="reveal-empty">{loading?<><LoaderCircle size={18} className="spin"/> Revelando…</>:
              rawAvailable?'Elige los ajustes para previsualizar':'Esta época no tiene FITS editables'}</div>}
        </div>
        {error&&<p className="reveal-error" role="status">{error}</p>}
        <div className="reveal-controls">
          <label>Paleta<select value={recipe.palette} onChange={e=>change('palette',e.target.value as RevealRecipe['palette'])}>
            {Object.entries(paletteNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}
          </select></label>
          {recipe.palette==='custom'&&<div className="reveal-colors">
            <label>Sombras<input type="color" value={recipe.shadow} onChange={e=>change('shadow',e.target.value)}/></label>
            <label>Luces<input type="color" value={recipe.highlight} onChange={e=>change('highlight',e.target.value)}/></label>
          </div>}
          <label>Curva tonal<select value={recipe.stretch} onChange={e=>change('stretch',e.target.value as RevealRecipe['stretch'])}>
            <option value="asinh">Asinh · estrellas y fondo</option>
            <option value="linear">Lineal</option><option value="log">Logarítmica</option>
          </select></label>
          <label>Sombras (percentil {recipe.black.toFixed(1)})<input type="range" min="0" max="20" step=".5"
            value={recipe.black} onChange={e=>change('black',Number(e.target.value))}/></label>
          <label>Luces (percentil {recipe.white.toFixed(1)})<input type="range" min="80" max="100" step=".5"
            value={recipe.white} onChange={e=>change('white',Number(e.target.value))}/></label>
          <label>Gamma ({recipe.gamma.toFixed(1)})<input type="range" min=".4" max="2.4" step=".1"
            value={recipe.gamma} onChange={e=>change('gamma',Number(e.target.value))}/></label>
          <label>Formato<select value={recipe.format} onChange={e=>change('format',e.target.value as RevealRecipe['format'])}>
            {Object.entries(renderFormats).map(([key,name])=><option key={key} value={key}>{name}</option>)}
          </select></label>
          <label>Interpolación<select value={recipe.sampling} onChange={e=>change('sampling',e.target.value as RevealRecipe['sampling'])}>
            <option value="smooth">Suave · bilineal</option><option value="pixels">Píxeles originales</option>
          </select></label>
          <button type="button" className="btn sm" onClick={()=>onChange({...DEFAULT_REVEAL})}>
            <RotateCcw size={14}/> Restablecer
          </button>
        </div>
        <p className="reveal-note">Falso color y estiramiento visual, no medición fotométrica. El contraste
          se calcula por época; las diferencias aparentes pueden ser de procesado. Los FITS permanecen
          inalterados. El formato añade márgenes sin recortar el campo.</p>
      </>}
    </>}
  </section>;
}
