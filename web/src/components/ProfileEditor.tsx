import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, ExternalLink, ImagePlus, Link2, Save, Trash2, UploadCloud } from 'lucide-react';
import { api, type Profile } from '../lib/api';
import { Avatar, updateAvatarCache } from './PostCard';
import { signalTask } from '../lib/onboarding';

type Kind='avatar'|'cover';
const LIMIT=3*1024*1024;
function byteSize(url:string){return Math.ceil((url.length-url.indexOf(',')-1)*.75);}

async function encodePhoto(file:File):Promise<string>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)){
    throw new Error('Selecciona una imagen JPEG, PNG o WebP.');
  }
  if(file.size>12*1024*1024)throw new Error('El archivo original no debe superar 12 MB.');
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file);}
  catch{throw new Error('No fue posible abrir la imagen.');}
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>16_000_000){
      throw new Error('La imagen debe tener como máximo 16 megapíxeles.');
    }
    const factor=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*factor));
    canvas.height=Math.max(1,Math.round(bitmap.height*factor));
    const context=canvas.getContext('2d');
    if(!context)throw new Error('No se pudo procesar la imagen.');
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    for(const quality of [.85,.75,.65,.56]){
      const result=canvas.toDataURL('image/webp',quality);
      if(result.startsWith('data:image/webp;')&&byteSize(result)<=LIMIT)return result;
    }
    throw new Error('Esta imagen contiene demasiado detalle. Prueba con un recorte más pequeño.');
  }finally{bitmap.close();}
}

export default function ProfileEditor({user,onUpdate}:{
  user:Profile;onUpdate:(profile:Profile)=>void;
}){
  const [name,setName]=useState(user.display_name);
  const [bio,setBio]=useState(user.bio??'');
  const [website,setWebsite]=useState(user.website??'');
  const [busy,setBusy]=useState<Kind|'details'|null>(null);
  const [preview,setPreview]=useState<{kind:Kind;url:string}|null>(null);
  const [error,setError]=useState('');
  const [success,setSuccess]=useState('');
  const avatarInput=useRef<HTMLInputElement>(null);
  const coverInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    setName(user.display_name);setBio(user.bio??'');setWebsite(user.website??'');
  },[user.id]);
  const changed=name.trim()!==user.display_name||
    bio.trim()!==(user.bio??'')||website.trim()!==(user.website??'');

  async function upload(kind:Kind,event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value='';
    if(!file||busy)return;
    setBusy(kind);setError('');setSuccess('');
    try{
      const url=await encodePhoto(file);
      setPreview({kind,url});
      const updated=await api.uploadProfileMedia(kind,url);
      onUpdate(updated);
      if(kind==='avatar')updateAvatarCache(user.username,updated.avatar_version);
      setSuccess(kind==='avatar'?'Foto de perfil actualizada.':'Portada actualizada.');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo guardar la imagen.');}
    finally{setPreview(null);setBusy(null);}
  }
  async function remove(kind:Kind){
    if(busy)return;
    setBusy(kind);setError('');setSuccess('');
    try{
      const updated=await api.deleteProfileMedia(kind);
      onUpdate(updated);
      if(kind==='avatar')updateAvatarCache(user.username,null);
      setSuccess(kind==='avatar'?'Foto de perfil eliminada.':'Portada eliminada.');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar la imagen.');}
    finally{setBusy(null);}
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;
    setError('');setSuccess('');
    if(!name.trim()){setError('El nombre visible no puede estar vacío.');return;}
    setBusy('details');
    try{
      const updated=await api.patchMe({
        display_name:name.trim(),bio:bio.trim()||null,website:website.trim()||null,
      });
      onUpdate(updated);
      if(updated.bio?.trim())signalTask('bio');
      setSuccess('Cambios guardados. Tu perfil público está actualizado.');
    }catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar el perfil.');}
    finally{setBusy(null);}
  }

  const coverPreview=preview?.kind==='cover'?preview.url:
    user.cover_version?api.profileMediaUrl(user.username,'cover',user.cover_version):null;

  return <section className="profile-editor" aria-labelledby="edit-profile-title">
    <div className="profile-editor-intro">
      <h2 id="edit-profile-title">Tu perfil, tu universo</h2>
      <p>Personaliza cómo te ve la comunidad. Tus fotografías y el enlace serán públicos.</p>
    </div>
    <div className="profile-editor-cover">
      {coverPreview
        ? <img src={coverPreview} alt="Vista previa de la portada"/>
        : <div className="profile-cover-placeholder" aria-hidden="true"><span>✦</span></div>}
      <div className="profile-cover-tools">
        <button type="button" disabled={!!busy} onClick={()=>coverInput.current?.click()}>
          <ImagePlus size={17}/> {busy==='cover'?'Guardando…':user.cover_version?'Cambiar portada':'Añadir portada'}
        </button>
        {user.cover_version&&<button type="button" disabled={!!busy}
          onClick={()=>void remove('cover')} title="Quitar portada" aria-label="Quitar portada">
          <Trash2 size={16}/>
        </button>}
      </div>
      <input ref={coverInput} type="file" hidden accept="image/jpeg,image/png,image/webp"
        aria-label="Subir portada" onChange={event=>void upload('cover',event)}/>
    </div>
    <div className="profile-editor-avatar-row">
      <div className="profile-editor-avatar">
        {preview?.kind==='avatar'
          ? <img src={preview.url} alt="Vista previa de la nueva foto"/>
          : <Avatar name={user.username} size={92} version={user.avatar_version}/>}
        <button type="button" disabled={!!busy} title="Cambiar foto de perfil"
          aria-label="Cambiar foto de perfil" onClick={()=>avatarInput.current?.click()}>
          <Camera size={17}/>
        </button>
        <input ref={avatarInput} type="file" hidden accept="image/jpeg,image/png,image/webp"
          aria-label="Subir foto de perfil" onChange={event=>void upload('avatar',event)}/>
      </div>
      <div className="profile-editor-avatar-info">
        <strong>Foto de perfil</strong>
        <p>Elige una foto o imagen que te represente. Se recortará al centro en formato cuadrado.</p>
        <div className="profile-editor-avatar-buttons">
          <button type="button" disabled={!!busy} onClick={()=>avatarInput.current?.click()}>
            {busy==='avatar'?'Guardando…':'Cambiar foto'}
          </button>
          {user.avatar_version&&<button type="button" className="remove" disabled={!!busy}
            onClick={()=>void remove('avatar')}>Quitar foto</button>}
        </div>
      </div>
    </div>
    <p className="profile-editor-media-hint"><UploadCloud size={15}/>
      Las imágenes se optimizan a WebP y se guardan automáticamente. Máximo 96 KiB
      para el avatar y 350 KiB para la portada; sin metadatos EXIF.
    </p>
    <form className="profile-editor-fields" onSubmit={event=>void save(event)}>
      <div className="profile-editor-fields-heading">
        <h3>Información pública</h3>
        <span>@{user.username}</span>
      </div>
      <div className="field">
        <label htmlFor="editName">Nombre para mostrar</label>
        <input id="editName" required maxLength={80} value={name}
          disabled={!!busy} onChange={event=>{setName(event.target.value);setSuccess('');}}
          placeholder="¿Cómo quieres que te conozcan?"/>
        <small>{name.length}/80</small>
      </div>
      <div className="field">
        <label htmlFor="bio">Biografía</label>
        <textarea id="bio" maxLength={500} rows={4} value={bio}
          disabled={!!busy} onChange={event=>{setBio(event.target.value);setSuccess('');}}
          placeholder="Cuéntanos qué te fascina del universo, qué observas o qué estás investigando…"/>
        <small>{bio.length}/500</small>
      </div>
      <div className="field">
        <label htmlFor="profileWebsite"><Link2 size={15}/> Sitio web o recurso personal</label>
        <input id="profileWebsite" type="url" maxLength={300} value={website}
          disabled={!!busy} onChange={event=>{setWebsite(event.target.value);setSuccess('');}}
          placeholder="https://tu-sitio.example"/>
        <small>Opcional · únicamente enlaces HTTP o HTTPS.</small>
      </div>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {success&&<p role="status" className="success-note"><Check size={17}/>{success}</p>}
      <div className="profile-editor-footer">
        <span><ExternalLink size={15}/> Puedes ver los cambios en tu perfil público.</span>
        <button className="btn p profile-save" type="submit" disabled={!!busy||!changed}>
          <Save size={16}/>{busy==='details'?'Guardando…':'Guardar cambios'}
        </button>
      </div>
    </form>
  </section>;
}
