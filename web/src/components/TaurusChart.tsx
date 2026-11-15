import { useMemo, type MouseEvent } from 'react';
import { ArrowUpRight, Crosshair, MapPin, Search, Telescope, X } from 'lucide-react';
import { formatDec, formatRa } from '../lib/coordinates';
import {
  TAURUS_CHART, TAURUS_FIGURE_LINES, TAURUS_TARGETS, TAURUS_VIEW,
  projectTaurus, unprojectTaurus, withinTaurusChart,
  type SkyPosition,
} from '../lib/taurus';

/** Reference J2000 star chart, NOT a composite/mosaic of SPHEREx observations. */
export default function TaurusChart({
  selected,selectedName,onSelect,onSearch,onClose,loading,
}:{
  selected:SkyPosition;selectedName:string;
  onSelect:(position:SkyPosition,name:string)=>void;
  onSearch:()=>void;onClose:()=>void;loading:boolean;
}){
  const points=useMemo(()=>new Map(
    TAURUS_TARGETS.map(point=>[point.id,projectTaurus(point)])),[]);
  const selection=withinTaurusChart(selected)?projectTaurus(selected):null;
  const gridRA=[50,60,70,80,90];
  const gridDec=[0,10,20,30];

  function mapClick(event:MouseEvent<SVGSVGElement>){
    const svg=event.currentTarget;
    const rect=svg.getBoundingClientRect();
    const ratio=Math.min(rect.width/TAURUS_CHART.width,rect.height/TAURUS_CHART.height);
    if(!ratio)return;
    const x=(event.clientX-rect.left-(rect.width-TAURUS_CHART.width*ratio)/2)/ratio;
    const y=(event.clientY-rect.top-(rect.height-TAURUS_CHART.height*ratio)/2)/ratio;
    if(x<TAURUS_CHART.left||x>TAURUS_CHART.right||
       y<TAURUS_CHART.top||y>TAURUS_CHART.bottom)return;
    const nearest=TAURUS_TARGETS.find(point=>{
      const p=points.get(point.id);
      return p&&Math.hypot(p.x-x,p.y-y)<12;
    });
    if(nearest){
      onSelect({ra:nearest.ra,dec:nearest.dec},nearest.name);
    }else{
      const coords=unprojectTaurus(x,y);
      onSelect({ra:Number(coords.ra.toFixed(6)),dec:Number(coords.dec.toFixed(6))},
        'Región personalizada');
    }
  }

  return <section className="card taurus-atlas" aria-labelledby="taurus-chart-title">
    <div className="taurus-atlas-header">
      <div>
        <div className="taurus-atlas-eyebrow"><Telescope size={15}/> Atlas de constelaciones · Tau</div>
        <h2 id="taurus-chart-title">Tauro <span>Taurus</span></h2>
        <p>Carta estelar de referencia · época J2000 · norte arriba, este a la izquierda</p>
      </div>
      <button type="button" onClick={onClose} className="taurus-atlas-dismiss"
        aria-label="Cerrar mapa de Tauro"><X size={18}/></button>
    </div>
    <div className="taurus-atlas-body">
      <div className="taurus-atlas-map">
        <svg className="taurus-chart-svg" viewBox="0 0 900 510" role="img"
          aria-label="Carta interactiva de Tauro. Pulsa un punto del campo para elegir coordenadas. Se muestran Aldebarán, Elnath, las Pléyades y M1."
          onClick={mapClick}>
          <defs>
            <radialGradient id="taurus-chart-bg" cx="55%" cy="43%" r="84%">
              <stop offset="0" stopColor="#1b2c58"/>
              <stop offset=".6" stopColor="#101a39"/>
              <stop offset="1" stopColor="#090e20"/>
            </radialGradient>
            <radialGradient id="taurus-star-light">
              <stop offset="0" stopColor="#ffffff"/>
              <stop offset=".6" stopColor="#c3ddff"/>
              <stop offset="1" stopColor="#b3c8ff" stopOpacity=".17"/>
            </radialGradient>
          </defs>
          <rect width="900" height="510" fill="url(#taurus-chart-bg)"/>
          <rect x={TAURUS_CHART.left} y={TAURUS_CHART.top}
            width={TAURUS_CHART.right-TAURUS_CHART.left}
            height={TAURUS_CHART.bottom-TAURUS_CHART.top}
            fill="none" stroke="#53678f" strokeOpacity=".5" strokeWidth="1.5"/>
          {gridRA.map(ra=>{
            const {x}=projectTaurus({ra,dec:TAURUS_VIEW.decMin});
            return <g key={`ra-${ra}`}>
              <path d={`M ${x} ${TAURUS_CHART.top} V ${TAURUS_CHART.bottom}`}
                stroke="#6075a8" strokeDasharray="4 9" strokeOpacity=".25"/>
              <text x={x} y="475" textAnchor="middle" className="taurus-axis">
                {(ra/15).toFixed(2)}h
              </text>
            </g>;
          })}
          {gridDec.map(dec=>{
            const {y}=projectTaurus({ra:TAURUS_VIEW.raMin,dec});
            return <g key={`dec-${dec}`}>
              <path d={`M ${TAURUS_CHART.left} ${y} H ${TAURUS_CHART.right}`}
                stroke="#6075a8" strokeDasharray="4 9" strokeOpacity=".25"/>
              <text x="50" y={y+4} textAnchor="end" className="taurus-axis">+{dec}°</text>
            </g>;
          })}
          {TAURUS_FIGURE_LINES.map(([from,to])=>{
            const a=points.get(from),b=points.get(to);
            return a&&b?<line key={from+'-'+to}
              x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#8ab5ff" strokeWidth="1.9" strokeOpacity=".55"/>:null;
          })}
          {TAURUS_TARGETS.map(target=>{
            const point=points.get(target.id)!;
            const major=['aldebaran','elnath','tianguan','m45','m1'].includes(target.id);
            const radius=target.kind==='star'
              ?Math.max(3.7,9.5-(target.magnitude??4)*1.35):8;
            return <g key={target.id}>
              {target.kind!=='star'&&<circle cx={point.x} cy={point.y} r={13}
                stroke={target.kind==='cluster'?'#f7b9ef':'#8ef7d2'}
                strokeDasharray="3 4" strokeWidth="1.5" fill="none" opacity=".8"/>}
              <circle cx={point.x} cy={point.y} r={radius*2.2}
                fill="url(#taurus-star-light)" opacity={target.kind==='star'?.68:.35}/>
              <circle cx={point.x} cy={point.y} r={radius}
                fill={target.id==='aldebaran'?'#ffbc7f':
                  target.kind==='nebula'?'#8bf6d3':
                    target.kind==='cluster'?'#ffc0ea':'#d7e8ff'}/>
              {major&&<text x={point.x+11} y={point.y-12} className="taurus-star-label">
                {target.id==='m45'?'Pléyades · M45':
                  target.id==='m1'?'Nebulosa M1':target.name}
              </text>}
            </g>;
          })}
          {selection&&<g aria-hidden="true">
            <circle cx={selection.x} cy={selection.y} r="17"
              fill="none" stroke="#ff7abf" strokeWidth="2.5"
              strokeDasharray="6 3"/>
            <path d={`M ${selection.x-25} ${selection.y} h12 M ${selection.x+13} ${selection.y} h12
              M ${selection.x} ${selection.y-25} v12 M ${selection.x} ${selection.y+13} v12`}
              stroke="#f6b1df" strokeWidth="2"/>
          </g>}
          <text x="450" y="502" textAnchor="middle" className="taurus-axis">
            Ascensión recta (RA) · este ←
          </text>
          <text x="77" y="37" className="taurus-axis">N ↑</text>
        </svg>
        <p className="taurus-map-caption">
          <MapPin size={14}/> Pulsa cualquier región del mapa o elige un objeto de la lista.
          Los trazos son orientativos; no representan límites oficiales de la UAI.
        </p>
      </div>
      <div className="taurus-atlas-detail">
        <div className="taurus-target-list">
          <h3>Regiones destacadas</h3>
          <p>Elige una estrella u objeto para usar sus coordenadas.</p>
          <div className="taurus-target-options">
            {TAURUS_TARGETS.filter(t=>['aldebaran','elnath','tianguan','ain',
              'm45','m1','gamma'].includes(t.id)).map(target=>{
              const isSelected=Math.abs(selected.ra-target.ra)<.0001&&
                Math.abs(selected.dec-target.dec)<.0001;
              return <button type="button" key={target.id}
                className={isSelected?'active':''} aria-pressed={isSelected}
                onClick={()=>onSelect({ra:target.ra,dec:target.dec},target.name)}>
                <span className="taurus-target-symbol" aria-hidden="true">
                  {target.kind==='cluster'?'✦':target.kind==='nebula'?'✧':'★'}
                </span>
                <span>{target.name}<small>
                  {target.kind==='star'?'Estrella':
                    target.kind==='cluster'?'Cúmulo abierto':'Remanente de supernova'}
                </small></span>
                <ArrowUpRight size={15}/>
              </button>;
            })}
          </div>
        </div>
        <div className="taurus-selected">
          <span className="taurus-selected-label"><Crosshair size={16}/> Punto seleccionado</span>
          <strong>{selectedName}</strong>
          <small>RA {formatRa(selected.ra)} · Dec {formatDec(selected.dec)}</small>
          <button type="button" className="btn p full taurus-search-button"
            disabled={loading} onClick={onSearch}><Search size={17}/>
            {loading?'Búsqueda en curso…':'Buscar aquí con SPHEREx'}</button>
          <p>El mapa no descarga imágenes. Esta acción inicia una búsqueda real en IRSA
            usando las coordenadas, el tamaño y detector de tu formulario.</p>
        </div>
      </div>
    </div>
    <div className="taurus-atlas-footer">
      Carta J2000 esquemática, no fotografía SPHEREx. La disponibilidad de épocas
      depende del archivo NASA/IPAC/IRSA; no se presupone cobertura.
      <a href="https://www.iau.org/IAU/Astronomy-FAQs/Constellations.aspx"
        target="_blank" rel="noopener noreferrer">Referencia UAI <ArrowUpRight size={13}/></a>
    </div>
  </section>;
}
