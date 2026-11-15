import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, Rocket, Sparkles, X } from 'lucide-react';
import AstroGlyph from './AstroGlyph';
import { TASKS } from '../lib/onboarding';

/**
 * One-time-on-unlock (manual replay available) visual finale.
 * This dialog is not timed: the achievement stays visible until dismissed.
 * Decorations are CSS-only and stop completely under reduced motion.
 */
export default function MissionFinale({onClose}:{onClose:()=>void}){
  const dialogRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const previouslyFocused=document.activeElement instanceof HTMLElement
      ? document.activeElement:null;
    const originalOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    dialogRef.current?.focus({preventScroll:true});
    const handleKey=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();onClose();return;}
      if(event.key!=='Tab')return;
      const items=Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),[href]:not([tabindex="-1"])')??[]);
      if(!items.length)return;
      const first=items[0],last=items[items.length-1];
      if(event.shiftKey && (document.activeElement===first || document.activeElement===dialogRef.current)){
        event.preventDefault();last.focus();
      }else if(!event.shiftKey && document.activeElement===last){
        event.preventDefault();first.focus();
      }
    };
    document.addEventListener('keydown',handleKey);
    return()=>{
      document.removeEventListener('keydown',handleKey);
      document.body.style.overflow=originalOverflow;
      previouslyFocused?.focus({preventScroll:true});
    };
  },[onClose]);

  return createPortal(<div className="mission-finale" role="presentation">
    <div className="mission-finale-cosmos" aria-hidden="true">
      <div className="mission-finale-aurora"/>
      {Array.from({length:62},(_,i)=><span key={i}
        className={'mission-finale-particle '+(i%4===0?'is-spark':'is-stardust')}
        style={{
          left:String((i*47+11)%100)+'%',
          animationDelay:String((i%13)*.115)+'s',
          animationDuration:String(3.2+(i%6)*.35)+'s',
        }}/>)}
    </div>
    <div className="mission-finale-panel" ref={dialogRef} tabIndex={-1}
      role="dialog" aria-modal="true"
      aria-labelledby="mission-finale-title"
      aria-describedby="mission-finale-description">
      <button type="button" className="mission-finale-close" data-sound="close"
        aria-label="Cerrar celebración" onClick={onClose}>
        <X size={19}/>
      </button>
      <div className="mission-finale-emblem" aria-hidden="true">
        <span className="mission-finale-orbit orbit-one"/>
        <span className="mission-finale-orbit orbit-two"/>
        <span className="mission-finale-orbit orbit-three"/>
        <span className="mission-finale-emblem-core">
          <Rocket size={51} strokeWidth={1.55}/>
        </span>
        <Sparkles size={24} className="mission-finale-spark spark-a"/>
        <Sparkles size={17} className="mission-finale-spark spark-b"/>
      </div>
      <div className="mission-finale-copy">
        <span className="mission-finale-kicker">
          <Sparkles size={15}/> TRAYECTORIA COMPLETADA <Sparkles size={15}/>
        </span>
        <h2 id="mission-finale-title">¡MISIÓN CUMPLIDA!</h2>
        <p id="mission-finale-description">
          Exploraste, descubriste y compartiste.
          Completaste todas tus primeras misiones en AstroGram.
        </p>
      </div>
      <div className="mission-finale-medal" aria-label="Seis de seis misiones completadas">
        <div className="mission-finale-medal-count">
          <strong>{TASKS.length}</strong>
          <span>DE {TASKS.length}</span>
        </div>
        <div className="mission-finale-medal-detail">
          <strong>¡Todas las misiones completadas!</strong>
          <span>Tu aventura astronómica acaba de comenzar.</span>
          <div className="mission-finale-progress" aria-hidden="true">
            {TASKS.map(task=><span key={task.key}/>)}
          </div>
        </div>
      </div>
      <div className="mission-finale-missions">
        <h3>Tus seis logros</h3>
        <ul>{TASKS.map((task,i)=><li key={task.key}
          style={{animationDelay:String(.35+i*.085)+'s'}}>
          <span className="mission-finale-mission-icon" aria-hidden="true">
            <AstroGlyph name={task.icon} size={17}/>
          </span>
          <span>{task.title}</span>
          <Check size={16} className="mission-finale-mission-check" aria-hidden="true"/>
        </li>)}</ul>
      </div>
      <button type="button" data-finale-primary data-sound="navigate"
        className="mission-finale-primary" onClick={onClose}>
        <span>¡Seguir explorando!</span><ArrowRight size={20}/>
      </button>
      <p className="mission-finale-replay-note">
        Puedes revivir esta celebración desde Ajustes cuando quieras.
      </p>
    </div>
  </div>,document.body);
}
