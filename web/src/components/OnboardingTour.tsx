import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import AstroGlyph from './AstroGlyph';
import type { TourSpec, TourStep } from '../lib/onboarding';

type Coordinates={top:number;left:number;above:boolean;anchorX:number}|null;
const safeIcon=(key:string|undefined):Parameters<typeof AstroGlyph>[0]['name']=>{
  const names=['home','telescope','target','bell','gear','spark','ship','galaxy','flame','pin','pen'] as const;
  return names.find(name=>name===key)??'spark';
};

export default function OnboardingTour({spec,onClose}:{spec:TourSpec;onClose:(completed:boolean)=>void}){
  const [index,setIndex]=useState(0);
  const [spot,setSpot]=useState<DOMRect|null>(null);
  const [position,setPosition]=useState<Coordinates>(null);
  const tipRef=useRef<HTMLDivElement>(null);
  const initialFocus=useRef<HTMLElement|null>(null);
  const step:TourStep=spec.steps[index];

  useEffect(()=>{
    initialFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    return()=>{initialFocus.current?.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{
    if(!spec.soft){tipRef.current?.focus({preventScroll:true});}
  },[index,spec.soft]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose(false);}
      if(event.key==='ArrowRight'&&!spec.soft){event.preventDefault();setIndex(i=>Math.min(spec.steps.length-1,i+1));}
    };
    window.addEventListener('keydown',onKey);
    return()=>window.removeEventListener('keydown',onKey);
  },[onClose,spec.soft,spec.steps.length]);
  useEffect(()=>{
    if(!spec.soft)return;
    const timer=window.setTimeout(()=>onClose(false),9000);
    return()=>window.clearTimeout(timer);
  },[spec.soft,onClose]);
  useLayoutEffect(()=>{
    let raf=0;
    const element=step?.target?document.querySelector<HTMLElement>(step.target):null;
    if(element && !spec.soft)element.scrollIntoView({block:'nearest',behavior:'auto'});
    function locate(){
      const target=step?.target?document.querySelector<HTMLElement>(step.target):null;
      const bounds=target?.getBoundingClientRect();
      const visible=Boolean(bounds&&bounds.width>0&&bounds.height>0
        &&bounds.bottom>0&&bounds.top<window.innerHeight
        &&bounds.right>0&&bounds.left<window.innerWidth);
      const tip=tipRef.current?.getBoundingClientRect();
      const width=tip?.width??300,height=tip?.height??190;
      if(!visible||!bounds){
        setSpot(null);
        setPosition({top:Math.max(12,(window.innerHeight-height)/2),
          left:Math.max(12,(window.innerWidth-width)/2),above:false,anchorX:width/2});
        return;
      }
      const gap=14;
      const pad=6;
      const fitsBelow=bounds.bottom+height+gap+pad<window.innerHeight;
      const top=fitsBelow?bounds.bottom+gap+pad:
        Math.max(12,bounds.top-height-gap-pad);
      const left=Math.min(Math.max(12,bounds.left+bounds.width/2-width/2),
        Math.max(12,window.innerWidth-width-12));
      setSpot(bounds);
      setPosition({top,left,above:!fitsBelow,
        anchorX:Math.max(18,Math.min(width-18,bounds.left+bounds.width/2-left))});
    }
    const refresh=()=>{cancelAnimationFrame(raf);raf=requestAnimationFrame(locate);};
    refresh();
    const ro=typeof ResizeObserver!=='undefined'?new ResizeObserver(refresh):null;
    if(element)ro?.observe(element);
    if(tipRef.current)ro?.observe(tipRef.current);
    window.addEventListener('resize',refresh);
    window.addEventListener('scroll',refresh,true);
    return()=>{cancelAnimationFrame(raf);ro?.disconnect();
      window.removeEventListener('resize',refresh);window.removeEventListener('scroll',refresh,true);};
  },[step,spec.soft]);
  const last=index===spec.steps.length-1;
  return <div className={`ag-tour ${spec.soft?'ag-tour--soft':''}`} role="presentation">
    {spot?<div className="ag-tour__spot" aria-hidden="true" style={{
      top:Math.max(0,spot.top-6),left:Math.max(0,spot.left-6),
      width:spot.width+12,height:spot.height+12,
    }}/>:<div className="ag-tour__veil" aria-hidden="true"/>}
    <div ref={tipRef} tabIndex={-1} role="dialog" aria-modal={!spec.soft}
      aria-label={step.title} className={`ag-tour__tip ${!spot?'ag-tour__tip--middle':''}`}
      style={position?{top:position.top,left:position.left}:{top:'45%',left:'50%',transform:'translate(-50%,-50%)'}}>
      {spec.steps.length>1&&<div className="ag-tour__segments" aria-label={`Paso ${index+1} de ${spec.steps.length}`}>
        {spec.steps.map((_,i)=><span key={i} className={i<=index?'on':''}/>)}
      </div>}
      {!spot&&<div className="ag-tour__icon"><AstroGlyph name={safeIcon(step.icon)} size={44}/></div>}
      <h3>{step.title}</h3>
      <p>{step.description}</p>
      <div className="ag-tour__footer">
        <span className="ag-tour__counter">{spec.steps.length>1?`${index+1} / ${spec.steps.length}`:''}</span>
        {!last&&<button type="button" className="ag-tour__skip" onClick={()=>onClose(false)}>Saltar</button>}
        <button type="button" className="btn p sm" onClick={()=>last?onClose(true):setIndex(i=>i+1)}>
          {last?<><Check size={14}/> {spec.soft?'Entendido':'¡Listo!'}</>:'Siguiente'}
        </button>
        {last&&<button type="button" className="ag-tour__x" aria-label="Cerrar recorrido" onClick={()=>onClose(false)}><X size={17}/></button>}
      </div>
      {spot&&position&&<span className={`ag-tour__arrow ${position.above?'above':'below'}`}
        style={{left:position.anchorX-7}} aria-hidden="true"/>}
    </div>
  </div>;
}
