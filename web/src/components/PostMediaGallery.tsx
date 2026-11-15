import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';
import { api, type PostMedia } from '../lib/api';

/** Lazy-rendered authenticated gallery: private attachments never receive a public URL. */
export default function PostMediaGallery({postId,media,compact=false}:{
  postId:string;media:PostMedia[];compact?:boolean;
}){
  const [active,setActive]=useState(0);
  const [visible,setVisible]=useState(false);
  const [images,setImages]=useState<Record<string,string>>({});
  const [error,setError]=useState(false);
  const root=useRef<HTMLDivElement>(null);
  const image=media[Math.min(active,media.length-1)];
  useEffect(()=>{
    if(!root.current)return;
    if(!('IntersectionObserver' in window)){setVisible(true);return;}
    const observer=new IntersectionObserver(entries=>{
      if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}
    },{rootMargin:'300px'});
    observer.observe(root.current);
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!visible||!image||images[image.id])return;
    let live=true;
    setError(false);
    api.postMediaData(postId,image.id)
      .then(data=>{if(live)setImages(previous=>({...previous,[image.id]:data.data_url}));})
      .catch(()=>{if(live)setError(true);});
    return()=>{live=false;};
  },[visible,image?.id,postId,images]);
  const url=image?images[image.id]:undefined;
  return <div ref={root} className={`post-media-gallery ${compact?'compact':''}`}
    aria-label={`${media.length} imágenes adjuntas`}>
    {url?<img src={url} alt={`Imagen astronómica compartida ${active+1} de ${media.length}`}
      loading="lazy" decoding="async"/>:
      <div className="post-media-placeholder" role="status">
        <ImageIcon size={compact?22:30}/>
        <span>{error?'Imagen no disponible':'Cargando imagen…'}</span>
      </div>}
    {!compact&&<><span className="post-media-badge">Foto compartida · {active+1}/{media.length}</span>
      {media.length>1&&<div className="post-media-navigation">
        <button type="button" aria-label="Imagen anterior"
          onClick={()=>setActive(v=>(v+media.length-1)%media.length)}><ChevronLeft size={18}/></button>
        <button type="button" aria-label="Siguiente imagen"
          onClick={()=>setActive(v=>(v+1)%media.length)}><ChevronRight size={18}/></button>
      </div>}
      {media.length>1&&<div className="post-media-dots" aria-label="Índice de fotos">
        {media.map((item,i)=><button type="button" key={item.id} aria-label={`Ver foto ${i+1}`}
          aria-current={i===active?'true':undefined}
          className={active===i?'on':''} onClick={()=>setActive(i)}/>)}
      </div>}
    </>}
  </div>;
}
