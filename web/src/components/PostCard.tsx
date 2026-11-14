import { useEffect, useState, type FormEvent } from 'react';
import { Bookmark, Heart, MessageCircle, Orbit, Rocket, Share2 } from 'lucide-react';
import { api, hasToken, type Comment, type Observation, type Post } from '../lib/api';
import { SkyPreview } from './SkyPreview';

const ago = (date:string) => {
  const value = new Date(date).getTime();
  if (!Number.isFinite(value)) return '';
  const mins = Math.max(0,Math.floor((Date.now()-value)/60000));
  if(mins < 1) return 'ahora';
  if(mins < 60) return `hace ${mins} min`;
  if(mins < 1440) return `hace ${Math.floor(mins/60)} h`;
  return `hace ${Math.floor(mins/1440)} días`;
};
export function Avatar({name,size=36}:{name:string;size?:number}) {
  const hue = Array.from(name).reduce((sum,ch)=>sum+ch.charCodeAt(0)*17,0)%360;
  return <span className="avatar" style={{width:size,height:size,fontSize:Math.round(size*.34),
    background:`linear-gradient(135deg,hsl(${hue} 80% 60%),hsl(${(hue+70)%360} 76% 48%))`}}>{name.slice(0,2).toUpperCase()}</span>;
}
export default function PostCard({post:initial,onProfile,onExplore,onRequireLogin}: {
  post:Post;onProfile:(name:string)=>void;onExplore:(id:string)=>void;onRequireLogin:()=>void;
}) {
  const [post,setPost] = useState(initial);
  const [region,setRegion] = useState<Observation|null>(null);
  const [liked,setLiked] = useState(false);
  const [bookmarked,setBookmarked] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [commentsOpen,setCommentsOpen] = useState(false);
  const [comments,setComments] = useState<Comment[]>([]);
  const [draft,setDraft] = useState('');
  useEffect(()=>{
    setPost(initial);
    let active = true;
    setRegion(null);
    if (initial.observation_id) api.observation(initial.observation_id).then(r=>{if(active)setRegion(r)}).catch(()=>{});
    return ()=>{active=false};
  },[initial]);
  async function reload() {
    const next = await api.get<Post>(`/v1/posts/${post.id}`,hasToken());
    setPost(next);
  }
  async function handleLike() {
    if(!hasToken()) {onRequireLogin();return;}
    setBusy(true);setError('');
    try { if(liked) await api.unlike(post.id); else await api.like(post.id); setLiked(v=>!v);await reload();}
    catch(e){setError(e instanceof Error?e.message:'Error de like')} finally{setBusy(false)}
  }
  async function handleBookmark() {
    if(!hasToken()){onRequireLogin();return;}
    setBusy(true);setError('');
    try {if(bookmarked)await api.unbookmark(post.id);else await api.bookmark(post.id);setBookmarked(v=>!v);}
    catch(e){setError(e instanceof Error?e.message:'Error al guardar')} finally{setBusy(false)}
  }
  async function toggleComments(){
    if(!commentsOpen){try{setComments(await api.comments(post.id));setError('')}catch(e){setError(e instanceof Error?e.message:'Error al cargar comentarios')}}
    setCommentsOpen(v=>!v);
  }
  async function addComment(event:FormEvent){
    event.preventDefault();
    if(!hasToken()){onRequireLogin();return;}
    if(!draft.trim())return;
    setBusy(true);setError('');
    try {await api.createComment(post.id,draft.trim());setDraft('');setComments(await api.comments(post.id));await reload();}
    catch(e){setError(e instanceof Error?e.message:'Error al comentar')} finally{setBusy(false)}
  }
  async function share(){
    const url = post.observation_id
      ? `${window.location.origin}/?observation_id=${encodeURIComponent(post.observation_id)}`
      : `${window.location.origin}/#/u/${encodeURIComponent(post.username)}`;
    try{await navigator.clipboard.writeText(url);setError('Enlace copiado.')}catch{setError(url)}
  }
  return <article className="card post-card">
    <div className="post-head">
      <button className="avatar-button" type="button" onClick={()=>onProfile(post.username)}><Avatar name={post.username}/></button>
      <div className="who"><button className="who-link" onClick={()=>onProfile(post.username)}>@{post.username}</button>
        <small>{region ? `RA ${region.ra_deg.toFixed(4)}° · Dec ${region.dec_deg.toFixed(4)}°` : 'Publicación de la comunidad'}</small>
      </div>
      <span className="time">{ago(post.created_at)}</span>
    </div>
    {post.observation_id ? <SkyPreview seed={post.observation_id} moving label="VISTA ILUSTRATIVA · SIN DATOS NASA"
      onClick={()=>onExplore(post.observation_id!)}/> : <div className="text-poster">
      <Orbit size={44}/><span>PUBLICACIÓN DE TEXTO</span><small>Sin observación adjunta</small></div>}
    <div className="post-actions">
      <button title="Me gusta" aria-label="Me gusta" className={liked?'on':''} disabled={busy} onClick={()=>void handleLike()}>
        <Rocket size={20} fill={liked?'currentColor':'none'}/> <span>{post.likes_count}</span></button>
      <button title="Comentarios" onClick={()=>void toggleComments()}><MessageCircle size={19}/> <span>{post.comments_count}</span></button>
      <button title="Compartir" onClick={()=>void share()}><Share2 size={19}/></button>
      <button title="Guardar" style={{marginLeft:'auto'}} className={bookmarked?'on':''} disabled={busy}
        onClick={()=>void handleBookmark()}><Bookmark size={20} fill={bookmarked?'currentColor':'none'}/></button>
    </div>
    <div className="post-body"><b>@{post.username}</b> {post.caption}</div>
    {region && <button className="inline-explore" onClick={()=>onExplore(region.id)}>🔭 Abrir en el explorador · D{region.detector} · {region.fov_arcmin}′</button>}
    {error && <div className="inline-message" role="status">{error}</div>}
    {commentsOpen && <div className="comments">
      <div className="comments-title"><Heart size={15}/> Conversación</div>
      {comments.length===0?<p className="muted">Sin comentarios todavía.</p>:comments.map(c=><div key={c.id} className="comment"><b>@{c.username}</b> {c.body}</div>)}
      <form className="comment-form" onSubmit={event=>void addComment(event)}>
        <input value={draft} maxLength={2000} onChange={e=>setDraft(e.target.value)} placeholder="Escribe un comentario..." aria-label="Nuevo comentario"/>
        <button type="submit" className="btn sm" disabled={busy||!draft.trim()}>Enviar</button>
      </form>
    </div>}
  </article>;
}
