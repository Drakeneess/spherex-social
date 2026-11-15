import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Image as ImageIcon, X, ZoomIn } from 'lucide-react';
import { api, type PostMedia } from '../lib/api';

/** Feed and profile use small private WebP thumbnails.
 * The 650 KiB original is only fetched on explicit image expansion.
 * Legacy posts without a thumbnail gracefully fall back server-side.
 */
export default function PostMediaGallery({postId,media,compact=false}:{
  postId:string;media:PostMedia[];compact?:boolean;
}){
  const [active,setActive]=useState(0);
  const [visible,setVisible]=useState(false);
  const [thumbs,setThumbs]=useState<Record<string,string>>({});
  const [fullImages,setFullImages]=useState<Record<string,string>>({});
  const [thumbError,setThumbError]=useState(false);
  const [fullError,setFullError]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const image=media[Math.min(active,media.length-1)];
  const imageId=image?.id;

  useEffect(()=>{
    if(!root.current)return;
    if(!('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
    },{rootMargin:'240px'});
    observer.observe(root.current);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!visible||!imageId||thumbs[imageId])return;
    let live=true;
    setThumbError(false);
    api.postMediaData(postId,imageId,'thumbnail')
      .then(data=>{if(live)setThumbs(previous=>({...previous,[imageId]:data.data_url}));})
      .catch(()=>{if(live)setThumbError(true);});
    return()=>{live=false;};
  },[visible,imageId,postId,thumbs]);
  useEffect(()=>{
    if(!expanded||!imageId||fullImages[imageId])return;
    let live=true;
    setFullError(false);
    api.postMediaData(postId,imageId,'full')
      .then(data=>{if(live)setFullImages(previous=>({...previous,[imageId]:data.data_url}));})
      .catch(()=>{if(live)setFullError(true);});
    return()=>{live=false;};
  },[expanded,imageId,postId,fullImages]);
  useEffect(()=>{
    if(!expanded)return;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setExpanded(false);}
    };
    window.addEventListener('keydown',escape);
    return()=>{
      document.body.style.overflow=oldOverflow;
      window.removeEventListener('keydown',escape);
    };
  },[expanded]);

  function change(delta:number){setActive(n=>(n+delta+media.length)%media.length);}
  const thumb=imageId?thumbs[imageId]:undefined;
  const original=imageId?fullImages[imageId]:undefined;
  const label=`Foto de la comunidad ${active+1} de ${media.length}`;

  return <div ref={root} className={`post-media-gallery ${compact?'compact':''}`}
    aria-label={`${media.length} imágenes adjuntas`}>
    {compact
      ? thumb?<img src={thumb} alt={label} loading="lazy" decoding="async"/>:
        <div className="post-media-placeholder"><ImageIcon size={22}/>
          <span>{thumbError?'Imagen no disponible':'Cargando…'}</span></div>
      : <button type="button" className="post-media-open" onClick={()=>setExpanded(true)}
          aria-label={`Ampliar ${label}`}>
          {thumb?<img src={thumb} alt={label} loading="lazy" decoding="async"/>:
            <span className="post-media-placeholder" role="status">
              <ImageIcon size={30}/>{thumbError?'Imagen no disponible':'Cargando miniatura…'}
            </span>}
          <span className="post-media-expand" aria-hidden="true"><ZoomIn size={17}/></span>
        </button>}
    {!compact&&<>
      <span className="post-media-badge">Foto compartida · {active+1}/{media.length}</span>
      {media.length>1&&<div className="post-media-navigation">
        <button type="button" aria-label="Imagen anterior" onClick={()=>change(-1)}>
          <ChevronLeft size={18}/>
        </button>
        <button type="button" aria-label="Siguiente imagen" onClick={()=>change(1)}>
          <ChevronRight size={18}/>
        </button>
      </div>}
      {media.length>1&&<div className="post-media-dots" aria-label="Índice de fotos">
        {media.map((item,i)=><button type="button" key={item.id}
          aria-label={`Ver foto ${i+1}`} aria-current={i===active?'true':undefined}
          className={active===i?'on':''} onClick={()=>setActive(i)}/>)}
      </div>}
    </>}
    {expanded&&!compact&&createPortal(
      <div className="post-media-lightbox" role="presentation"
        onMouseDown={event=>{if(event.target===event.currentTarget)setExpanded(false);}}>
        <div className="post-media-lightbox-dialog" role="dialog" aria-modal="true"
          aria-label="Fotografía ampliada">
          <div className="post-media-lightbox-header">
            <span>{label} · versión optimizada</span>
            <button type="button" aria-label="Cerrar fotografía" onClick={()=>setExpanded(false)}>
              <X size={21}/>
            </button>
          </div>
          <div className="post-media-lightbox-image">
            {original||thumb
              ? <img src={original||thumb} alt={label}/>
              : <div className="post-media-placeholder"><ImageIcon size={28}/></div>}
          </div>
          <div className="post-media-lightbox-bottom">
            <span>{fullError?'No se pudo cargar la versión grande.':
              original?'Imagen de mayor calidad':
              'Cargando versión de mayor calidad…'}</span>
            {media.length>1&&<div>
              <button type="button" aria-label="Imagen anterior" onClick={()=>change(-1)}>
                <ChevronLeft size={19}/>
              </button>
              <button type="button" aria-label="Siguiente imagen" onClick={()=>change(1)}>
                <ChevronRight size={19}/>
              </button>
            </div>}
          </div>
        </div>
      </div>,document.body
    )}
  </div>;
}
