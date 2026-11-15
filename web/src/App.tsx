import { useEffect, useState, type FormEvent } from 'react';
import { Bell, Bookmark, Flame, LogOut, Settings, Sparkles, Users, Star } from 'lucide-react';
import { formatRa, formatDec } from './lib/coordinates';
import { getGameStreak } from './lib/gameStreak';
import { api, hasToken, type ObservationParams, type Post, type Profile, type UserStats } from './lib/api';
import PostCard, { Avatar } from './components/PostCard';
import ExplorerPage from './pages/ExplorerPage';
import BackgroundSkyDock, { type ExplorerBackgroundStatus } from './components/BackgroundSkyDock';
import GamePage from './pages/GamePage';
import HeroStarfield from './components/HeroStarfield';

type PublishRegion = ObservationParams & {sky_job_id?:string};
type Route = {page: 'home'|'explore'|'game'|'profile'|'settings'|'saved'|'activity'; username?:string; observationId?:string; ra?:number; dec?:number};
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
  if(parts[0]==='explore')return {page:'explore',observationId:params.get('observation_id')||undefined,
    ra:params.has('ra')?Number(params.get('ra')):undefined,
    dec:params.has('dec')?Number(params.get('dec')):undefined};
  if(parts[0]==='u'&&parts[1])return {page:'profile',username:parts[1]};
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
    <div className="hero"><HeroStarfield/><div className="txt">
      <div className="logo"><span className="orb"/><span>AstroGram</span></div>
      <h1>Mira cómo se <span className="grad">mueve</span> el universo.</h1>
      <p>Compara imágenes del cielo tomadas por la misión SPHEREx, encuentra lo que cambió y comparte tu hallazgo con otros astrónomos.</p>
    </div></div>
    <section className="authbox">
      <div className="logo auth-logo"><span className="orb"/><span>AstroGram</span></div>
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
      <p className="conn"><b>● API AstroGram</b> · conectada a FastAPI y PostgreSQL</p>
    </section>
  </div>;
}

function PublishModal({region,onClose,onDone}:{region:PublishRegion|null;onClose:()=>void;onDone:()=>void}){
  const [caption,setCaption]=useState(''),[visibility,setVisibility]=useState<Post['visibility']>('public');
  const [attach,setAttach]=useState(Boolean(region)),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [savedId,setSavedId]=useState<string|null>(null);
  async function submit(e:FormEvent){
    e.preventDefault();
    if(!caption.trim()){setError('Escribe algo acerca de tu observación.');return;}
    setBusy(true);setError('');
    try{
      let observation_id:string|null=null;
      if(attach&&region){
        // Keep the created ID across retries if the post request fails.
        observation_id=savedId??(await api.createObservation({
          ra_deg:region.ra_deg,dec_deg:region.dec_deg,
          fov_arcmin:region.fov_arcmin,detector:region.detector,
        })).id;
        setSavedId(observation_id);
      }
      await api.createPost({caption:caption.trim(),visibility,observation_id,
        sky_job_id:attach && region?.sky_job_id ? region.sky_job_id : null});
      onDone();
    }catch(e){setError(message(e));}finally{setBusy(false);}
  }
  return <div className="modal" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className="mbox" role="dialog" aria-modal="true" aria-labelledby="publish-title">
      <h2 id="publish-title">✦ Publicar en AstroGram</h2>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <form onSubmit={e=>void submit(e)}>
        <div className="field"><label htmlFor="caption">¿Qué observaste?</label>
          <textarea id="caption" maxLength={3000} rows={5} required value={caption} onChange={e=>setCaption(e.target.value)}
            placeholder="Entre dos observaciones parece que este punto cambió de posición…"/></div>
        <div className="field"><label htmlFor="visibility">Visibilidad</label><select id="visibility" value={visibility} onChange={e=>setVisibility(e.target.value as Post['visibility'])}>
          <option value="public">Pública — aparece en el feed</option><option value="unlisted">No listada — solo mediante enlace</option><option value="private">Privada — solo tú</option>
        </select></div>
        {region&&<label className="attach-observation"><input type="checkbox" checked={attach} onChange={e=>setAttach(e.target.checked)}/>
          Adjuntar RA {region.ra_deg.toFixed(4)}° · Dec {region.dec_deg.toFixed(4)}° · D{region.detector}</label>}
        {!region&&<p className="hint">Puedes publicar solo texto. Para adjuntar coordenadas, abre primero el explorador.</p>}
        <p className="hint">Las coordenadas guardadas no constituyen un hallazgo astronómico confirmado.</p>
        <div className="mrow"><button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn p" disabled={busy}>{busy?'Publicando…':'Publicar'}</button></div>
      </form>
    </div>
  </div>;
}

function FeedPage({user,onProfile,onExplore,onLogin}:{
  user:Profile;onProfile:(u:string)=>void;onExplore:(id:string)=>void;onLogin:()=>void;
}){
  const [posts,setPosts]=useState<Post[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [offset,setOffset]=useState(0);
  const [more,setMore]=useState(true);
  const streak=getGameStreak();
  async function fetchFeed(reset=false){
    setLoading(true);setError('');
    try{
      const nextOffset=reset?0:offset;
      const data=await api.feed(10,nextOffset);
      setPosts(prev=>reset?data:[...prev,...data.filter(p=>!prev.some(o=>o.id===p.id))]);
      setOffset(nextOffset+data.length);setMore(data.length===10);
    }catch(e){setError(message(e));}finally{setLoading(false);}
  }
  useEffect(()=>{void fetchFeed(true);},[]);
  return <div className="wrap feed-layout">
    <main className="feed" aria-label="Feed AstroGram">
      {posts.map(post=><PostCard key={post.id} post={post} onProfile={onProfile} onExplore={onExplore} onRequireLogin={onLogin} currentUsername={user.username}/>)}
      {posts.length===0&&!loading&&!error&&<div className="card empty">Aún no hay publicaciones públicas. ¡Comparte la primera observación!</div>}
      {error&&<p className="form-error" role="alert">{error}</p>}
      {loading&&<div className="card empty">Cargando publicaciones…</div>}
      {!loading&&more&&<button type="button" className="btn more-posts" onClick={()=>void fetchFeed()}>Cargar más publicaciones</button>}
      {!loading&&posts.length>0&&<button type="button" className="refresh-feed" onClick={()=>void fetchFeed(true)}>Actualizar feed</button>}
    </main>
    <aside className="side" aria-label="Explorar y perfil">
      <button type="button" className="card streak" onClick={()=>go('game')}>
        <div className="streak-counter"><Flame size={31} className={streak.count>0?'streak-active':''}/>
          <span className="n">{streak.count}</span></div>
        <div className="streak-text"><b>Racha del juego</b>
          <small>{streak.playedToday?'Ya jugaste hoy. ¡Vuelve mañana!':'Hoy te espera un reto nuevo'}</small></div>
      </button>
      <section className="card">
        <div className="card-h"><span>🔭 Explora el cielo</span><span className="chip">SPHEREx</span></div>
        <ul className="trend">
          {quick.map(item=><li key={item.name}>
            <button type="button" className="trend-link" onClick={()=>go(`explore?ra=${item.ra}&dec=${item.dec}`)}>
              <Star size={20} aria-hidden="true" fill="currentColor" />
              <span><b>{item.name}</b><small>RA {formatRa(item.ra)} · Dec {formatDec(item.dec)}</small></span>
            </button>
          </li>)}
        </ul>
      </section>
      <button className="card mini-profile" type="button" onClick={()=>onProfile(user.username)}>
        <Avatar name={user.username} size={48}/>
        <span className="mini-profile-details"><b>{user.display_name}</b><small>@{user.username}</small></span>
      </button>
      <p className="conn live"><b>● API conectada</b> · publicaciones reales</p>
      <p className="feed-disclaimer">Las publicaciones con observación muestran vistas reales preliminares de SPHEREx cuando hay al menos dos épocas. El parpadeo no confirma por sí solo movimiento propio.</p>
    </aside>
  </div>;
}

function ProfilePage({username,current,onExplore,onLogin}:{username:string;current:Profile|null;onExplore:(id:string)=>void;onLogin:()=>void}){
  const [person,setPerson]=useState<Profile|null>(null),[stats,setStats]=useState<UserStats|null>(null);
  const [posts,setPosts]=useState<Post[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const mine=current?.username===username;
  useEffect(()=>{
    let active=true;setPerson(null);setError('');
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
      <div className="card phead"><Avatar name={person.username} size={84}/><div className="profile-summary"><h1>{person.display_name}</h1><div className="un">@{person.username}</div>
        {person.bio&&<p>{person.bio}</p>}
        <div className="stats"><span><b>{posts.length}</b> publicaciones y compartidos</span><span><b>{stats?.followers_count??0}</b> seguidores</span>
          <span><b>{stats?.following_count??0}</b> siguiendo</span></div>
        <div className="profile-buttons">{mine?<><button className="btn sm" onClick={()=>go('settings')}><Settings size={15}/> Editar perfil</button><button className="btn sm" onClick={()=>go('saved')}><Bookmark size={15}/> Guardados</button></>:
          <button className="btn p sm" disabled={busy} onClick={()=>void follow()}><Users size={15}/> {stats?.is_following?'Siguiendo':'Seguir'}</button>}</div>
      </div></div>
      <h2 className="section-title">Publicaciones y compartidos</h2>
      <div className="profile-posts">{posts.map(p=><PostCard key={p.id} post={p} onProfile={u=>go(`u/${encodeURIComponent(u)}`)}
        onExplore={onExplore} onRequireLogin={onLogin} currentUsername={current?.username}
        onRepostChange={()=>void refreshPosts()}/>)}{posts.length===0&&<div className="card empty">Sin publicaciones visibles.</div>}</div>
    </>}
  </main>;
}

function SavedPage({onExplore,onProfile,onLogin,currentUsername}:{onExplore:(id:string)=>void;onProfile:(u:string)=>void;onLogin:()=>void;currentUsername?:string}){
  const [posts,setPosts]=useState<Post[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;api.bookmarks().then(data=>{if(active)setPosts(data)}).catch(e=>{if(active)setError(message(e))})
    .finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
  return <main className="wrap narrow saved-page"><h1><Bookmark size={24}/> Guardados</h1>
    <p className="muted">Solo tú puedes consultar tus publicaciones guardadas.</p>
    {error&&<p className="form-error">{error}</p>}
    {loading?<div className="card empty">Cargando…</div>:posts.length===0?<div className="card empty">Todavía no guardaste publicaciones.</div>:posts.map(p=><PostCard key={p.id} post={p} onProfile={onProfile} onExplore={onExplore} onRequireLogin={onLogin} currentUsername={currentUsername}/>)}
  </main>;
}

function SettingsPage({user,onUpdate,onLogout}:{user:Profile;onUpdate:(p:Profile)=>void;onLogout:()=>void}){
  const [name,setName]=useState(user.display_name),[bio,setBio]=useState(user.bio??'');
  const [error,setError]=useState(''),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false);
  async function update(event:FormEvent){
    event.preventDefault();setSaved(false);setError('');setBusy(true);
    try{const updated=await api.patchMe({display_name:name.trim(),bio:bio.trim()||null});onUpdate(updated);setSaved(true);}
    catch(e){setError(message(e))}finally{setBusy(false)}
  }
  return <main className="wrap narrow settings-page">
    <div className="card"><div className="card-h"><span><Settings size={17}/> Configuración</span></div>
      <form className="sec" onSubmit={e=>void update(e)}>
        <h3>Editar perfil</h3><p>Actualiza tu nombre visible y biografía.</p>
        <div className="field"><label htmlFor="editName">Nombre para mostrar</label><input id="editName" minLength={1} maxLength={80} value={name} onChange={e=>setName(e.target.value)} required/></div>
        <div className="field"><label htmlFor="bio">Biografía</label><textarea id="bio" maxLength={500} value={bio} onChange={e=>setBio(e.target.value)}/></div>
        {error&&<p className="form-error" role="alert">{error}</p>}{saved&&<p className="success-note">Cambios guardados.</p>}
        <button className="btn p" type="submit" disabled={busy}>{busy?'Guardando…':'Guardar perfil'}</button>
      </form>
      <div className="sec"><h3>Cuenta</h3><p>El cambio y recuperación de contraseña todavía no están implementados en FastAPI.</p>
        <div className="row"><span>Correo</span><b>{user.email??'—'}</b></div>
        <button className="btn danger" onClick={onLogout}><LogOut size={16}/> Cerrar sesión</button></div>
    </div>
  </main>;
}

function ActivityPage(){
  return <main className="wrap narrow"><div className="card">
    <div className="card-h"><span><Bell size={17}/> Actividad</span></div>
    <div className="sec"><h3>Próximamente</h3><p>El diseño original incluye solicitudes de amistad, pero el backend actual utiliza seguidores. Las notificaciones y solicitudes privadas necesitan nuevos endpoints; no mostraremos solicitudes simuladas como si fueran reales.</p>
      <button className="btn sm" onClick={()=>go('home')}>Volver al feed</button></div></div>
  </main>;
}

export default function App(){
  const [route,setRoute]=useState<Route>(parseRoute);
  const [user,setUser]=useState<Profile|null>(null);
  const [checking,setChecking]=useState(hasToken());
  const [publish,setPublish]=useState(false);
  const [feedVersion,setFeedVersion]=useState(0);
  const [publishRegion,setPublishRegion]=useState<PublishRegion|null>(null);
  const [search,setSearch]=useState('');
  const [toast,setToast]=useState('');
  const [backgroundStatus,setBackgroundStatus]=useState<ExplorerBackgroundStatus | null>(null);
  const [dockDismissed,setDockDismissed]=useState(false);
  useEffect(()=>{setDockDismissed(false)},[backgroundStatus?.trace?.startedAt]);
  useEffect(()=>{const listener=()=>setRoute(parseRoute());window.addEventListener('hashchange',listener);return()=>window.removeEventListener('hashchange',listener)},[]);
  // Previous route state must never leave the auth page panned horizontally.
  useEffect(()=>{window.scrollTo(0,0)},[route.page,route.username,route.observationId,user?.id]);
  useEffect(()=>{if(!hasToken()){setChecking(false);return;}let active=true;
    api.me().then(p=>{if(active)setUser(p)}).catch(()=>{if(active){api.logout();setUser(null)}}).finally(()=>{if(active)setChecking(false)});
    return()=>{active=false};},[]);
  function loginRequired(){setToast('Inicia sesión para utilizar esta función.');go('home');}
  function navigateProfile(name:string){go(`u/${encodeURIComponent(name)}`)}
  function openObservation(id:string){go(`explore?observation_id=${encodeURIComponent(id)}`)}
  function openPublish(region:PublishRegion|null=null){
    if(!user){loginRequired();return;}setPublishRegion(region);setPublish(true);
  }
  function logout(){api.logout();setUser(null);setPublish(false);go('home');}
  function doSearch(event:FormEvent){event.preventDefault();const term=search.trim();if(!term)return;
    const coord=term.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/);
    if(coord)go(`explore?ra=${coord[1]}&dec=${coord[2]}`);
    else navigateProfile(term.replace(/^@/,''));setSearch('');
  }
  if(checking)return <div className="boot-screen"><span className="orb"/> Conectando con AstroGram…</div>;
  const authOnly = !user && !['explore','game'].includes(route.page);
  const explorerVisible = route.page === 'explore';
  return <div className="astrogram-shell">
    {authOnly
      ? <AuthPage onSuccess={p=>{setUser(p);go('home')}} onExplore={()=>go('explore')}/>
      : <>
    <header className="navbar"><button className="logo" onClick={()=>go('home')} aria-label="AstroGram inicio"><span className="orb"/><span>AstroGram</span></button>
      <form className="search" onSubmit={doSearch}><input aria-label="Buscar usuario o coordenadas" value={search} onChange={e=>setSearch(e.target.value)}
        placeholder="Usuario o coordenadas (RA, Dec)…"/></form>
      <nav className="nav" aria-label="Navegación principal">
        <button className={route.page==='home'?'on':''} onClick={()=>go('home')} title="Inicio">
          <span className="nav-emoji" aria-hidden="true">🏠</span><span className="t">Inicio</span></button>
        <button className={route.page==='explore'?'on':''} onClick={()=>go('explore')} title="Explorar">
          <span className="nav-emoji" aria-hidden="true">🔭</span><span className="t">Explorar</span></button>
        <button className={route.page==='game'?'on':''} onClick={()=>go('game')} title="Juego">
          <span className="nav-target"><Star size={18}/></span><span className="t">Juego</span></button>
        {user&&<>
          <button className={route.page==='activity'?'on':''} onClick={()=>go('activity')} title="Solicitudes (pendiente de backend)">
            <span className="nav-emoji" aria-hidden="true">🔔</span><span className="t">Solicitudes</span></button>
          <button className={route.page==='profile'?'on':''} onClick={()=>navigateProfile(user.username)} title="Perfil">
            <Avatar name={user.username} size={26}/><span className="t">Perfil</span></button>
          <button className={route.page==='settings'?'on':''} onClick={()=>go('settings')} title="Ajustes">
            <span className="nav-emoji" aria-hidden="true">⚙️</span><span className="t">Ajustes</span></button>
          <button className="btn p sm newpost" onClick={()=>openPublish()}>
            <Sparkles size={15}/><span className="t">Publicar</span></button>
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
       route.page==='settings'&&user?<SettingsPage user={user} onUpdate={setUser} onLogout={logout}/>:
       route.page==='saved'&&user?<SavedPage onExplore={openObservation} onProfile={navigateProfile} onLogin={loginRequired} currentUsername={user.username}/>:
       route.page==='activity'?<ActivityPage/>:
       <FeedPage key={feedVersion} user={user!} onProfile={navigateProfile} onExplore={openObservation} onLogin={loginRequired}/>)}
    {toast&&!authOnly&&<div role="status" className="toast show" onClick={()=>setToast('')}>{toast}</div>}
    {publish&&!authOnly&&<PublishModal region={publishRegion} onClose={()=>setPublish(false)} onDone={()=>{setPublish(false);setFeedVersion(n=>n+1);setToast('Publicación creada en AstroGram');go('home');}}/>}
    {!authOnly&&<footer className="app-footer">AstroGram · Visualización experimental independiente · Datos SPHEREx: NASA/IPAC/IRSA · No afiliado ni respaldado por NASA.</footer>}
    {!explorerVisible && !dockDismissed && backgroundStatus?.trace &&
      <BackgroundSkyDock status={backgroundStatus} onOpen={()=>go('explore')}
        onDismiss={()=>setDockDismissed(true)}/>}
  </div>;
}
