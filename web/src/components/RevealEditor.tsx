import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, Eye, EyeOff, LoaderCircle, RotateCcw, SlidersHorizontal, Telescope, X } from 'lucide-react';
import { api, DEFAULT_REVEAL, type RevealRecipe } from '../lib/api';

type Props = {
  active:boolean;jobId:string|null;index:number;rawAvailable:boolean;hasRaw:boolean;searching:boolean;
  recipe:RevealRecipe;onChange:(recipe:RevealRecipe)=>void;
  enabled:boolean;onEnabled:(value:boolean)=>void;
  originalImage?:string;
};

const palettes: {id:RevealRecipe['palette'];name:string;hint:string}[] = [
  {id:'gray',name:'Monocromo',hint:'Escala de grises'},
  {id:'cyan',name:'Cian',hint:'Estelar'},
  {id:'violet',name:'Violeta',hint:'Nebulosa'},
  {id:'ember',name:'Ámbar',hint:'Infrarrojo'},
  {id:'custom',name:'A medida',hint:'Tus colores'},
];
const formats: {id:RevealRecipe['format'];name:string;ratio:string}[] = [
  {id:'square',name:'Cuadrado',ratio:'1:1'},
  {id:'portrait',name:'Vertical',ratio:'4:5'},
  {id:'wide',name:'Panorámico',ratio:'16:9'},
];

export default function RevealEditor({
  active,jobId,index,rawAvailable,hasRaw,searching,recipe,onChange,enabled,onEnabled,originalImage,
}:Props){
  const [open,setOpen]=useState(false);
  const [showOriginal,setShowOriginal]=useState(false);
  const [image,setImage]=useState<{source:string;data:string}|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const cache=useRef(new Map<string,string>());
  const dialogRef=useRef<HTMLElement|null>(null);
  const headingId=useId();
  const source=JSON.stringify([jobId,index]);
  const key=JSON.stringify([jobId,index,recipe]);
  const processed=image?.source===source?image.data:'';

  useEffect(()=>{
    if(!active||!jobId||!rawAvailable){
      setLoading(false);
      return;
    }
    const cached=cache.current.get(key);
    if(cached){
      setImage({source,data:cached});
      setError('');setLoading(false);
      return;
    }
    const controller=new AbortController();
    setLoading(true);setError('');
    // Keep the previous processed preview on the *same* epoch while editing.
    // A different job/epoch must never display an unrelated scientific image.
    const timer=window.setTimeout(()=>{
      api.revealSkyFrame(jobId,index,recipe,controller.signal)
        .then(result=>{
          if(controller.signal.aborted)return;
          if(cache.current.size>=8){
            const oldest=cache.current.keys().next().value;
            if(oldest)cache.current.delete(oldest);
          }
          cache.current.set(key,result.image);
          setImage({source,data:result.image});
        })
        .catch(cause=>{
          if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'Revelado no disponible');
        })
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },300);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[active,jobId,index,rawAvailable,key,source,recipe]);

  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    setShowOriginal(false);
    dialogRef.current?.querySelector<HTMLButtonElement>('.reveal-studio-close')?.focus({preventScroll:true});
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        event.preventDefault();setOpen(false);return;
      }
      if(event.key!=='Tab'||!dialogRef.current)return;
      const controls=Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],[tabindex]:not([tabindex="-1"])'
      )).filter(node=>node.getClientRects().length>0);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&(document.activeElement===first||!dialogRef.current.contains(document.activeElement))){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&(document.activeElement===last||!dialogRef.current.contains(document.activeElement))){
        event.preventDefault();first.focus();
      }
    };
    window.addEventListener('keydown',onKey);
    return()=>{
      document.body.style.overflow=oldOverflow;
      window.removeEventListener('keydown',onKey);
      previous?.focus({preventScroll:true});
    };
  },[open]);

  useEffect(()=>{if(!active)setOpen(false);},[active]);
  const change=<K extends keyof RevealRecipe>(field:K,value:RevealRecipe[K])=>{
    onChange({...recipe,[field]:value});
    setShowOriginal(false);
  };
  const compareAvailable=Boolean(originalImage);
  const viewOriginal=showOriginal&&compareAvailable;
  const visibleImage=viewOriginal?originalImage:processed;
  const paletteName=palettes.find(item=>item.id===recipe.palette)?.name??'Personalizada';

  return <section className="card reveal-editor" aria-label="Estudio de revelado astronómico">
    <div className="card-h">
      <span><SlidersHorizontal size={17}/> Revelado</span>
      <span className="chip">FITS · no destructivo</span>
    </div>
    {!hasRaw?<div className="reveal-no-data">
      <Telescope size={20} aria-hidden="true"/>
      <span>{searching
        ? 'Archivando los datos FITS. El estudio estará disponible cuando termine de cargar una época.'
        : 'Esta búsqueda no contiene FITS editables. Haz una búsqueda nueva para ajustar el revelado.'}</span>
    </div>:<>
      <div className="reveal-compact">
        <div className="reveal-compact-overview">
          <div className="reveal-compact-thumb">
            {processed?<img src={processed} alt="Miniatura del revelado actual"/>:
              <SlidersHorizontal size={22} aria-hidden="true"/>}
            {loading&&<span className="reveal-thumb-busy" aria-label="Actualizando imagen"><LoaderCircle size={13} className="spin"/></span>}
          </div>
          <div className="reveal-compact-description">
            <strong>{paletteName} · {formats.find(item=>item.id===recipe.format)?.ratio}</strong>
            <span>{loading?'Actualizando vista…':rawAvailable?'Edición disponible':'Esperando una época editable'}</span>
          </div>
        </div>
        <button type="button" className="btn reveal-open" onClick={()=>setOpen(true)}>
          <SlidersHorizontal size={16}/> Abrir estudio <ChevronRight size={16}/>
        </button>
        <label className="reveal-compact-toggle">
          <input type="checkbox" checked={enabled} onChange={event=>onEnabled(event.target.checked)}/>
          <span>Usar este revelado al publicar</span>
        </label>
        {error&&<p className="reveal-compact-error" role="status">{error}</p>}
      </div>
    </>}
    {open&&hasRaw&&createPortal(
      <div className="reveal-studio-overlay" role="presentation"
        onMouseDown={event=>{if(event.target===event.currentTarget)setOpen(false);}}>
        <section ref={dialogRef} className="reveal-studio-dialog" role="dialog"
          aria-modal="true" aria-labelledby={headingId}>
          <header className="reveal-studio-header">
            <div className="reveal-studio-heading">
              <span className="reveal-studio-symbol"><SlidersHorizontal size={20}/></span>
              <div>
                <h2 id={headingId}>Estudio de revelado</h2>
                <p>Trabaja con tus datos FITS sin modificar el original</p>
              </div>
            </div>
            <div className="reveal-studio-header-actions">
              <span className="reveal-studio-epoch">Época {index+1}</span>
              <button type="button" className="reveal-studio-close"
                aria-label="Cerrar estudio de revelado" onClick={()=>setOpen(false)}>
                <X size={21}/>
              </button>
            </div>
          </header>
          <div className="reveal-studio-workspace">
            <div className="reveal-studio-visual">
              <div className="reveal-visual-toolbar">
                <div><strong>Vista previa</strong><span>Falso color · imagen preliminar</span></div>
                <button type="button" className="reveal-compare" aria-pressed={viewOriginal}
                  disabled={!compareAvailable}
                  onClick={()=>setShowOriginal(value=>!value)}>
                  {viewOriginal?<EyeOff size={16}/>:<Eye size={16}/>}
                  {viewOriginal?'Volver al revelado':'Comparar original'}
                </button>
              </div>
              <div className="reveal-visual-mat">
                <div className={ "reveal-stage format-"+recipe.format }>
                  {visibleImage?<img key={viewOriginal?'original':'processed'}
                    className={viewOriginal?'reveal-original-image':''}
                    src={visibleImage} alt={viewOriginal?'Vista original PNG de la época':'Revelado preliminar en falso color'}
                    decoding="async"/>:
                    <div className="reveal-empty">
                      {loading?<LoaderCircle size={23} className="spin"/>:<Telescope size={23}/>}
                      <span>{loading?'Preparando revelado…':
                        rawAvailable?'Vista no disponible; revisa los ajustes':'Esta época no tiene FITS editables'}</span>
                    </div>}
                  {loading&&!viewOriginal&&processed&&<div className="reveal-update-indicator" role="status">
                    <LoaderCircle size={14} className="spin"/> Aplicando ajustes…
                  </div>}
                  {viewOriginal&&<span className="reveal-image-caption">PNG original</span>}
                </div>
              </div>
              <div className="reveal-visual-meta">
                <span><Check size={14}/> FITS originales intactos</span>
                <span>Formato {formats.find(item=>item.id===recipe.format)?.ratio}</span>
              </div>
              {error&&<p className="reveal-error" role="alert">{error}</p>}
              <p className="reveal-visual-disclaimer">
                El falso color y el contraste son interpretaciones visuales, no mediciones fotométricas.
                Los cambios de contraste pueden generar diferencias aparentes entre épocas.
              </p>
            </div>
            <aside className="reveal-studio-settings" aria-label="Ajustes de revelado">
              <div className="reveal-settings-section">
                <div className="reveal-settings-heading"><span>01</span><h3>Paleta cromática</h3></div>
                <div className="reveal-palette-list" role="group" aria-label="Paleta de color">
                  {palettes.map(item=><button type="button" key={item.id}
                    aria-pressed={recipe.palette===item.id}
                    className={'reveal-palette-option '+(recipe.palette===item.id?'selected':'')}
                    onClick={()=>change('palette',item.id)}>
                    <span className={'reveal-palette-swatch palette-'+item.id}/>
                    <span className="reveal-palette-name"><strong>{item.name}</strong><small>{item.hint}</small></span>
                    {recipe.palette===item.id&&<Check size={16}/>}
                  </button>)}
                </div>
                {recipe.palette==='custom'&&<div className="reveal-color-fields">
                  <label>Sombras
                    <input type="color" value={recipe.shadow} onChange={e=>change('shadow',e.target.value)}/>
                  </label>
                  <label>Luces
                    <input type="color" value={recipe.highlight} onChange={e=>change('highlight',e.target.value)}/>
                  </label>
                </div>}
              </div>
              <div className="reveal-settings-section">
                <div className="reveal-settings-heading"><span>02</span><h3>Luz y contraste</h3></div>
                <label className="reveal-select-label">Curva tonal
                  <select value={recipe.stretch} onChange={e=>change('stretch',e.target.value as RevealRecipe['stretch'])}>
                    <option value="asinh">Asinh · estrellas y fondo</option>
                    <option value="linear">Lineal</option>
                    <option value="log">Logarítmica</option>
                  </select>
                </label>
                <div className="reveal-range-fields">
                  <label><span>Sombras <output>{recipe.black.toFixed(1)}%</output></span>
                    <input type="range" min="0" max="20" step=".5" value={recipe.black}
                      onChange={e=>change('black',Number(e.target.value))}/>
                  </label>
                  <label><span>Luces <output>{recipe.white.toFixed(1)}%</output></span>
                    <input type="range" min="80" max="100" step=".5" value={recipe.white}
                      onChange={e=>change('white',Number(e.target.value))}/>
                  </label>
                  <label><span>Gamma <output>{recipe.gamma.toFixed(1)}</output></span>
                    <input type="range" min=".4" max="2.4" step=".1" value={recipe.gamma}
                      onChange={e=>change('gamma',Number(e.target.value))}/>
                  </label>
                </div>
              </div>
              <div className="reveal-settings-section">
                <div className="reveal-settings-heading"><span>03</span><h3>Presentación</h3></div>
                <span className="reveal-control-caption">Formato de publicación</span>
                <div className="reveal-format-options" role="group" aria-label="Formato de imagen">
                  {formats.map(item=><button type="button" key={item.id}
                    aria-pressed={recipe.format===item.id}
                    className={recipe.format===item.id?'selected':''}
                    onClick={()=>change('format',item.id)}>
                    <span className={'reveal-format-icon format-'+item.id}/><strong>{item.name}</strong><small>{item.ratio}</small>
                  </button>)}
                </div>
                <span className="reveal-control-caption">Interpolación</span>
                <div className="reveal-sampling-options" role="group" aria-label="Interpolación">
                  <button type="button" aria-pressed={recipe.sampling==='smooth'}
                    className={recipe.sampling==='smooth'?'selected':''}
                    onClick={()=>change('sampling','smooth')}>Suave</button>
                  <button type="button" aria-pressed={recipe.sampling==='pixels'}
                    className={recipe.sampling==='pixels'?'selected':''}
                    onClick={()=>change('sampling','pixels')}>Píxeles originales</button>
                </div>
                <p className="reveal-setting-help">Los formatos añaden márgenes; nunca recortan la observación.</p>
              </div>
              <button type="button" className="reveal-reset" onClick={()=>{
                onChange({...DEFAULT_REVEAL});setShowOriginal(false);
              }}><RotateCcw size={15}/> Restablecer ajustes</button>
            </aside>
          </div>
          <footer className="reveal-studio-footer">
            <label><input type="checkbox" checked={enabled}
              onChange={e=>onEnabled(e.target.checked)}/>
              <span>Usar este revelado al publicar</span>
            </label>
            <button type="button" className="btn p" onClick={()=>setOpen(false)}>
              <Check size={16}/> Listo
            </button>
          </footer>
        </section>
      </div>,document.body
    )}
  </section>;
}
