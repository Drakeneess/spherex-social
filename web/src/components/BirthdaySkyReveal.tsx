import { ArrowUpRight, LockKeyhole, Sparkles, Telescope } from 'lucide-react';
import { birthdaySkyRoute, constellationForBirthday } from '../lib/zodiac';
import { formatDec, formatRa } from '../lib/coordinates';

/** Shown only to the authenticated account holder, after the DOB is saved. */
export default function BirthdaySkyReveal({birthDate}:{birthDate:string}){
  const sign=constellationForBirthday(birthDate);
  if(!sign)return null;
  return <div className="birthday-sky-reveal" role="region"
    aria-label="Sorpresa astronómica por tu fecha de nacimiento">
    <div className="birthday-sky-art" aria-hidden="true">
      <span className="birthday-sky-orbit orbit-a"/>
      <span className="birthday-sky-orbit orbit-b"/>
      <span className="birthday-sky-symbol">{sign.symbol}</span>
      <span className="birthday-sky-spark">✧</span>
    </div>
    <div className="birthday-sky-content">
      <div className="birthday-sky-kicker"><Sparkles size={15}/> Encontraste una pequeña sorpresa</div>
      <h4>Una constelación para ti: <strong>{sign.name}</strong></h4>
      <p>Tu cumpleaños coincide con las fechas tradicionales de {sign.name}.
        En el cielo real puedes investigar una región cercana a <b>{sign.anchor.name}</b>.</p>
      <div className="birthday-sky-coordinate">
        RA {formatRa(sign.anchor.ra)} · Dec {formatDec(sign.anchor.dec)}
      </div>
      <button type="button" className="birthday-sky-open"
        onClick={()=>{window.location.hash='#/'+birthdaySkyRoute(sign);}}>
        <Telescope size={17}/>
        {sign.detailedAtlas?'Descubrir el mapa de Tauro':'Explorar esta región del cielo'}
        <ArrowUpRight size={17}/>
      </button>
      <p className="birthday-sky-private"><LockKeyhole size={13}/>
        Este detalle solo aparece en tus ajustes. La fecha completa sigue siendo privada.</p>
    </div>
    <p className="birthday-sky-disclaimer">Referencia cultural del zodiaco tropical,
      no un cálculo astronómico del Sol en tu nacimiento. Solo Tauro tiene una carta
      interactiva detallada; para otros signos se abre una estrella de referencia.</p>
  </div>;
}
