import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bookmark, Check, LogOut, Settings, Users } from 'lucide-react';
import AstroGlyph from './components/AstroGlyph';
import PublishModal, {type PublishRegion} from './components/PublishModal';
import BrandLogo from './components/BrandLogo';
import { formatRa, formatDec } from './lib/coordinates';
import { getGameStreak } from './lib/gameStreak';
import { feedSidebarStickyTop } from './lib/sidebarScroll';
import { api, hasToken, type Post, type Profile, type UserStats } from './lib/api';
import PostCard, { Avatar } from './components/PostCard';
import PostBlinkPreview from './components/PostBlinkPreview';
import PostMediaGallery from './components/PostMediaGallery';
import NotificationsPage from './components/NotificationsPage';
import PostDetailPage from './components/PostDetailPage';
import ExplorerPage from './pages/ExplorerPage';
import BackgroundSkyDock, { type ExplorerBackgroundStatus } from './components/BackgroundSkyDock';
import { isTerminalSkyPhase, shouldShowSkyDock } from './lib/skyDock';
import GamePage from './pages/GamePage';
import HeroStarfield from './components/HeroStarfield';
import OnboardingTour from './components/OnboardingTour';
import { TASKS, TASK_EVENT, NUDGE_EVENT, explorerSteps, gameSteps, isTaskKey,
  nudgeStep, publishingSteps, readFlag, readTasks, saveTasks, signalTask,
  storageKey, welcomeSteps, writeFlag,
  type TaskProgress, type TourSpec, type NudgeKey } from './lib/onboarding';

type Route = {page: 'home'|'explore'|'game'|'profile'|'settings'|'saved'|'activity'|'post'; username?:string; observationId?:string; ra?:number; dec?:number; tag?:string; postId?:string; comments?:boolean};
const quick = [
  {name:'WISE 0855',ra:133.795129,dec:-7.245147,desc:'Enana marrón cercana'},
  {name:'Estrella de Barnard',ra:269.4521,dec:4.6934,desc:'Gran movimiento propio'},
  {name:'Luhman 16',ra:162.299,dec:-53.318,desc:'Sistema de enanas marrones'},
];
function parseRoute():Route {
  const h=decodeURIComponent(window.location.hash.replace(/^#\/?/,''));
  if(!h) {
    const id=new URLSearchParams(window.location.search).get('observation_id');
    return id ? {page:'explore',observationId:id} : {page:'home'};
  }
  const [path,query] = h.split('?');
  const parts=path.split('/');
  const params=new URLSearchParams(query||'');
  if(parts[0]==='home')return {page:'home',tag:params.get('tag')||undefined};
  if(parts[0]==='explore')return {page:'explore',observationId:params.get('observation_id')||undefined,
    ra:params.has('ra')?Number(params.get('ra')):undefined,
    dec:params.has('dec')?Number(params.get('dec')):undefined};
  if(parts[0]==='u'&&parts[1])return {page:'profile',username:parts[1]};
  if(parts[0]==='post'&&parts[1])return {page:'post',postId:parts[1],comments:params.get('comments')==='1'};
  if(parts[0]==='settings'||parts[0]==='game'||parts[0]==='saved'||parts[0]==='activity')return {page:parts[0]};
  return {page:'home'};
}
function go(path:string) { window.location.hash=`#/${path}`; }
const message=(e:unknown) => e instanceof Error?e.message:'Ocurrió un error inesperado';

function AuthPage({onSuccess,onExplore}:{onSuccess:(user:Profile)=>void;onExplore:()=>void}){
  const [mode,setMode]=useState<'register'|'login'>('register');
  const [username,setUsername]=useState(''),[displayName,setDisplayName]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState('');
  const [show,setShow]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();setError('');
    if(mode==='register'){
      if(!/^[a-z][a-z0-9_]{2,31}$/i.test(username.trim())){setError('Usuario: 3–32 caracteres, empieza con una letra; usa letras, números y _.');return;}
      if(!displayName.trim()){setError('Introduce un nombre para mostrar.');return;}
      if(password.length<10){setError('La contraseña debe tener al menos 10 caracteres.');return;}
      if(password!==confirm){setError('Las contraseñas no coinciden.');return;}
    }
    setBusy(true);
    try{
      if(mode==='register')await api.register({username:username.trim().toLowerCase(),display_name:displayName.trim(),email:email.trim(),password});
      await api.login(email.trim(),password);
      onSuccess(await api.me());
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  return <div className="auth">
    <div className="hero"><HeroStarfield/>
      <img className="auth-brand-art" src="/astrogram-logo.svg" alt="Logo de AstroGram" decoding="async"/>
      <div className="txt">
      <div className="logo"><BrandLogo size={34}/><span>AstroGram</span></div>
      <h1>Mira cómo se <span className="grad">mueve</span> el universo.</h1>
      <p>Compara imágenes del cielo tomadas por la misión SPHEREx, encuentra lo que cambió y comparte tu hallazgo con otros astrónomos.</p>
    </div></div>
    <section className="authbox">
      <div className="logo auth-logo"><BrandLogo size={36}/><span>AstroGram</span></div>
      <h2>{mode==='register'?'Crea tu cuenta':'Bienvenida de vuelta'}</h2>
      <div className="tabs"><button type="button" className={mode==='register'?'on':''} onClick={()=>{setMode('register');setError('')}}>Registrarse</button>
        <button type="button" className={mode==='login'?'on':''} onClick={()=>{setMode('login');setError('')}}>Entrar</button></div>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <form onSubmit={e=>void submit(e)}>
        {mode==='register'&&<><div className="field"><label htmlFor="username">Nombre de usuario</label><input id="username" autoComplete="username" maxLength={32} value={username} onChange={e=>setUsername(e.target.value)} placeholder="luna_07" required/></div>
          <div className="field"><label htmlFor="displayName">Nombre para mostrar</label><input id="displayName" maxLength={80} value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="Luna Ríos" required/></div></>}
        <div className="field"><label htmlFor="email">Correo</label><input id="email" type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@correo.com" required/></div>
        <div className="field"><label htmlFor="password">Contraseña{mode==='register'?' (mínimo 10 caracteres)':''}</label>
          <div className="pw"><input id="password" type={show?'text':'password'} autoComplete={mode==='login'?'current-password':'new-password'}
            minLength={mode==='register'?10:undefined} value={password} onChange={e=>setPassword(e.target.value)} required/>
            <button type="button" onClick={()=>setShow(v=>!v)}>{show?'ocultar':'ver'}</button></div>
          {mode==='register'&&<div className="meter"><i style={{width:`${Math.min(100,password.length*7)}%`,background:password.length<10?'#ff6b7a':'#7ce38b'}}/></div>}</div>
        {mode==='register'&&<div className="field"><label htmlFor="confirm">Repite la contraseña</label><input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required/></div>}
        <button type="submit" className="btn p full" disabled={busy}>{busy?'Conectando…':mode==='register'?'Crear cuenta':'Entrar'}</button>
      </form>
      <button type="button" className="auth-explore" onClick={onExplore}>Explorar el cielo sin cuenta →</button>
    </section>
  </div>;
}

function FeedPage({user,onProfile,onExplore,onLogin,onPublish,tasks,guideHidden,onHideGuide,tag}:{
  user:Profile;onProfile:(u:string)=>void;onExplore:(id:string)=>void;onLogin:()=>void;onPublish:()=>void;
  tasks:TaskProgress;guideHidden:boolean;onHideGuide:()=>void;tag?:string;
}){
  const [posts,setPosts]=useState<Post[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [offset,setOffset]=useState(0);
  const [more,setMore]=useState(true);
  const streak=getGameStreak();
  const completed=TASKS.filter(task=>tasks[task.key]).length;
  const sidebarRef=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    const sidebar=sidebarRef.current;
    if(!sidebar)return;
    // Tall sidebars must scroll naturally until the bottom becomes visible;
    // after that they can stick above the viewport's bottom safe margin.
    // A short sidebar keeps its familiar top-sticky behaviour.
    const updatePosition=()=>{
      const height=sidebar.getBoundingClientRect().height;
      const offset=feedSidebarStickyTop(window.innerHeight,height);
      sidebar.style.setProperty('--feed-side-sticky-top',`${offset}px`);
    };
    const observer=typeof ResizeObserver!=='undefined'
      ?new ResizeObserver(updatePosition):null;
    observer?.observe(sidebar);
    window.addEventListener('resize',updatePosition);
    updatePosition();
    return()=>{
      observer?.disconnect();
      window.removeEventListener('resize',updatePosition);
    };
  },[guideHidden]);
  async function fetchFeed(reset=false){
    setLoading(true);setError('');
    try{
      const nextOffset=reset?0:offset;
      const data=await api.feed(10,nextOffset,tag);
      setPosts(prev=>reset?data:[...prev,...data.filter(p=>!prev.some(o=>o.id===p.id))]);
      setOffset(nextOffset+data.length);setMore(data.length===10);
    }catch(e){setError(message(e));}finally{setLoading(false);}
  }
  useEffect(()=>{void fetchFeed(true);},[]);
  return <div className="wrap feed-layout">
    <main className="feed" aria-label="Feed AstroGram">
      {tag&&<div className="feed-tag-filter"><span>Publicaciones con <b>#{tag}</b></span>
        <button type="button" onClick={()=>go('home')}>Mostrar todas</button></div>}
      {posts.map(post=><PostCard key={post.id} post={post} onProfile={onProfile} onExplore={onExplore} onRequireLogin={onLogin} currentUsername={user.username}/>)}
      {posts.length===0&&!loading&&!error&&<div className="card empty">Aún no hay publicaciones públicas. ¡Comparte la primera observación!</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {loading&&<div className="card empty">Cargando publicaciones…</div>}
      {!loading&&more&&<button type="button" className="btn more-posts" onClick={()=>void fetchFeed()}>Cargar más publicaciones</button>}
      {!loading&&posts.length>0&&<button type="button" className="refresh-feed" onClick={()=>void fetchFeed(true)}>Actualizar feed</button>}
    </main>
    <aside ref={sidebarRef} className="side" aria-label="Explorar y perfil">
      {!guideHidden && <section className="card first-steps" data-tour="first-steps">
        <div className="card-h"><span><AstroGlyph name="ship" size={18}/> Primeros pasos</span>
          <span className="chip">{completed}/{TASKS.length}</span></div>
        <div className="first-steps-progress" role="progressbar" aria-label="Misiones completadas"
          aria-valuemin={0} aria-valuemax={TASKS.length} aria-valuenow={completed}>
          <span style={{width:`${completed/TASKS.length*100}%`}}/>
        </div>
        <div className="first-steps-links">
          {TASKS.map(task=><button type="button" key={task.key}
            className={tasks[task.key]?'onboard-mission done':'onboard-mission'}
            aria-label={`${task.title}${tasks[task.key]?', completada':''}`}
            onClick={()=>task.route==='publish'?onPublish():go(task.route)}>
            <span className="onboard-mission-icon">{tasks[task.key]
              ? <Check size={16} strokeWidth={3}/>
              : <AstroGlyph name={task.icon} size={17}/>}</span>
            <span>{task.title}</span>
          </button>)}
        </div>
        <button type="button" className="first-steps-hide" onClick={onHideGuide}>Ocultar</button>
      </section>}
      <button type="button" className="card streak" onClick={()=>go('game')}>
        <div className="streak-counter"><AstroGlyph name="flame" size={29} className={streak.count>0?'streak-active':'streak-inactive'}/>
          <span className="n">{streak.count}</span></div>
        <div className="streak-text"><b>Racha del juego</b>
          <small>{streak.playedToday?'Ya jugaste hoy. ¡Vuelve mañana!':'Hoy te espera un reto nuevo'}</small></div>
      </button>
      <section className="card">
        <div className="card-h"><span><AstroGlyph name="telescope" size={17}/> Explora el cielo</span><span className="chip">SPHEREx</span></div>
        <ul className="trend">
          {quick.map(item=><li key={item.name}>
            <button type="button" className="trend-link" onClick={()=>go(`explore?ra=${item.ra}&dec=${item.dec}`)}>
              <AstroGlyph name="spark" size={17}/>
              <span><b>{item.name}</b><small>RA {formatRa(item.ra)} · Dec {formatDec(item.dec)}</small></span>
            </button>
          </li>)}
        </ul>
      </section>
      <button className="card mini-profile" type="button" onClick={()=>onProfile(user.username)}>
        <Avatar name={user.username} size={48}/>
        <span className="mini-profile-details"><b>{user.display_name}</b><small>@{user.username}</small></span>
      </button>
      <p className="feed-disclaimer">Las publicaciones con observación muestran vistas reales preliminares de SPHEREx cuando hay al menos dos épocas. El parpadeo no confirma por sí solo movimiento propio.</p>
    </aside>
  </div>;
}

function ProfilePage({username,current,onExplore,onLogin}:{username:string;current:Profile|null;onExplore:(id:string)=>void;onLogin:()=>void}){
  const [person,setPerson]=useState<Profile|null>(null),[stats,setStats]=useState<UserStats|null>(null);
  const [posts,setPosts]=useState<Post[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const mine=current?.username===username;
  const selectedPost=posts.find(post=>post.id===selectedId);
  useEffect(()=>{
    if(!selectedId)return;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelectedId(null);};
    document.addEventListener('keydown',escape);
    return ()=>{document.body.style.overflow=oldOverflow;document.removeEventListener('keydown',escape);};
  },[selectedId]);
  useEffect(()=>{
    let active=true;setPerson(null);setError('');setSelectedId(null);
    Promise.all([api.user(username),api.stats(username),api.userPosts(username)]).then(([p,s,items])=>{
      if(active){setPerson(p);setStats(s);setPosts(items);}
    }).catch(e=>{if(active)setError(message(e))});
    return ()=>{active=false};
  },[username,current?.username]);
  async function refreshPosts(){
    try {setPosts(await api.userPosts(username));}
    catch(e) {setError(message(e));}
  }
  async function follow(){
    if(!hasToken()){onLogin();return;}
    if(!stats)return;setBusy(true);
    try{
      if(stats.is_following)await api.unfollow(username);else await api.follow(username);
      setStats(await api.stats(username));
    }catch(e){setError(message(e))}finally{setBusy(false)}
  }
  return <main className="wrap single profile-layout">
    {error&&<div className="form-error" role="alert">{error}</div>}
    {!person?<div className="card empty">Cargando perfil…</div>:<>
      <div className="card phead"><div className="profile-avatar"><Avatar name={person.username} size={84}/></div><div className="profile-summary"><h1>{person.display_name}</h1><div className="un">@{person.username}</div>
        <p className={person.bio?'':'profile-bio-placeholder'}>{person.bio||(mine?'Añade una bio para contarle al universo quién eres.':'Sin bio todavía.')}</p>
        <div className="stats"><span><b>{posts.length}</b> publicaciones y compartidos</span><span><b>{stats?.followers_count??0}</b> seguidores</span>
          <span><b>{stats?.following_count??0}</b> siguiendo</span>
          <span><b>{new Date(person.created_at).toLocaleDateString('es',{month:'short',year:'numeric'})}</b> se unió</span></div>
        <div className="profile-buttons">{mine?<><button className="btn sm" onClick={()=>go('settings')}><Settings size={15}/> Editar perfil</button><button className="btn sm" onClick={()=>go('saved')}><Bookmark size={15}/> Guardados</button></>:
          <button className="btn p sm" disabled={busy} onClick={()=>void follow()}><Users size={15}/> {stats?.is_following?'Siguiendo':'Seguir'}</button>}</div>
      </div></div>
      <div className="profile-observation-heading card-h"><span>Observaciones y compartidos</span><span className="chip">{posts.length}</span></div>
      <div className="profile-posts">
        {posts.map(post=><div key={post.id} className="profile-tile" role="button" tabIndex={0}
          aria-label={`Abrir publicación de ${post.username}: ${post.caption.slice(0,80)}`}
          onClick={()=>setSelectedId(post.id)}
          onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelectedId(post.id);}}}>
          {post.media?.length>0
            ? <PostMediaGallery postId={post.id} media={post.media} compact/>
            : post.observation_id
              ? <PostBlinkPreview postId={post.id} onExplore={()=>setSelectedId(post.id)}/>
              : <div className="profile-text-tile"><AstroGlyph name="galaxy" size={34}/>
                  <span>Publicación de texto</span><small>Idea de la comunidad</small></div>}
          <div className="profile-tile-label">
            {post.reposted_by&&<span className="profile-tile-share">Compartido por @{post.reposted_by}</span>}
            <strong>@{post.username}</strong>
            <span>{post.caption}</span>
          </div>
        </div>)}
        {posts.length===0&&<div className="empty">Sin publicaciones visibles.</div>}
      </div>
    </>}
    {selectedPost&&<div className="modal profile-post-modal" role="presentation"
      onMouseDown={event=>{if(event.target===event.currentTarget)setSelectedId(null);}}>
      <div className="profile-post-dialog" role="dialog" aria-modal="true" aria-label="Publicación completa">
        <div className="profile-post-dialog-top">
          <span><AstroGlyph name="galaxy" size={18}/> Publicación de @{selectedPost.username}</span>
          <button type="button" onClick={()=>setSelectedId(null)} aria-label="Cerrar publicación">✕</button>
        </div>
        <PostCard key={selectedPost.id} post={selectedPost}
          onProfile={name=>{setSelectedId(null);go(`u/${encodeURIComponent(name)}`);}}
          onExplore={id=>{setSelectedId(null);onExplore(id);}}
          onRequireLogin={onLogin} currentUsername={current?.username}
          onRepostChange={()=>void refreshPosts()}/>
      </div>
    </div>}
  </main>;
}

function SavedPage({onExplore,onProfile,onLogin,currentUsername}:{onExplore:(id:string)=>void;onProfile:(u:string)=>void;onLogin:()=>void;currentUsername?:string}){
  const [posts,setPosts]=useState<Post[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;api.bookmarks().then(data=>{if(active)setPosts(data)}).catch(e=>{if(active)setError(message(e))})
    .finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
  return <main className="wrap narrow saved-page"><h1><Bookmark size={24}/> Guardados</h1>
    <p className="muted">Solo tú puedes consultar tus publicaciones guardadas.</p>
    {error&&<p className="form-error">{error}</p>}
    {loading?<div className="card empty">Cargando…</div>:posts.length===0?<div className="card empty">Todavía no guardaste publicaciones.</div>:posts.map(p=><PostCard key={p.id} post={p} onProfile={onProfile} onExplore={onExplore} onRequireLogin={onLogin}
      currentUsername={currentUsername} onBookmarkChange={(id,saved)=>{
        if(!saved)setPosts(current=>current.filter(item=>item.id!==id));
      }}/>)}
  </main>;
}

function SettingsPage({user,onUpdate,onLogout,onReplayTour,onShowGuide}:{
  user:Profile;onUpdate:(p:Profile)=>void;onLogout:()=>void;
  onReplayTour:()=>void;onShowGuide:()=>void;
}){
  const [name,setName]=useState(user.display_name),[bio,setBio]=useState(user.bio??'');
  const [error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
  async function update(event:FormEvent){
    event.preventDefault();setSaved(false);setError('');setBusy(true);
    try{const updated=await api.patchMe({display_name:name.trim(),bio:bio.trim()||null});
      onUpdate(updated);if(updated.bio?.trim())signalTask('bio');setSaved(true);}
    catch(e){setError(message(e))}finally{setBusy(false)}
  }
  return <main className="wrap narrow settings-page">
    <div className="card"><div className="card-h"><span><AstroGlyph name="gear" size={17}/> Ajustes</span><span className="chip">@{user.username}</span></div>
      <form className="sec" onSubmit={e=>void update(e)}>
        <h3>Editar perfil</h3><p>Actualiza tu nombre visible y biografía.</p>
        <div className="field"><label htmlFor="editName">Nombre para mostrar</label><input id="editName" minLength={1} maxLength={80} value={name} onChange={e=>setName(e.target.value)} required/></div>
        <div className="field"><label htmlFor="bio">Biografía</label><textarea id="bio" maxLength={500} value={bio} onChange={e=>setBio(e.target.value)}/></div>
        {error&&<p className="form-error" role="alert">{error}</p>}{saved&&<p className="success-note">Cambios guardados.</p>}
        <button className="btn p" type="submit" disabled={busy}>{busy?'Guardando…':'Guardar perfil'}</button>
      </form>
      <div className="sec onboarding-settings">
        <h3>Aprender AstroGram</h3>
        <p>Puedes repetir la guía de bienvenida o recuperar las misiones que ocultaste.
          Tu progreso no se reiniciará.</p>
        <div className="mrow">
          <button type="button" className="btn" onClick={onReplayTour}>
            <AstroGlyph name="telescope" size={16}/> Repetir recorrido
          </button>
          <button type="button" className="btn" onClick={onShowGuide}>
            <AstroGlyph name="ship" size={16}/> Ver primeros pasos
          </button>
        </div>
      </div>
      <div className="sec"><h3>Cuenta</h3><p>El cambio y recuperación de contraseña todavía no están implementados en FastAPI.</p>
        <div className="row"><span>Correo</span><b>{user.email??'—'}</b></div>
        <button className="btn danger" onClick={onLogout}><LogOut size={16}/> Cerrar sesión</button></div>
    </div>
  </main>;
}

export default function App(){
  const [route,setRoute]=useState<Route>(parseRoute);
  const [user,setUser]=useState<Profile|null>(null);
  const [unreadCount,setUnreadCount]=useState(0);
  const [checking,setChecking]=useState(true);
  const [publish,setPublish]=useState(false);
  const [feedVersion,setFeedVersion]=useState(0);
  const [publishRegion,setPublishRegion]=useState<PublishRegion|null>(null);
  const [search,setSearch]=useState('');
  const [toast,setToast]=useState('');
  // Ephemeral notifications must never require a click to disappear.
  useEffect(()=>{
    if(!toast)return;
    const timeout=window.setTimeout(()=>setToast(''),3200);
    return()=>window.clearTimeout(timeout);
  },[toast]);
  const [backgroundStatus,setBackgroundStatus]=useState<ExplorerBackgroundStatus | null>(null);
  const [dockDismissed,setDockDismissed]=useState(false);
  const [missions,setMissions]=useState<TaskProgress>({});
  const [guideHidden,setGuideHidden]=useState(false);
  const [tour,setTour]=useState<TourSpec|null>(null);
  const [tourRevision,setTourRevision]=useState(0);
  const [onboardingNotice,setOnboardingNotice]=useState('');
  const [celebrate,setCelebrate]=useState(false);
  useEffect(()=>{
    if(!user){setUnreadCount(0);return;}
    let active=true;
    const refresh=()=>{
      void api.unreadNotifications()
        .then(result=>{if(active)setUnreadCount(result.unread);})
        .catch(()=>{/* Offline checks never interrupt navigation. */});
    };
    refresh();
    const interval=window.setInterval(()=>{
      if(document.visibilityState==='visible')refresh();
    },30000);
    const whenFocused=()=>{if(document.visibilityState==='visible')refresh();};
    window.addEventListener('focus',whenFocused);
    document.addEventListener('visibilitychange',whenFocused);
    return()=>{
      active=false;
      window.clearInterval(interval);
      window.removeEventListener('focus',whenFocused);
      document.removeEventListener('visibilitychange',whenFocused);
    };
  },[user?.id]);
  // Notifications belong to a job, not to its repeatedly hydrated trace.
  // Resuming an already finished job is not a new completion event.
  useEffect(()=>{setDockDismissed(false);},[backgroundStatus?.jobId]);
  useEffect(()=>{
    const status=backgroundStatus;
    const phase=status?.trace?.phase;
    if(!phase)return;
    const finished=isTerminalSkyPhase(phase);
    if(!finished)return;
    if(status?.restored || route.page==='explore'){
      setDockDismissed(true);
      return;
    }
    // Show a genuine background completion briefly, never indefinitely.
    const timer=window.setTimeout(()=>setDockDismissed(true),6500);
    return()=>window.clearTimeout(timer);
  },[backgroundStatus?.jobId,backgroundStatus?.trace?.phase,
      backgroundStatus?.restored,route.page]);
  useEffect(()=>{const listener=()=>setRoute(parseRoute());window.addEventListener('hashchange',listener);return()=>window.removeEventListener('hashchange',listener)},[]);
  useEffect(()=>{
    const otherTabLogout=(event:StorageEvent)=>{
      if(event.key!=='astrogram.auth.logout')return;
      api.clearLocalSession();
      setUser(null);setPublish(false);setTour(null);go('home');
    };
    window.addEventListener('storage',otherTabLogout);
    return()=>window.removeEventListener('storage',otherTabLogout);
  },[]);
  // Previous route state must never leave the auth page panned horizontally.
  useEffect(()=>{window.scrollTo(0,0)},[route.page,route.username,route.observationId,route.postId,user?.id]);
  useEffect(()=>{
    let active=true;
    api.restoreSession()
      .then(restored=>restored?api.me():null)
      .then(profile=>{if(active)setUser(profile);})
      .catch(()=>{if(active)setUser(null);})
      .finally(()=>{if(active)setChecking(false);});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(!user){setMissions({});setGuideHidden(false);setTour(null);return;}
    const id=user.id;
    const refresh=()=>{
      const stored=readTasks(id);
      if(user.bio?.trim()&&!stored.bio){
        stored.bio=true;saveTasks(id,stored);
      }
      setMissions(stored);
      setGuideHidden(readFlag(id,'hidden'));
    };
    refresh();
    // Existing accounts earn their already-published mission without a fake action.
    let active=true;
    api.userPosts(user.username).then(posts=>{
      if(!active || !posts.some(post=>post.username===user.username))return;
      const state=readTasks(id);
      if(!state.post){state.post=true;saveTasks(id,state);setMissions(state);}
    }).catch(()=>{/* Onboarding never interrupts the real feed. */});
    const handleStorage=(event:StorageEvent)=>{
      if(event.key?.startsWith(storageKey(id,'')))refresh();
    };
    window.addEventListener('storage',handleStorage);
    return()=>{active=false;window.removeEventListener('storage',handleStorage);};
  },[user?.id,user?.username,user?.bio]);
  useEffect(()=>{
    if(!user)return;
    const task=(event:Event)=>{
      const key=(event as CustomEvent<{key?:unknown}>).detail?.key;
      if(!isTaskKey(key))return;
      const prior=readTasks(user.id);
      if(prior[key])return;
      const updated:TaskProgress={...prior,[key]:true};
      saveTasks(user.id,updated);
      setMissions(updated);
      const completed=TASKS.filter(item=>updated[item.key]).length;
      if(completed===TASKS.length){
        setOnboardingNotice('¡Completaste los primeros pasos! Ya conoces AstroGram.');
        setCelebrate(true);
      }else{
        setOnboardingNotice(`${TASKS.find(item=>item.key===key)?.title} · ${completed}/${TASKS.length}`);
      }
    };
    window.addEventListener(TASK_EVENT,task);
    return()=>window.removeEventListener(TASK_EVENT,task);
  },[user?.id]);
  useEffect(()=>{
    if(!onboardingNotice)return;
    const timer=window.setTimeout(()=>setOnboardingNotice(''),3600);
    return()=>window.clearTimeout(timer);
  },[onboardingNotice]);
  useEffect(()=>{
    if(!celebrate)return;
    const timer=window.setTimeout(()=>setCelebrate(false),3400);
    return()=>window.clearTimeout(timer);
  },[celebrate]);
  const closeTour=useCallback((_completed:boolean)=>{
    if(user&&tour)writeFlag(user.id,tour.key);
    setTour(null);setTourRevision(n=>n+1);
  },[user?.id,tour?.key]);
  useEffect(()=>{
    if(!user||checking||tour||publish)return;
    const id=user.id;
    const isWelcome=route.page==='home'&&!readFlag(id,'welcome');
    const page=route.page==='explore'?'explore':route.page==='game'?'game':null;
    const needsPage=page&&readFlag(id,'welcome')&&!readFlag(id,`page-${page}`);
    if(!isWelcome&&!needsPage)return;
    const timer=window.setTimeout(()=>{
      if(isWelcome){
        setTour({key:'welcome',steps:welcomeSteps(
          user.display_name.trim().split(/\s+/)[0]||user.username)});
      }else if(page==='explore'){
        setTour({key:'page-explore',steps:explorerSteps});
      }else if(page==='game'){
        setTour({key:'page-game',steps:gameSteps});
      }
    },650);
    return()=>window.clearTimeout(timer);
  },[user?.id,user?.display_name,user?.username,checking,route.page,tour,publish,tourRevision]);
  useEffect(()=>{
    if(!user||!publish||tour||!readFlag(user.id,'welcome')
      ||readFlag(user.id,'publish'))return;
    const timer=window.setTimeout(()=>setTour({
      key:'publish',steps:publishingSteps(Boolean(publishRegion)),soft:true,
    }),450);
    return()=>window.clearTimeout(timer);
  },[user?.id,publish,publishRegion,tour,tourRevision]);
  useEffect(()=>{
    if(!user)return;
    const nudge=(event:Event)=>{
      const kind=(event as CustomEvent<{key?:NudgeKey}>).detail?.key;
      if(!kind||!['like','mark','game'].includes(kind)||tour
        ||!readFlag(user.id,'welcome')||readFlag(user.id,`nudge-${kind}`))return;
      setTour({key:`nudge-${kind}`,steps:[nudgeStep(kind)],soft:true});
    };
    window.addEventListener(NUDGE_EVENT,nudge);
    return()=>window.removeEventListener(NUDGE_EVENT,nudge);
  },[user?.id,tour]);
  useEffect(()=>{if(tour&&((tour.key==='publish'&&!publish)
      ||(tour.key==='page-explore'&&route.page!=='explore')
      ||(tour.key==='page-game'&&route.page!=='game')
      ||(tour.key==='welcome'&&route.page!=='home'))){
      setTour(null);
    }
  },[tour,route.page,publish]);
  function hideGuide(){
    if(!user)return;writeFlag(user.id,'hidden');setGuideHidden(true);
  }
  function showGuide(){
    if(!user)return;writeFlag(user.id,'hidden',false);setGuideHidden(false);go('home');
  }
  function replayTour(){
    if(!user)return;writeFlag(user.id,'welcome',false);setTour(null);
    setTourRevision(n=>n+1);go('home');
  }
  function loginRequired(){setToast('Inicia sesión para utilizar esta función.');go('home');}
  function navigateProfile(name:string){go(`u/${encodeURIComponent(name)}`)}
  function openObservation(id:string){go(`explore?observation_id=${encodeURIComponent(id)}`)}
  function openPublish(region:PublishRegion|null=null){
    if(!user){loginRequired();return;}setPublishRegion(region);setPublish(true);
  }
  async function logout(){
    try{await api.logout();}
    catch{setToast('No se pudo cerrar sesión en el servidor. Revisa la conexión.');return;}
    setToast('');setTour(null);setUser(null);setPublish(false);go('home');
  }
  function doSearch(event:FormEvent){event.preventDefault();const term=search.trim();if(!term)return;
    const coord=term.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if(coord)go(`explore?ra=${coord[1]}&dec=${coord[2]}`);
    else navigateProfile(term.replace(/^@/,''));setSearch('');
  }
  if(checking)return <div className="boot-screen"><BrandLogo size={44}/> Conectando con AstroGram…</div>;
  const authOnly = !user && !['explore','game'].includes(route.page);
  const explorerVisible = route.page === 'explore';
  return <div className="astrogram-shell">
    {authOnly
      ? <AuthPage onSuccess={p=>{setUser(p);go('home')}} onExplore={()=>go('explore')}/>
      : <>
    <header className="navbar"><button className="logo" onClick={()=>go('home')} aria-label="AstroGram inicio"><BrandLogo size={36}/><span>AstroGram</span></button>
      <form className="search" onSubmit={doSearch}><input data-tour="global-search" aria-label="Buscar usuario o coordenadas" value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Buscar astroamigos"/></form>
      <nav className="nav" aria-label="Navegación principal">
        <button data-tour="nav-home" className={route.page==='home'?'on':''} onClick={()=>go('home')} title="Inicio">
          <AstroGlyph name="home" size={19}/><span className="t">Inicio</span></button>
        <button data-tour="nav-explore" className={route.page==='explore'?'on':''} onClick={()=>go('explore')} title="Explorar">
          <AstroGlyph name="telescope" size={19}/><span className="t">Explorar</span></button>
        <button data-tour="nav-game" className={route.page==='game'?'on':''} onClick={()=>go('game')} title="Juego">
          <AstroGlyph name="target" size={19}/><span className="t">Juego</span></button>
        {user&&<>
          <button className={route.page==='activity'?'on':''} onClick={()=>go('activity')}
            title="Notificaciones" aria-label={`Notificaciones${unreadCount?`, ${unreadCount} sin leer`:''}`}>
            <AstroGlyph name="bell" size={19}/><span className="t">Notificaciones</span>
            {unreadCount>0&&<span className="notifications-nav-badge" aria-hidden="true">
              {unreadCount>99?'99+':unreadCount}</span>}
          </button>
          <button data-tour="nav-profile" className={route.page==='profile'?'on':''} onClick={()=>navigateProfile(user.username)} title="Perfil">
            <Avatar name={user.username} size={26}/><span className="t">Perfil</span></button>
          <button className={route.page==='settings'?'on':''} onClick={()=>go('settings')} title="Ajustes">
            <AstroGlyph name="gear" size={19}/><span className="t">Ajustes</span></button>
          <button data-tour="nav-publish" className="btn p sm newpost" onClick={()=>openPublish()}>
            <AstroGlyph name="spark" size={15}/><span className="t">Publicar</span></button>
        </>}
        {!user&&<button className="btn p sm" onClick={()=>go('home')}>Entrar</button>}
      </nav>
    </header>
      </>}
    <div className="epoch-persistent-page" style={{display:explorerVisible?'block':'none'}}>
      <ExplorerPage
        observationId={explorerVisible?route.observationId:undefined}
        initialRa={explorerVisible?route.ra:undefined}
        initialDec={explorerVisible?route.dec:undefined}
        active={explorerVisible}
        onProgress={setBackgroundStatus}
        onGoHome={()=>go('home')}
        onPublish={field=>openPublish(field)}
        onLogin={loginRequired}/>
    </div>
    {!authOnly && !explorerVisible &&
      (route.page==='game'?<GamePage onExplore={()=>go('explore')}/>:
       route.page==='profile'&&route.username?<ProfilePage username={route.username} current={user}
         onExplore={openObservation} onLogin={loginRequired}/>:
       route.page==='settings'&&user?<SettingsPage user={user} onUpdate={setUser} onLogout={logout}
          onReplayTour={replayTour} onShowGuide={showGuide}/>:
       route.page==='saved'&&user?<SavedPage onExplore={openObservation} onProfile={navigateProfile} onLogin={loginRequired} currentUsername={user.username}/>:
       route.page==='activity'&&user?<NotificationsPage onCountChanged={setUnreadCount}/>:
       route.page==='post'&&route.postId?<PostDetailPage postId={route.postId}
         showComments={Boolean(route.comments)} currentUsername={user?.username}
         onProfile={navigateProfile} onExplore={openObservation} onLogin={loginRequired}/>:
       <FeedPage key={`${feedVersion}-${route.tag??''}`} user={user!} onProfile={navigateProfile} onExplore={openObservation} onLogin={loginRequired}
          onPublish={()=>openPublish()} tasks={missions} guideHidden={guideHidden}
          onHideGuide={hideGuide} tag={route.tag}/>)}
    {toast&&!authOnly&&<div role="status" className="toast show" onClick={()=>setToast('')}>{toast}</div>}
    {publish&&!authOnly&&<PublishModal region={publishRegion} onClose={()=>setPublish(false)} onDone={()=>{if(user)writeFlag(user.id,'publish');
      setTour(null);setPublish(false);setFeedVersion(n=>n+1);
      setToast('Publicación creada en AstroGram');go('home');}}/>}
    {!authOnly&&<footer className="app-footer">AstroGram · Visualización experimental independiente · Datos SPHEREx: NASA/IPAC/IRSA · No afiliado ni respaldado por NASA.</footer>}
    {onboardingNotice&&user&&<div className="ag-onboard-toast" role="status" aria-live="polite">
      <Check size={17}/> {onboardingNotice}</div>}
    {celebrate&&user&&<div className="ag-onboard-confetti" aria-hidden="true">{Array.from({length:30},(_,i)=>
      <span key={i} style={{left:`${(i*37)%100}%`,animationDelay:`${(i%7)*.09}s`,fontSize:`${17+(i%5)*4}px`}}>
        <AstroGlyph name={i%2===0?'spark':'ship'} size={20}/>
      </span>)}</div>}
    {tour&&user&&<OnboardingTour key={tour.key} spec={tour} onClose={closeTour}/>}
    {shouldShowSkyDock(backgroundStatus,explorerVisible,dockDismissed) &&
      <BackgroundSkyDock status={backgroundStatus} onOpen={()=>{
          setDockDismissed(true);go('explore');
        }} onDismiss={()=>setDockDismissed(true)}/>}
  </div>;
}
