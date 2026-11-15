import { useEffect, useState, type FormEvent } from 'react';
import { Bookmark, Heart, Link2, MessageCircle, Repeat2, Telescope, ExternalLink } from 'lucide-react';
import AstroGlyph from './AstroGlyph';
import { signalTask, signalNudge } from '../lib/onboarding';
import { subscribeRealtime } from '../lib/realtime';
import { formatRa, formatDec } from '../lib/coordinates';
import { api, hasToken, type Comment, type Observation, type Post, type Profile } from '../lib/api';
import PostBlinkPreview from './PostBlinkPreview';
import PostMediaGallery from './PostMediaGallery';
import { fallbackAvatarColors, safeHexColor, themeGradient } from '../lib/profileTheme';

const ago = (date:string) => {
  const value = new Date(date).getTime();
  if (!Number.isFinite(value)) return '';
  const mins = Math.max(0,Math.floor((Date.now()-value)/60000));
  if(mins < 1) return 'ahora';
  if(mins < 60) return `hace ${mins} min`;
  if(mins < 1440) return `hace ${Math.floor(mins/60)} h`;
  return `hace ${Math.floor(mins/1440)} días`;
};
// Cache the public visual identity per author so a long feed only fetches
// each author's palette and picture version once per session.
type AvatarIdentity={
  version:string|null;
  colorStart:string|null;
  colorEnd:string|null;
};
const avatarCache=new Map<string,Promise<AvatarIdentity>>();
const identityFromProfile=(p:Pick<Profile,'avatar_version'|'avatar_color_start'|'avatar_color_end'>):AvatarIdentity=>({
  version:p.avatar_version,colorStart:p.avatar_color_start,colorEnd:p.avatar_color_end,
});
function cachedAvatarIdentity(username:string):Promise<AvatarIdentity>{
  const key=username.toLowerCase();
  let pending=avatarCache.get(key);
  if(!pending){
    pending=api.user(key).then(identityFromProfile).catch(()=>{
      avatarCache.delete(key);
      return {version:null,colorStart:null,colorEnd:null};
    });
    avatarCache.set(key,pending);
  }
  return pending;
}
export function updateAvatarCache(username:string,profile:Profile){
  const identity=identityFromProfile(profile);
  avatarCache.set(username.toLowerCase(),Promise.resolve(identity));
  window.dispatchEvent(new CustomEvent('astrogram:avatar-updated',{
    detail:{username:username.toLowerCase(),identity},
  }));
}
export function Avatar({name,size=36,version,colorStart,colorEnd}:{
  name:string;size?:number;version?:string|null;
  colorStart?:string|null;colorEnd?:string|null;
}){
  const ownIdentity={
    version:version??null,
    colorStart:colorStart??null,
    colorEnd:colorEnd??null,
  };
  const [stored,setStored]=useState<AvatarIdentity>(ownIdentity);
  const [broken,setBroken]=useState(false);
  useEffect(()=>{
    setBroken(false);
    if(version!==undefined && colorStart!==undefined && colorEnd!==undefined){
      setStored({version,colorStart,colorEnd});return;
    }
    let active=true;
    void cachedAvatarIdentity(name).then(value=>{if(active)setStored(value);});
    const listener=(event:Event)=>{
      const data=(event as CustomEvent<{username:string;identity:AvatarIdentity}>).detail;
      if(data?.username===name.toLowerCase()){
        setStored(data.identity);setBroken(false);
      }
    };
    window.addEventListener('astrogram:avatar-updated',listener);
    return()=>{active=false;window.removeEventListener('astrogram:avatar-updated',listener);};
  },[name,version,colorStart,colorEnd]);
  const defaultColors=fallbackAvatarColors(name);
  const src=stored.version&&!broken?api.profileMediaUrl(name,'avatar',stored.version):null;
  const colors={
    start:safeHexColor(stored.colorStart,defaultColors.start),
    end:safeHexColor(stored.colorEnd,defaultColors.end),
  };
  return <span className="avatar" style={{width:size,height:size,fontSize:Math.round(size*.34),
    lineHeight:1,background:themeGradient(colors)}}>
    {src?<img src={src} alt="" loading="lazy" decoding="async"
      onError={()=>setBroken(true)}/>:name.slice(0,2).toUpperCase()}
  </span>;
}
export default function PostCard({post:initial,onProfile,onExplore,onRequireLogin,onRepostChange,onBookmarkChange,currentUsername,initialCommentsOpen=false}: {
  post:Post;onProfile:(name:string)=>void;onExplore:(id:string)=>void;onRequireLogin:()=>void;
  onRepostChange?:()=>void;onBookmarkChange?:(postId:string,bookmarked:boolean)=>void;
  currentUsername?:string;
  initialCommentsOpen?:boolean;
}) {
  const [post,setPost] = useState(initial);
  const [region,setRegion] = useState<Observation|null>(null);
  const [liked,setLiked] = useState(initial.liked_by_me);
   const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [commentsOpen,setCommentsOpen] = useState(false);
  const [comments,setComments] = useState<Comment[]>([]);
  const [draft,setDraft] = useState('');
  useEffect(()=>{
    setPost(initial);
    setLiked(initial.liked_by_me);
    let active = true;
    setRegion(null);
    if (initial.observation_id) api.observation(initial.observation_id).then(r=>{if(active)setRegion(r)}).catch(()=>{});
    return ()=>{active=false};
  },[initial]);
  useEffect(()=>{
    if(!initialCommentsOpen)return;
    let active=true;
    setCommentsOpen(true);
    api.comments(initial.id)
      .then(items=>{if(active)setComments(items);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudieron cargar los comentarios');});
    return()=>{active=false;};
  },[initialCommentsOpen,initial.id]);
  useEffect(()=>{
    let active=true;
    let timeout:number|undefined;
    const unsubscribe=subscribeRealtime(change=>{
      if(!['resync','feed','interaction','comments','bookmarks','profile_posts'].includes(change.kind))return;
      if(change.post_id && change.post_id!==initial.id)return;
      window.clearTimeout(timeout);
      timeout=window.setTimeout(()=>{
        void api.get<Post>('/v1/posts/'+encodeURIComponent(initial.id),hasToken())
          .then(next=>{
            if(!active)return;
            setPost(previous=>({...next,reposted_by:previous.reposted_by,reposted_at:previous.reposted_at}));
            setLiked(next.liked_by_me);
          }).catch(()=>{/* The feed or parent route handles deleted posts. */});
        if(commentsOpen && (change.kind==='comments'||change.kind==='resync')){
          void api.comments(initial.id).then(items=>{if(active)setComments(items);}).catch(()=>{});
        }
      },250);
    });
    return()=>{active=false;window.clearTimeout(timeout);unsubscribe();};
  },[initial.id,commentsOpen]);
  async function reload() {
    const next = await api.get<Post>(`/v1/posts/${post.id}`,hasToken());
    // The detail endpoint has no profile context; keep the repost attribution.
    setPost({...next,reposted_by:post.reposted_by,reposted_at:post.reposted_at});
    setLiked(next.liked_by_me);
  }
  async function handleLike() {
    if(!hasToken()) {onRequireLogin();return;}
    setBusy(true);setError('');
    try { if(liked) await api.unlike(post.id); else await api.like(post.id);
      if(!liked){signalTask('like');signalNudge('like');}
      setLiked(v=>!v);await reload();}
    catch(e){setError(e instanceof Error?e.message:'Error de like')} finally{setBusy(false)}
  }
  async function handleBookmark() {
    if(!hasToken()){onRequireLogin();return;}
    setBusy(true);setError('');setNotice('');
    const wasBookmarked = post.bookmarked_by_me;
    try {
      if(wasBookmarked)await api.unbookmark(post.id);else await api.bookmark(post.id);
      setPost(current=>({...current,bookmarked_by_me:!wasBookmarked}));
      onBookmarkChange?.(post.id,!wasBookmarked);
      setNotice(wasBookmarked?'Eliminado de Guardados.':'Guardado en tu colección.');
    }
    catch(e){setError(e instanceof Error?e.message:'Error al guardar')}
    finally{setBusy(false)}
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
    if(!hasToken()){onRequireLogin();return;}
    if(currentUsername===post.username)return;
    setBusy(true);setError('');setNotice('');
    const wasReposted = post.reposted_by_me;
    try {
      if(wasReposted)await api.unrepost(post.id);else await api.repost(post.id);
      setPost(current=>({...current,reposted_by_me:!wasReposted,
        reposts_count:Math.max(0,current.reposts_count+(wasReposted?-1:1))}));
      setNotice(wasReposted?'Se retiró de tu perfil.':'Compartido en tu perfil.');
      onRepostChange?.();
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo compartir');}
    finally {setBusy(false);}
  }
  async function copyLink(){
    const url = post.observation_id
      ? `${window.location.origin}/?observation_id=${encodeURIComponent(post.observation_id)}`
      : `${window.location.origin}/#/u/${encodeURIComponent(post.username)}`;
    setError('');setNotice('');
    try{await navigator.clipboard.writeText(url);setNotice('Enlace copiado.');}
    catch{setError('No se pudo copiar el enlace.');}
  }
  return <article className="card post-card">
    {post.reposted_by && <div className="post-repost-label"><Repeat2 size={15} aria-hidden="true"/>
      <button type="button" onClick={()=>onProfile(post.reposted_by!)}>@{post.reposted_by}</button>
      <span>compartió esta publicación{post.reposted_at?' · '+ago(post.reposted_at):''}</span>
    </div>}
    <div className="post-head">
      <button className="avatar-button" type="button" onClick={()=>onProfile(post.username)}><Avatar name={post.username}/></button>
      <div className="who"><button className="who-link" onClick={()=>onProfile(post.username)}>{post.username}</button>
        <small>{region ? `RA ${formatRa(region.ra_deg)} · Dec ${formatDec(region.dec_deg)}` :
          post.media?.length?'Fotografías de la comunidad':
          post.link_url?'Recurso astronómico compartido':'Publicación de texto'}</small>
      </div>
      <span className="time">{ago(post.created_at)}</span>
    </div>
    {post.media?.length>0&&<PostMediaGallery postId={post.id} media={post.media}/>}
    {post.observation_id&&(region
      ? <PostBlinkPreview postId={post.id} onExplore={()=>onExplore(region.id)}/>
      : <div className="post-text-poster" role="status">
          <Telescope size={30} aria-hidden="true"/><strong>Abriendo observación…</strong>
        </div>)}
    <div className="post-actions">
      <button data-tour="like-button" title="Me encoheta" aria-label="Me encoheta" className={liked?'on':''} disabled={busy} onClick={()=>void handleLike()}>
        <AstroGlyph name={liked?'ship-on':'ship'} size={24}/> <span>{post.likes_count}</span></button>
      <button title="Comentarios" onClick={()=>void toggleComments()}><MessageCircle size={24}/> <span>{post.comments_count}</span></button>
      <button title={currentUsername===post.username?'Ya está en tu perfil':post.reposted_by_me?'Retirar de mi perfil':'Compartir en mi perfil'}
        aria-pressed={post.reposted_by_me} className={post.reposted_by_me?'on':''}
        disabled={busy || currentUsername===post.username} onClick={()=>void share()}>
        <AstroGlyph name="galaxy" size={24}/> <span>{post.reposted_by_me?'Compartido':'Compartir'}</span> <span>{post.reposts_count}</span></button>
      <button title="Copiar enlace" aria-label="Copiar enlace" disabled={busy} onClick={()=>void copyLink()}>
        <Link2 size={21}/></button>
      <button title={post.bookmarked_by_me?'Quitar de Guardados':'Guardar'} aria-label={post.bookmarked_by_me?'Quitar de Guardados':'Guardar'}
        aria-pressed={post.bookmarked_by_me} style={{marginLeft:'auto'}}
        className={post.bookmarked_by_me?'on':''} disabled={busy}
        onClick={()=>void handleBookmark()}><Bookmark size={24} fill={post.bookmarked_by_me?'currentColor':'none'}/></button>
    </div>
    {post.caption&&<div className="post-body"><b>{post.username}</b> {post.caption}</div>}
    {post.hashtags?.length>0&&<div className="post-tag-list" aria-label="Hashtags">
      {post.hashtags.map(tag=><button type="button" key={tag}
        onClick={()=>{window.location.hash=`#/home?tag=${encodeURIComponent(tag)}`;}}>
        #{tag}</button>)}
    </div>}
    {post.link_url&&<a className="post-external-link" href={post.link_url}
      target="_blank" rel="noopener noreferrer nofollow"
      title="Abrir recurso astronómico externo"><ExternalLink size={17}/>
      <span>{(()=>{try{return new URL(post.link_url).hostname;}catch{return 'Abrir enlace';}})()}</span>
      <small>Recurso externo</small>
    </a>}
    {region && <button className="inline-explore" onClick={()=>onExplore(region.id)}><AstroGlyph name="telescope" size={17}/> Abrir en el explorador · D{region.detector} · {region.fov_arcmin}′</button>}
    {error && <div className="inline-message" role="alert">{error}</div>}
    {notice && <div className="inline-message success" role="status">{notice}</div>}
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
