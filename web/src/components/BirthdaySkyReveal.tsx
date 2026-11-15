import { ArrowUpRight, Sparkles, Telescope } from 'lucide-react';
import { birthdaySkyRoute, constellationForBirthday } from '../lib/zodiac';

/** A personal discovery; always calculate locally from the private DOB. */
const whispers:Record<string,string>={
  "aquarius": "Entre ríos invisibles de estrellas, Sadalsuud guarda un destello para ti.",
  "pisces": "Dos senderos de luz cruzan el firmamento. Alrescha conoce el camino.",
  "aries": "Hamal espera al comienzo de un pequeño viaje entre las estrellas.",
  "taurus": "Aldebarán brilla como una brasa en el corazón de Tauro.",
  "gemini": "En algún lugar del cielo, Cástor y Pólux brillan uno junto al otro.",
  "cancer": "Cáncer esconde un puñado de luces que no todos se detienen a mirar.",
  "leo": "Régulo brilla en el pecho del león celeste. El resto te espera más allá.",
  "virgo": "Espiga guarda una luz azulada en un rincón inmenso del firmamento.",
  "libra": "Dos estrellas parecen sostener una balanza hecha de noche.",
  "scorpius": "Antares late con un resplandor rojizo en el cielo de Escorpio.",
  "sagittarius": "Un grupo de estrellas dibuja el comienzo de un viaje sin mapa.",
  "capricornus": "Deneb Algedi ilumina uno de los caminos más discretos del cielo."
};

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
      <p>{whispers[sign.id]}</p>
      <button type="button" className="birthday-sky-open"
        onClick={()=>{window.location.hash='#/'+birthdaySkyRoute(sign);}}>
        <Telescope size={17}/> Explorar mi constelación <ArrowUpRight size={17}/>
      </button>
    </div>
  </div>;
}
