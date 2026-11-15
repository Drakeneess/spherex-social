import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { Check, ExternalLink, Globe2, ImagePlus, Link2, LockKeyhole,
  Send, Sparkles, Telescope, UploadCloud, X } from 'lucide-react';
import { api, type ObservationParams, type Post, type RevealRecipe } from '../lib/api';
import { extractPostHashtags, validHashtag } from '../lib/postComposer';
import { signalTask } from '../lib/onboarding';
import AstroGlyph from './AstroGlyph';

export type PublishRegion = ObservationParams & {sky_job_id?:string;display_recipe?:RevealRecipe};
type Photo={id:number;name:string;data_url:string};
type Props={region:PublishRegion|null;onClose:()=>void;onDone:()=>void};
const MAX_PHOTOS=4;
const bytesFromDataUrl=(value:string)=>Math.ceil((value.length-value.indexOf(',')-1)*.75);

async function encodePhoto(file:File):Promise<string>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
    throw new Error('Utiliza imágenes JPEG, PNG o WebP.');
  }
  if(file.size>15*1024*1024)throw new Error('El archivo original no debe superar 15 MB.');
  const bitmap=await createImageBitmap(file);
  try{
    if(bitmap.width*bitmap.height>16_000_000)throw new Error('La imagen supera 16 megapíxeles.');
    const factor=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*factor));
    canvas.height=Math.max(1,Math.round(bitmap.height*factor));
    const ctx=canvas.getContext('2d');
    if(!ctx)throw new Error('No se pudo preparar la imagen.');
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.84,.72,.6]){
      const data=canvas.toDataURL('image/webp',quality);
      if(bytesFromDataUrl(data)<=3*1024*1024)return data;
    }
    throw new Error('No fue posible comprimir la imagen a menos de 3 MB.');
  }finally{bitmap.close();}
}

const exampleTags=['astrofotografia','spherex','luna','nebulosas','cieloNocturno'];

export default function PublishModal({region,onClose,onDone}:Props){
  const [caption,setCaption]=useState('');
  const [visibility,setVisibility]=useState<Post['visibility']>('public');
  const [photos,setPhotos]=useState<Photo[]>([]);
  const [link,setLink]=useState('');
  const [showLink,setShowLink]=useState(false);
  const [tagInput,setTagInput]=useState('');
  const [attach,setAttach]=useState(Boolean(region));
  const [busy,setBusy]=useState(false);
  const [processing,setProcessing]=useState(false);
  const [error,setError]=useState('');
  const [savedId,setSavedId]=useState<string|null>(null);
  const [dragging,setDragging]=useState(false);
  const fileRef=useRef<HTMLInputElement>(null);
  const photoCounter=useRef(0);
  const dialogRef=useRef<HTMLDivElement>(null);
  const tags=extractPostHashtags(caption);
  const hasContent=Boolean(caption.trim()||photos.length||(showLink&&link.trim())||(attach&&region));

  useEffect(()=>{
    const previous=document.body.style.overflow;
    document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[]);
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    document.getElementById('caption')?.focus({preventScroll:true});
    return()=>previous?.focus({preventScroll:true});
  },[]);
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!busy&&!processing){event.preventDefault();onClose();return;}
      if(event.key!=='Tab')return;
      const controls=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]'
      )??[]).filter(element=>element.offsetParent!==null);
      if(!controls.length)return;
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&(document.activeElement===first||!dialogRef.current?.contains(document.activeElement))){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey&&(document.activeElement===last||!dialogRef.current?.contains(document.activeElement))){
        event.preventDefault();first.focus();
      }
    };
    window.addEventListener('keydown',handler);
    return()=>window.removeEventListener('keydown',handler);
  },[busy,processing,onClose]);

  async function addPhotos(list:FileList|File[]){
    const incoming=Array.from(list);
    if(!incoming.length)return;
    if(photos.length+incoming.length>MAX_PHOTOS){
      setError(`Puedes adjuntar hasta ${MAX_PHOTOS} imágenes.`);return;
    }
    setProcessing(true);setError('');
    try{
      const converted:Photo[]=[];
      for(const file of incoming){
        converted.push({id:++photoCounter.current,name:file.name,data_url:await encodePhoto(file)});
      }
      setPhotos(current=>[...current,...converted]);
    }catch(e){setError(e instanceof Error?e.message:'No se pudo procesar la imagen');}
    finally{setProcessing(false);}
  }
  function onFiles(event:ChangeEvent<HTMLInputElement>){
    void addPhotos(event.target.files??[]);
    event.target.value='';
  }
  function onDrop(event:DragEvent<HTMLDivElement>){
    event.preventDefault();setDragging(false);
    void addPhotos(event.dataTransfer.files);
  }
  function addHashtag(value:string){
    const tag=validHashtag(value);
    if(!tag){setError('Hashtag: 2–30 caracteres, letras, números o _.');return;}
    if(tags.length>=12&&!tags.includes(tag)){setError('Máximo 12 hashtags.');return;}
    if(!tags.includes(tag))setCaption(current=>`${current.trimEnd()}${current.trim()?' ':''}#${tag} `);
    setTagInput('');setError('');
  }
  async function submit(event:FormEvent){
    event.preventDefault();
    if(!hasContent){setError('Añade texto, imágenes, un enlace o una observación.');return;}
    if(processing)return;
    setBusy(true);setError('');
    try{
      let observation_id:string|null=null;
      if(attach&&region){
        observation_id=savedId??(await api.createObservation({
          ra_deg:region.ra_deg,dec_deg:region.dec_deg,
          fov_arcmin:region.fov_arcmin,detector:region.detector,
        })).id;
        setSavedId(observation_id);
      }
      await api.createPost({
        caption:caption.trim(),
        visibility,observation_id,
        sky_job_id:attach&&region?.sky_job_id?region.sky_job_id:null,
        display_recipe:attach&&region?.display_recipe?region.display_recipe:null,
        link_url:showLink?(link.trim()||null):null,
        images:photos.map(photo=>({data_url:photo.data_url})),
      });
      signalTask('post');
      onDone();
    }catch(e){setError(e instanceof Error?e.message:'No se pudo publicar');}
    finally{setBusy(false);}
  }

  return <div className="modal compose-overlay" role="presentation"
    onMouseDown={event=>{if(event.target===event.currentTarget&&!busy&&!processing)onClose();}}>
    <div ref={dialogRef} className="compose-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <div className="compose-header">
        <div className="compose-icon"><AstroGlyph name="spark" size={26}/></div>
        <div>
          <h2 id="publish-title">Comparte algo del universo</h2>
          <p>Una idea, una fotografía o una observación astronómica.</p>
        </div>
        <button type="button" className="compose-close" aria-label="Cerrar" disabled={busy}
          onClick={onClose}><X size={20}/></button>
      </div>

      <form className="compose-form" onSubmit={event=>void submit(event)}>
        <div className="compose-main">
          <div className="compose-audience">
            <span><Sparkles size={15}/> Nueva publicación</span>
            <label htmlFor="compose-visibility" className="compose-visibility">
              {visibility==='public'?<Globe2 size={16}/>:visibility==='private'?<LockKeyhole size={16}/>:<Link2 size={16}/>}
              <select id="compose-visibility" value={visibility} onChange={e=>setVisibility(e.target.value as Post['visibility'])}>
                <option value="public">Pública</option>
                <option value="unlisted">Con enlace</option>
                <option value="private">Privada</option>
              </select>
            </label>
          </div>
          <textarea id="caption" data-tour="publish-caption"
            value={caption} onChange={e=>setCaption(e.target.value)}
            maxLength={3000} rows={4}
            placeholder="¿Qué descubriste, fotografiaste o te gustaría compartir con otros amantes del cielo?"
            aria-label="Contenido de la publicación"/>
          <div className="compose-count">{caption.length}/3000</div>

          {photos.length>0&&<div className="compose-photos" aria-label="Imágenes adjuntas">
            {photos.map(photo=><div className="compose-photo" key={photo.id}>
              <img src={photo.data_url} alt={photo.name}/>
              <button type="button" onClick={()=>setPhotos(items=>items.filter(p=>p.id!==photo.id))}
                disabled={processing||busy} aria-label={`Eliminar imagen ${photo.name}`}><X size={17}/></button>
            </div>)}
          </div>}
          <div className={`compose-drop ${dragging?'active':''}`}
            onDragOver={event=>{event.preventDefault();setDragging(true);}}
            onDragLeave={()=>setDragging(false)} onDrop={onDrop}>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp"
              multiple hidden onChange={onFiles} aria-label="Seleccionar imágenes"/>
            <div className="compose-tools">
              <button type="button" onClick={()=>fileRef.current?.click()} disabled={busy||processing||photos.length>=MAX_PHOTOS}>
                <ImagePlus size={19}/> Fotos <small>{photos.length}/{MAX_PHOTOS}</small>
              </button>
              <button type="button" onClick={()=>setShowLink(value=>!value)} disabled={busy}>
                <Link2 size={18}/> Enlace
              </button>
              {region&&<button type="button" className={attach?'selected':''} onClick={()=>setAttach(v=>!v)} disabled={busy}>
                <Telescope size={19}/> Observación {attach&&<Check size={14}/>}
              </button>}
            </div>
            <p><UploadCloud size={15}/> Arrastra imágenes aquí o selecciona Fotos · JPEG, PNG y WebP</p>
          </div>

          {showLink&&<div className="compose-optional">
            <label htmlFor="compose-link"><ExternalLink size={15}/> Enlace a artículo, catálogo o recurso astronómico</label>
            <input type="url" id="compose-link" maxLength={800} value={link}
              onChange={e=>setLink(e.target.value)} placeholder="https://science.nasa.gov/..."
              aria-label="Enlace a un recurso astronómico"/>
            <small>Se mostrará como enlace. No se extraen ni incrustan contenidos externos.</small>
          </div>}
          {attach&&region&&<div className="compose-observation" data-tour="publish-region">
            <Telescope size={21}/>
            <div><b>Observación SPHEREx</b>
              <small>RA {region.ra_deg.toFixed(4)}° · Dec {region.dec_deg.toFixed(4)}° · D{region.detector}</small>
              {region.display_recipe&&<small>Revelado: {region.display_recipe.palette} · {region.display_recipe.format}</small>}
            </div>
            <button type="button" onClick={()=>setAttach(false)} aria-label="Desvincular observación"><X size={16}/></button>
          </div>}

          <div className="compose-tags">
            <div className="compose-section-title"><span>#</span> Hashtags
              <small>{tags.length}/12</small></div>
            <div className="compose-tag-form">
              <input value={tagInput} maxLength={31} aria-label="Nuevo hashtag"
                placeholder="Añade un tema, ej. astrofotografia"
                onChange={e=>setTagInput(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();if(tagInput) addHashtag(tagInput);}}}/>
              <button type="button" disabled={!tagInput.trim()||busy} onClick={()=>addHashtag(tagInput)}>Añadir</button>
            </div>
            <div className="compose-tag-list">
              {tags.map(tag=><span key={tag} className="compose-tag active">#{tag}</span>)}
              {exampleTags.filter(tag=>!tags.includes(tag.toLowerCase())).slice(0,4).map(tag=>
                <button type="button" key={tag} className="compose-tag" onClick={()=>addHashtag(tag)}>+ #{tag}</button>)}
            </div>
          </div>
        </div>

        {error&&<div role="alert" className="form-error compose-error">{error}</div>}
        <div className="compose-footer">
          <small>{visibility==='private'?'Solo tú podrás ver esta publicación.':
            visibility==='unlisted'?'Solo será accesible mediante enlace.':
            'Se compartirá con la comunidad de AstroGram.'}</small>
          <div>
            <button type="button" className="btn compose-cancel" onClick={onClose} disabled={busy||processing}>Cancelar</button>
            <button type="submit" data-tour="publish-submit" className="btn p compose-submit"
              disabled={busy||processing||!hasContent}>
              <Send size={17}/>{busy?'Publicando…':processing?'Preparando imágenes…':'Publicar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>;
}
