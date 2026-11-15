import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowRight, AtSign, Hash, LoaderCircle, Search, Telescope, X } from 'lucide-react';
import { api, type GlobalSearchResults } from '../lib/api';
import { Avatar } from './PostCard';

type Props = {
  currentQuery?:string;
  mobileOpen:boolean;
  onMobileOpenChange:(open:boolean)=>void;
  onNavigate:(path:string)=>void;
};
type Suggestion = {key:string;type:'user'|'tag'|'post'|'sky';title:string;subtitle:string;path:string;
  avatar?:GlobalSearchResults['users'][number]};

export function coordinateSearch(value:string):{ra:number;dec:number}|null{
  const matched=value.match(/^([+]?(?:\d+(?:\.\d+)?|\.\d+))\s*[, ]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
  if(!matched)return null;
  const ra=Number(matched[1]),dec=Number(matched[2]);
  return Number.isFinite(ra)&&Number.isFinite(dec)&&ra>=0&&ra<360&&dec>=-90&&dec<=90
    ? {ra,dec}:null;
}

export default function GlobalSearch({currentQuery,mobileOpen,onMobileOpenChange,onNavigate}:Props){
  const [value,setValue]=useState(currentQuery??'');
  const [focused,setFocused]=useState(false);
  const [result,setResult]=useState<GlobalSearchResults|null>(null);
  const [loading,setLoading]=useState(false);
  const [failed,setFailed]=useState(false);
  const [activeIndex,setActiveIndex]=useState(-1);
  const root=useRef<HTMLFormElement>(null);
  const input=useRef<HTMLInputElement>(null);
  const listId=useId();
  const term=value.trim();
  const valid=term.replace(/^[@#]/,'').trim().length>=2 && term.length<=80;
  const coords=coordinateSearch(term);
  const expanded=focused && (valid||Boolean(coords));

  useEffect(()=>{setValue(currentQuery??'');},[currentQuery]);
  useEffect(()=>{
    if(mobileOpen)input.current?.focus();
  },[mobileOpen]);
  useEffect(()=>{
    const globalKey=(event:globalThis.KeyboardEvent)=>{
      if(!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='k')return;
      event.preventDefault();
      onMobileOpenChange(true);
      input.current?.focus();
    };
    window.addEventListener('keydown',globalKey);
    return()=>window.removeEventListener('keydown',globalKey);
  },[onMobileOpenChange]);
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{
      if(root.current&&!root.current.contains(event.target as Node)){
        setFocused(false);
        onMobileOpenChange(false);
      }
    };
    document.addEventListener('pointerdown',outside);
    return()=>document.removeEventListener('pointerdown',outside);
  },[onMobileOpenChange]);
  useEffect(()=>{
    setActiveIndex(-1);setResult(null);setFailed(false);
    if(!valid || !focused){setLoading(false);return;}
    const controller=new AbortController();
    setLoading(true);
    const timer=window.setTimeout(()=>{
      api.search(term,5,0,controller.signal)
        .then(data=>{if(!controller.signal.aborted)setResult(data);})
        .catch(()=>{if(!controller.signal.aborted)setFailed(true);})
        .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    },230);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[term,valid,focused]);

  const suggestions=useMemo(()=>{
    const items:Suggestion[]=[];
    if(coords){
      items.push({key:'sky',type:'sky',title:'Explorar coordenadas',
        subtitle:'RA '+coords.ra+'° · Dec '+coords.dec+'°',
        path:'explore?ra='+coords.ra+'&dec='+coords.dec});
    }
    if(result){
      for(const person of result.users.slice(0,4)){
        items.push({key:'user-'+person.username,type:'user',title:person.display_name,
          subtitle:'@'+person.username,path:'u/'+encodeURIComponent(person.username),avatar:person});
      }
      for(const tag of result.hashtags.slice(0,3)){
        items.push({key:'tag-'+tag.tag,type:'tag',title:'#'+tag.tag,
          subtitle:tag.posts_count+' publicaciones públicas',
          path:'home?tag='+encodeURIComponent(tag.tag)});
      }
      for(const post of result.posts.slice(0,4)){
        items.push({key:'post-'+post.id,type:'post',title:'@'+post.username,
          subtitle:post.caption.trim().slice(0,120)||'Publicación astronómica',
          path:'post/'+encodeURIComponent(post.id)});
      }
    }
    return items;
  },[result,coords]);

  function navigate(path:string){
    onNavigate(path);setValue('');setFocused(false);setActiveIndex(-1);
    onMobileOpenChange(false);
    input.current?.blur();
  }
  function fullSearch(){
    if(coords){navigate('explore?ra='+coords.ra+'&dec='+coords.dec);return;}
    if(!valid)return;
    navigate('search?q='+encodeURIComponent(term));
  }
  function submit(event:FormEvent){
    event.preventDefault();
    if(activeIndex>=0&&suggestions[activeIndex]){
      navigate(suggestions[activeIndex].path);
    }else fullSearch();
  }
  function keyDown(event:KeyboardEvent<HTMLInputElement>){
    if(event.key==='Escape'){
      event.preventDefault();setFocused(false);onMobileOpenChange(false);input.current?.blur();
    }else if(event.key==='ArrowDown'&&expanded){
      event.preventDefault();setActiveIndex(i=>Math.min(suggestions.length-1,i+1));
    }else if(event.key==='ArrowUp'&&expanded){
      event.preventDefault();setActiveIndex(i=>Math.max(-1,i-1));
    }
  }

  return <form ref={root}
    className={'search global-search'+(mobileOpen?' mobile-open':'')}
    role="search" onSubmit={submit}>
    <div className="global-search-input-shell">
      <Search size={17} aria-hidden="true"/>
      <input ref={input} data-tour="global-search" type="search"
        autoComplete="off" maxLength={80}
        aria-label="Buscar usuarios, publicaciones, hashtags o coordenadas"
        aria-expanded={expanded} aria-controls={expanded?listId:undefined}
        aria-activedescendant={activeIndex>=0&&expanded ? listId+'-'+activeIndex:undefined}
        value={value} onChange={event=>setValue(event.target.value)}
        onKeyDown={keyDown}
        onFocus={()=>setFocused(true)}
        placeholder="Buscar personas, publicaciones, #temas…"/>
      {term&&<button type="button" className="global-search-clear" title="Borrar búsqueda"
        aria-label="Borrar búsqueda" onClick={()=>{setValue('');input.current?.focus();}}>
        <X size={16}/>
      </button>}
      {loading&&<LoaderCircle size={15} className="spin global-search-busy" aria-label="Buscando"/>}
    </div>
    {expanded&&<div className="global-search-menu" id={listId} role="listbox"
      aria-label="Sugerencias de búsqueda">
      <div className="global-search-menu-caption">
        <span>{coords?'Coordenadas del cielo':'Resultados rápidos'}</span>
        <small>Enter para ver todos</small>
      </div>
      {suggestions.map((item,index)=><button key={item.key} type="button"
        role="option" id={listId+'-'+index} aria-selected={activeIndex===index}
        className={'global-search-suggestion'+(activeIndex===index?' active':'')}
        onMouseEnter={()=>setActiveIndex(index)}
        onClick={()=>navigate(item.path)}>
        <span className="global-search-result-icon">
          {item.type==='user'&&item.avatar
            ? <Avatar name={item.avatar.username} size={32}
                version={item.avatar.avatar_version}
                colorStart={item.avatar.avatar_color_start}
                colorEnd={item.avatar.avatar_color_end}/>
            : item.type==='tag'?<Hash size={17}/>
            : item.type==='sky'?<Telescope size={18}/>:<Search size={17}/>}
        </span>
        <span className="global-search-result-copy">
          <strong>{item.title}</strong><small>{item.subtitle}</small>
        </span>
        <ArrowRight size={15} className="global-search-arrow"/>
      </button>)}
      {loading&&suggestions.length===0&&
        <p className="global-search-message" role="status">Buscando coincidencias…</p>}
      {failed&&<p className="global-search-message" role="alert">
        No se pudo completar la búsqueda. Puedes presionar Enter para reintentar.
      </p>}
      {!loading&&!failed&&!suggestions.length&&
        <p className="global-search-message">No se encontraron coincidencias.</p>}
      {valid&&<button type="button" className="global-search-all"
        onClick={fullSearch}>Ver todos los resultados de «{term}» <ArrowRight size={15}/></button>}
    </div>}
  </form>;
}
