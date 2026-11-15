import { useMemo, type MouseEvent } from 'react';
import { ArrowUpRight, Crosshair, MapPin, Search, Sparkles, X } from 'lucide-react';
import { formatDec, formatRa } from '../lib/coordinates';
import {
  ATLAS_CHART, isInZodiacChart, projectZodiac,
  unprojectZodiac, zodiacAtlasBounds,
  type SkyPoint, type ZodiacAtlas,
} from '../lib/zodiacAtlas';

/** Interactive catalogue star chart, never a synthetic SPHEREx observation. */
export default function ZodiacChart({
  atlas,selected,selectedName,onSelect,onSearch,onClose,loading,
}:{
  atlas:ZodiacAtlas;
  selected:SkyPoint;selectedName:string;
  onSelect:(position:SkyPoint,name:string)=>void;
  onSearch:()=>void;onClose:()=>void;loading:boolean;
}){
  const points=useMemo(()=>new Map(
    atlas.targets.map(target=>[target.id,projectZodiac(atlas,target)])),[atlas]);
  const bounds=useMemo(()=>zodiacAtlasBounds(atlas),[atlas]);
  const selection=isInZodiacChart(atlas,selected)?projectZodiac(atlas,selected):null;
  const c=ATLAS_CHART;
  const gridRA=Array.from({length:5},(_,i)=>bounds.minRA+(bounds.maxRA-bounds.minRA)*i/4);
  const gridDec=Array.from({length:5},(_,i)=>bounds.minDec+(bounds.maxDec-bounds.minDec)*i/4);

  function mapClick(event:MouseEvent<SVGSVGElement>){
    const svg=event.currentTarget;
    const rect=svg.getBoundingClientRect();
    const ratio=Math.min(rect.width/c.width,rect.height/c.height);
    if(!ratio)return;
    const x=(event.clientX-rect.left-(rect.width-c.width*ratio)/2)/ratio;
    const y=(event.clientY-rect.top-(rect.height-c.height*ratio)/2)/ratio;
    if(x<c.left||x>c.right||y<c.top||y>c.bottom)return;
    const nearest=atlas.targets.map(target=>({
      target,point:points.get(target.id)!,
    })).map(item=>({...item,
      distance:Math.hypot(item.point.x-x,item.point.y-y),
    })).filter(item=>item.distance<15)
      .sort((a,b)=>a.distance-b.distance)[0]?.target;
    if(nearest){
      onSelect({ra:nearest.ra,dec:nearest.dec},nearest.name);
    }else{
      const position=unprojectZodiac(atlas,x,y);
      onSelect({ra:Number(position.ra.toFixed(6)),
        dec:Number(position.dec.toFixed(6))},'Región elegida');
    }
  }
  const selectedTarget=atlas.targets.find(t=>
    Math.abs(t.ra-selected.ra)<.0001&&Math.abs(t.dec-selected.dec)<.0001);
  const raAt=(offset:number)=>projectZodiac(atlas,{
    ra:((atlas.centerRA+offset)%360+360)%360,dec:bounds.minDec,
  }).x;
  const decAt=(dec:number)=>projectZodiac(atlas,{
    ra:atlas.centerRA,dec,
  }).y;

  return <section className="card taurus-atlas zodiac-atlas"
    aria-labelledby="zodiac-chart-title">
    <div className="taurus-atlas-header">
      <div>
        <div className="taurus-atlas-eyebrow">
          <Sparkles size={15}/> Tu carta del cielo
        </div>
        <h2 id="zodiac-chart-title">
          <span className="zodiac-chart-symbol" aria-hidden="true">{atlas.sign.symbol}</span>
          {atlas.sign.name}
        </h2>
        <p>Un cielo lleno de lugares por descubrir.</p>
      </div>
      <button type="button" onClick={onClose} className="taurus-atlas-dismiss"
        aria-label="Cerrar carta estelar"><X size={18}/></button>
    </div>
    <div className="taurus-atlas-body">
      <div className="taurus-atlas-map" tabIndex={0} role="region"
        aria-label="Mapa de la constelación, desplazable horizontalmente en pantallas pequeñas">
        <p className="taurus-map-swipe-hint">Desliza el mapa horizontalmente para ver las estrellas y seleccionar una región.</p>
        <svg className="taurus-chart-svg" viewBox="0 0 900 510" role="img"
          aria-label={`Carta interactiva de ${atlas.sign.name}, con estrellas reales de referencia. Pulsa sobre el mapa para seleccionar coordenadas.`}
          onClick={mapClick}>
          <defs>
            <radialGradient id="zodiac-chart-bg" cx="55%" cy="43%" r="85%">
              <stop offset="0" stopColor="#1c2e60"/>
              <stop offset=".55" stopColor="#111a39"/>
              <stop offset="1" stopColor="#090e21"/>
            </radialGradient>
            <radialGradient id="zodiac-star-light">
              <stop offset="0" stopColor="#ffffff"/>
              <stop offset=".6" stopColor="#bcd9ff"/>
              <stop offset="1" stopColor="#b6ccff" stopOpacity=".08"/>
            </radialGradient>
          </defs>
          <rect width="900" height="510" fill="url(#zodiac-chart-bg)"/>
          <rect x={c.left} y={c.top}
            width={c.right-c.left} height={c.bottom-c.top}
            fill="none" stroke="#5974ab" strokeOpacity=".42" strokeWidth="1.3"/>
          {gridRA.map((offset,i)=>{
            const x=raAt(offset);
            const ra=((atlas.centerRA+offset)%360+360)%360;
            return <g key={i}>
              <path d={`M ${x} ${c.top} V ${c.bottom}`}
                stroke="#657fb4" strokeDasharray="4 9" strokeOpacity=".22"/>
              <text x={x} y="474" textAnchor="middle" className="taurus-axis">
                {(ra/15).toFixed(1)}h
              </text>
            </g>;
          })}
          {gridDec.map((dec,i)=>{
            const y=decAt(dec);
            return <g key={i}>
              <path d={`M ${c.left} ${y} H ${c.right}`}
                stroke="#657fb4" strokeDasharray="4 9" strokeOpacity=".22"/>
              <text x="49" y={y+4} textAnchor="end" className="taurus-axis">
                {dec>=0?'+':''}{dec.toFixed(0)}°
              </text>
            </g>;
          })}
          {atlas.lines.map(([from,to])=>{
            const a=points.get(from),b=points.get(to);
            return a&&b?<line key={from+'-'+to}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#a2beff" strokeWidth="2.2" strokeOpacity=".62"/>:null;
          })}
          {atlas.targets.map((target,i)=>{
            const point=points.get(target.id)!;
            const major=i<5||target.kind!=='star';
            const radius=target.kind==='star'
              ?Math.max(3.4,9.5-(target.magnitude??4)*1.25):7.5;
            return <g key={target.id}>
              {target.kind!=='star'&&<circle cx={point.x} cy={point.y} r={14}
                stroke={target.kind==='cluster'?'#f7b9ef':'#8ef7d2'}
                strokeDasharray="4 4" strokeWidth="1.5" fill="none" opacity=".75"/>}
              <circle cx={point.x} cy={point.y} r={radius*2.5}
                fill="url(#zodiac-star-light)" opacity=".6"/>
              <circle cx={point.x} cy={point.y} r={radius}
                fill={target.kind==='nebula'?'#8bf6d3':
                  target.kind==='cluster'?'#ffc0ea':
                  i===0?'#ffd2a5':'#d7e8ff'}/>
              {major&&<text x={point.x+12} y={point.y-12}
                className="taurus-star-label">{target.name}</text>}
            </g>;
          })}
          {selection&&<g aria-hidden="true">
            <circle cx={selection.x} cy={selection.y} r="18"
              fill="none" stroke="#ff81cb" strokeWidth="2.5"
              strokeDasharray="6 3"/>
            <path d={`M ${selection.x-25} ${selection.y} h12
              M ${selection.x+13} ${selection.y} h12
              M ${selection.x} ${selection.y-25} v12
              M ${selection.x} ${selection.y+13} v12`}
              stroke="#ffd0e9" strokeWidth="2"/>
          </g>}
          <text x="450" y="504" textAnchor="middle"
            className="taurus-axis">Ascensión recta · este ←</text>
          <text x="78" y="37" className="taurus-axis">N ↑</text>
        </svg>
        <p className="taurus-map-caption">
          <MapPin size={14}/> Pulsa cualquier punto del mapa o elige una estrella.
        </p>
      </div>
      <div className="taurus-atlas-detail">
        <div className="taurus-target-list">
          <h3>Estrellas para explorar</h3>
          <p>Cada punto te lleva a una región distinta del cielo.</p>
          <div className="taurus-target-options">
            {atlas.targets.map(target=>{
              const active=selectedTarget?.id===target.id;
              return <button type="button" key={target.id}
                className={active?'active':''} aria-pressed={active}
                onClick={()=>onSelect({ra:target.ra,dec:target.dec},target.name)}>
                <span className="taurus-target-symbol" aria-hidden="true">
                  {target.kind==='cluster'?'✦':target.kind==='nebula'?'✧':'★'}
                </span>
                <span>{target.name}<small>
                  {target.kind==='star'?'Estrella':
                    target.kind==='cluster'?'Cúmulo estelar':'Nebulosa'}
                </small></span><ArrowUpRight size={15}/>
              </button>;
            })}
          </div>
        </div>
        <div className="taurus-selected">
          <span className="taurus-selected-label">
            <Crosshair size={16}/> Región seleccionada
          </span>
          <strong>{selectedName}</strong>
          <small>RA {formatRa(selected.ra)} · Dec {formatDec(selected.dec)}</small>
          <button type="button" className="btn p full taurus-search-button"
            disabled={loading} onClick={onSearch}>
            <Search size={17}/>{loading?'Buscando…':'Buscar con SPHEREx'}
          </button>
        </div>
      </div>
    </div>
    <div className="zodiac-atlas-note">
      Carta estelar de referencia (J2000). Las imágenes científicas aparecen
      cuando inicias una búsqueda en SPHEREx.
    </div>
  </section>;
}
