import { useMemo, useState } from 'react';
import { Flag, Lightbulb, Target, Trophy } from 'lucide-react';
import { recordGameCompleted } from '../lib/gameStreak';

const names=['WISE 0855','Estrella de Barnard','Luhman 16','Cometa en tránsito','Candidato móvil'];
function random(seed:number){let s=seed;return ()=>{s=(Math.imul(s,1664525)+1013904223)|0;return(s>>>0)/4294967296;};}
function SkyRound({index,after=false,answer,onGuess,hint}:{
  index:number;after?:boolean;answer:{x:number;y:number};onGuess?:(x:number,y:number)=>void;hint:boolean;
}) {
  const stars=useMemo(()=>{const next=random(712+index*145);return Array.from({length:95},(_,i)=>({
    id:i,x:next()*400,y:next()*400,r:next()*1.6+.4,op:next()*.65+.2,
  }));},[index]);
  const x=after?answer.x:answer.x-72,y=after?answer.y:answer.y+34;
  return <div className="gbox" onClick={event=>{if(!onGuess)return;const r=event.currentTarget.getBoundingClientRect();
    onGuess((event.clientX-r.left)/r.width*400,(event.clientY-r.top)/r.height*400);}}>
    <svg viewBox="0 0 400 400" role="img" aria-label={after?'Cielo después, toca el objeto móvil':'Cielo antes'}>
      <rect width="400" height="400" fill="#040610"/>
      {stars.map(s=><circle key={s.id} cx={s.x} cy={s.y} r={s.r} fill={s.id%5===0?'#a1bbff':'#fff'} opacity={s.op}/>)}
      <circle cx={x} cy={y} r="3.4" fill="#fff" stroke="#a7c8ff" strokeWidth="1"/>
      {hint&&after&&<circle cx={x} cy={y} r="62" fill="none" stroke="#ffd166" strokeWidth="2" strokeDasharray="6 7"/>}
    </svg><span className="lab">{after?'Después · toca aquí':'Antes'}</span>
  </div>;
}
export default function GamePage({onExplore}:{onExplore:()=>void}){
  const [round,setRound]=useState(-1),[score,setScore]=useState(0),[found,setFound]=useState(0);
  const [done,setDone]=useState(false),[hint,setHint]=useState(false),[feedback,setFeedback]=useState('');
  const answer={x:256+(round%3)*10,y:166+(round%4)*12};
  function next(){
    if(round===4){recordGameCompleted();setRound(5);return;}
    setRound(r=>r+1);setDone(false);setHint(false);setFeedback('');
  }
  function guess(x:number,y:number){
    if(done)return;
    const correct=Math.hypot(answer.x-x,answer.y-y)<26;
    const points=correct?(hint?50:100):0;
    if(correct){setScore(s=>s+points);setFound(n=>n+1);}
    setDone(true);setFeedback(correct?`¡Encontraste el objeto! +${points} puntos.`:'Esta vez no lo encontraste.');
  }
  return <main className="wrap narrow"><div className="card">
    <div className="card-h"><span><Target size={17}/> Encuentra la diferencia</span><span className="chip">SIMULACIÓN EDUCATIVA</span></div>
    {round<0?<div className="gend"><Target size={56}/><h2>Reto de hoy: 5 cielos</h2>
      <p>Compara dos campos estelares sintéticos y señala el objeto que cambió de posición.</p>
      <p className="hint">Este juego es una demostración: no usa imágenes SPHEREx ni valida descubrimientos.</p>
      <button className="btn p" onClick={next}>Empezar</button></div>:
    round>=5?<div className="gend"><Trophy size={54}/><h2>¡Reto completado!</h2>
      <div className="big grad">{score} puntos</div><p>Encontraste {found} de 5 objetos.</p>
      <div className="mrow"><button className="btn" onClick={()=>{setRound(-1);setScore(0);setFound(0);}}>Volver a jugar</button>
        <button className="btn p" onClick={onExplore}>Abrir explorador real</button></div></div>:
    <><div className="gbar"><span>Cielo {round+1} de 5 · {names[round]}</span><b>{score} puntos</b></div>
      <div className="gpair"><SkyRound index={round} answer={answer} hint={false}/>
        <SkyRound index={round} after answer={answer} hint={hint} onGuess={guess}/></div>
      <div className={`gres ${done?'good':''}`}>{done?feedback:'¿Qué punto de luz se movió? Toca la imagen derecha.'}</div>
      <div className="xctrl">{done?<button className="btn p sm" onClick={next}>{round===4?'Ver resultado':'Siguiente cielo'}</button>:<>
        <button className="btn sm" disabled={hint} onClick={()=>setHint(true)}><Lightbulb size={15}/> Pista (−50 puntos)</button>
        <button className="btn sm" onClick={()=>{setDone(true);setFeedback('El punto se desplazó hacia arriba y a la derecha.')}}><Flag size={15}/> Me rindo</button>
      </>}</div>
    </>}
  </div></main>;
}
