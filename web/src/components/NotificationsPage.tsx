import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, CheckCheck, Heart, MessageCircle, Repeat2,
  RefreshCw, UserPlus, CornerDownRight } from 'lucide-react';
import { api, type AstroNotification } from '../lib/api';
import { subscribeRealtime } from '../lib/realtime';
import { Avatar } from './PostCard';

const descriptors = {
  like: {verb:'le dio un Me encoheta a tu publicación',icon:Heart},
  comment: {verb:'comentó tu publicación',icon:MessageCircle},
  reply: {verb:'respondió a tu comentario',icon:CornerDownRight},
  repost: {verb:'compartió tu publicación en su perfil',icon:Repeat2},
  follow: {verb:'comenzó a seguirte',icon:UserPlus},
} as const;

function relativeTime(date:string):string{
  const delta=Math.max(0,Date.now()-new Date(date).getTime());
  if(!Number.isFinite(delta))return '';
  const minutes=Math.floor(delta/60000);
  if(minutes<1)return 'Ahora';
  if(minutes<60)return `Hace ${minutes} min`;
  if(minutes<1440)return `Hace ${Math.floor(minutes/60)} h`;
  if(minutes<10080)return `Hace ${Math.floor(minutes/1440)} d`;
  return new Date(date).toLocaleDateString('es',{day:'numeric',month:'short',year:'numeric'});
}

export default function NotificationsPage({onCountChanged}:{
  onCountChanged:(count:number)=>void;
}){
  const [notifications,setNotifications]=useState<AstroNotification[]>([]);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [hasMore,setHasMore]=useState(false);
  const [unread,setUnread]=useState(0);
  const pageSize=20;

  const refresh=useCallback(async()=>{
    try{
      const [items,summary]=await Promise.all([
        api.notifications(pageSize,0),api.unreadNotifications(),
      ]);
      setNotifications(items);setHasMore(items.length===pageSize);
      setUnread(summary.unread);onCountChanged(summary.unread);setError('');
    }catch(e){
      setError(e instanceof Error?e.message:'No se pudieron cargar las notificaciones.');
    }finally{setLoading(false);}
  },[onCountChanged]);
  useEffect(()=>{
    void refresh();
    const unsubscribe=subscribeRealtime(change=>{
      if(change.kind==='notifications'||change.kind==='resync')void refresh();
    });
    const onFocus=()=>{if(document.visibilityState==='visible')void refresh();};
    window.addEventListener('focus',onFocus);
    return()=>{unsubscribe();window.removeEventListener('focus',onFocus);};
  },[refresh]);

  async function more(){
    if(busy)return;
    setBusy(true);setError('');
    try{
      const next=await api.notifications(pageSize,notifications.length);
      setNotifications(old=>[...old,...next.filter(n=>!old.some(p=>p.id===n.id))]);
      setHasMore(next.length===pageSize);
    }catch(e){setError(e instanceof Error?e.message:'No se pudieron cargar más.');}
    finally{setBusy(false);}
  }
  async function markAll(){
    if(busy||unread===0)return;
    setBusy(true);setError('');
    try{
      await api.markAllNotificationsRead();
      const now=new Date().toISOString();
      setNotifications(old=>old.map(n=>({...n,read_at:n.read_at??now})));
      setUnread(0);onCountChanged(0);
    }catch(e){setError(e instanceof Error?e.message:'No se pudieron marcar como leídas.');}
    finally{setBusy(false);}
  }
  async function openNotification(entry:AstroNotification){
    if(busy)return;
    setError('');
    if(!entry.read_at){
      try{
        await api.markNotificationRead(entry.id);
        setNotifications(items=>items.map(n=>n.id===entry.id
          ? {...n,read_at:new Date().toISOString()}:n));
        const next=Math.max(0,unread-1);
        setUnread(next);onCountChanged(next);
      }catch(e){setError(e instanceof Error?e.message:'No se pudo marcar como leída.');}
    }
    if(entry.post_id){
      window.location.hash=`#/post/${encodeURIComponent(entry.post_id)}${entry.kind==='comment'||entry.kind==='reply'?'?comments=1':''}`;
    }else{
      window.location.hash=`#/u/${encodeURIComponent(entry.actor_username)}`;
    }
  }

  return <main className="wrap narrow notifications-page" aria-label="Notificaciones de AstroGram">
    <header className="notifications-heading">
      <div><h1><Bell size={24}/> Notificaciones</h1>
        <p>Actividad real de tu comunidad astronómica.</p></div>
      <div className="notifications-actions">
        <span className="chip">{unread?unread+' sin leer':'Al día'}</span>
        <button type="button" className="btn sm" title="Actualizar" onClick={()=>void refresh()}>
          <RefreshCw size={16}/> Actualizar
        </button>
      </div>
    </header>
    <section className="card notifications-panel">
      <div className="notifications-panel-head">
        <span><Bell size={17}/> Tu actividad</span>
        <button type="button" disabled={busy||unread===0} onClick={()=>void markAll()}>
          <CheckCheck size={17}/> Marcar todas como leídas
        </button>
      </div>
      {error&&<p role="alert" className="form-error notifications-error">{error}</p>}
      {loading&&<div className="notifications-empty" role="status">
        <RefreshCw size={24}/> Consultando notificaciones…
      </div>}
      {!loading&&notifications.length===0&&<div className="notifications-empty">
        <Bell size={36}/><h2>El cielo está tranquilo</h2>
        <p>Cuando alguien te siga, comente, responda, comparta o dé un cohete a tus publicaciones, lo verás aquí.</p>
        <button type="button" className="btn p sm" onClick={()=>{window.location.hash='#/home';}}>
          Ir a Inicio
        </button>
      </div>}
      {!loading&&notifications.map(n=>{
        const information=descriptors[n.kind];
        const Icon=information.icon;
        return <button className={`notification-item ${n.read_at?'':'unread'}`}
          type="button" key={n.id}
          aria-label={`@${n.actor_username} ${information.verb}. ${n.read_at?'Leída':'Sin leer'}`}
          onClick={()=>void openNotification(n)}>
          <div className="notification-avatar"><Avatar name={n.actor_username} size={46}/>
            <span className="notification-kind-icon"><Icon size={15}/></span></div>
          <div className="notification-copy">
            <p><strong>@{n.actor_username}</strong> {information.verb}.</p>
            {n.comment_preview&&<blockquote>«{n.comment_preview}»</blockquote>}
            <small>{relativeTime(n.created_at)}</small>
          </div>
          {!n.read_at&&<span className="notification-new-dot" aria-label="Sin leer"/>}
          {n.read_at&&<Check size={15} className="notification-read-icon" aria-hidden="true"/>}
        </button>;
      })}
      {!loading&&hasMore&&<button type="button" className="notifications-more"
        disabled={busy} onClick={()=>void more()}>
        {busy?'Cargando…':'Ver notificaciones anteriores'}
      </button>}
    </section>
    <p className="notifications-footnote">Solo recibes avisos de acciones reales. Los guardados y tus propias interacciones no generan notificaciones.</p>
  </main>;
}
