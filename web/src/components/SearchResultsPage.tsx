import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, AtSign, FileText, Hash, LoaderCircle, Search } from 'lucide-react';
import { api, type GlobalSearchResults } from '../lib/api';
import { Avatar } from './PostCard';

type Props={query:string;onNavigate:(path:string)=>void};
const PAGE_SIZE=12;

export default function SearchResultsPage({query,onNavigate}:Props){
  const [results,setResults]=useState<GlobalSearchResults|null>(null);
  const [busy,setBusy]=useState(false);
  const [moreBusy,setMoreBusy]=useState(false);
  const [error,setError]=useState('');
  const request=useRef<AbortController|null>(null);
  const currentQuery=useRef(query);
  currentQuery.current=query;

  useEffect(()=>{
    const controller=new AbortController();
    request.current=controller;
    setResults(null);setBusy(true);setMoreBusy(false);setError('');
    api.search(query,PAGE_SIZE,0,controller.signal)
      .then(data=>{if(!controller.signal.aborted)setResults(data);})
      .catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'No se pudo buscar');})
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>{controller.abort();if(request.current===controller)request.current=null;};
  },[query]);

  async function loadMore(){
    if(!results||moreBusy||busy)return;
    const offset=Math.max(results.users.length,results.posts.length,results.hashtags.length);
    const previousQuery=query;
    const controller=new AbortController();
    request.current=controller;
    setMoreBusy(true);setError('');
    try{
      // Fetch an entire page per category with one consistent offset.
      // Categories with fewer matches simply return no new rows.
      const next=await api.search(query,PAGE_SIZE,offset,controller.signal);
      if(controller.signal.aborted||currentQuery.current!==previousQuery)return;
      setResults(old=>old&&old.query===next.query?{
        ...next,
        users:[...old.users,...next.users.filter(item=>!old.users.some(oldItem=>oldItem.username===item.username))],
        posts:[...old.posts,...next.posts.filter(item=>!old.posts.some(oldItem=>oldItem.id===item.id))],
        hashtags:[...old.hashtags,...next.hashtags.filter(item=>!old.hashtags.some(oldItem=>oldItem.tag===item.tag))],
      }:old);
    }catch(err){
      if(!controller.signal.aborted)setError(err instanceof Error?err.message:'No fue posible cargar más resultados');
    }finally{
      if(!controller.signal.aborted)setMoreBusy(false);
    }
  }
  const hasMore=Boolean(results&&(results.more_users||results.more_posts||results.more_hashtags));
  const empty=Boolean(results&&!results.users.length&&!results.posts.length&&!results.hashtags.length);

  return <main className="global-results-page">
    <div className="global-results-heading">
      <button type="button" className="btn sm" onClick={()=>onNavigate('home')}>
        <ArrowLeft size={16}/> Inicio
      </button>
      <div>
        <span className="eyebrow"><Search size={14}/> BUSCADOR GLOBAL</span>
        <h1>Resultados para «{query}»</h1>
        <p>Personas, publicaciones y conversaciones astronómicas de la comunidad.</p>
      </div>
    </div>
    {busy&&<div className="card global-results-state" role="status">
      <LoaderCircle size={22} className="spin"/> Buscando coincidencias…
    </div>}
    {error&&<div className="card global-results-state" role="alert">
      {error} <button type="button" className="btn sm" onClick={()=>onNavigate('search?q='+encodeURIComponent(query))}>
        Reintentar
      </button>
    </div>}
    {empty&&<div className="card global-results-state">
      No hay resultados públicos para esta búsqueda. Prueba con otro usuario, hashtag o palabra.
    </div>}
    {results&&!empty&&<div className="global-results-grid">
      <section className="global-results-section">
        <h2><AtSign size={19}/> Personas <span>{results.users.length}</span></h2>
        <div className="global-results-list">
          {results.users.length?results.users.map(person=><button type="button"
            className="global-results-person" key={person.username}
            onClick={()=>onNavigate('u/'+encodeURIComponent(person.username))}>
            <Avatar name={person.username} size={43}
              version={person.avatar_version} colorStart={person.avatar_color_start}
              colorEnd={person.avatar_color_end}/>
            <span><strong>{person.display_name}</strong><small>@{person.username}</small>
              {person.bio&&<em>{person.bio}</em>}</span>
            <ArrowRight size={16}/>
          </button>):<p className="global-results-none">Sin personas coincidentes</p>}
        </div>
      </section>
      <section className="global-results-section">
        <h2><Hash size={19}/> Hashtags <span>{results.hashtags.length}</span></h2>
        <div className="global-results-list">
          {results.hashtags.length?results.hashtags.map(tag=><button type="button"
            className="global-results-tag" key={tag.tag}
            onClick={()=>onNavigate('home?tag='+encodeURIComponent(tag.tag))}>
            <span><strong>#{tag.tag}</strong><small>{tag.posts_count} publicaciones públicas</small></span>
            <ArrowRight size={16}/>
          </button>):<p className="global-results-none">Sin hashtags coincidentes</p>}
        </div>
      </section>
      <section className="global-results-section global-results-posts">
        <h2><FileText size={19}/> Publicaciones <span>{results.posts.length}</span></h2>
        <div className="global-results-list">
          {results.posts.length?results.posts.map(post=><button type="button"
            className="global-results-post" key={post.id}
            onClick={()=>onNavigate('post/'+encodeURIComponent(post.id))}>
            <span className="global-results-post-top"><strong>@{post.username}</strong>
              <small>{new Date(post.created_at).toLocaleDateString('es-BO')}</small></span>
            <span className="global-results-post-caption">
              {post.caption||'Observación astronómica compartida'}
            </span>
            <span className="global-results-open">Ver publicación <ArrowRight size={15}/></span>
          </button>):<p className="global-results-none">Sin publicaciones coincidentes</p>}
        </div>
      </section>
    </div>}
    {hasMore&&<button type="button" className="btn global-results-more" disabled={moreBusy}
      onClick={()=>void loadMore()}>
      {moreBusy?<LoaderCircle size={16} className="spin"/>:<ArrowRight size={16}/>}
      {moreBusy?'Cargando…':'Mostrar más resultados'}
    </button>}
  </main>;
}
