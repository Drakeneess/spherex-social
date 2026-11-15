/** A playful zodiac birthday discovery, NOT a physical Sun ephemeris.
 * Conventional tropical sign dates (not IAU constellation transit windows).
 * Star anchors are reference J2000 RA/Dec positions, not a constellation-wide
 * image or a claim of SPHEREx coverage. Sources:
 * https://zodiaccalendar.com/research/zodiac-reference-tables.html
 * https://simbad.cds.unistra.fr/simbad/
 */
export type ZodiacConstellation={
  id:string;name:string;symbol:string;
  start:number;anchor:{name:string;ra:number;dec:number};
  detailedAtlas:boolean;
};
export const ZODIAC_CONSTELLATIONS:readonly ZodiacConstellation[]=[
  {id:'aquarius',name:'Acuario',symbol:'♒',start:120,
    anchor:{name:'Sadalsuud',ra:322.8897,dec:-5.5712},detailedAtlas:false},
  {id:'pisces',name:'Piscis',symbol:'♓',start:219,
    anchor:{name:'Alrescha',ra:30.5117,dec:2.7638},detailedAtlas:false},
  {id:'aries',name:'Aries',symbol:'♈',start:321,
    anchor:{name:'Hamal',ra:31.7933,dec:23.4624},detailedAtlas:false},
  {id:'taurus',name:'Tauro',symbol:'♉',start:420,
    anchor:{name:'Aldebarán',ra:68.9800,dec:16.5098},detailedAtlas:true},
  {id:'gemini',name:'Géminis',symbol:'♊',start:521,
    anchor:{name:'Pólux',ra:116.32896,dec:28.02620},detailedAtlas:false},
  {id:'cancer',name:'Cáncer',symbol:'♋',start:621,
    anchor:{name:'Acubens',ra:134.621,dec:11.8577},detailedAtlas:false},
  {id:'leo',name:'Leo',symbol:'♌',start:723,
    anchor:{name:'Régulo',ra:152.09296,dec:11.9672},detailedAtlas:false},
  {id:'virgo',name:'Virgo',symbol:'♍',start:823,
    anchor:{name:'Espiga',ra:201.29825,dec:-11.16132},detailedAtlas:false},
  {id:'libra',name:'Libra',symbol:'♎',start:923,
    anchor:{name:'Zubenelgenubi',ra:222.7195,dec:-16.0418},detailedAtlas:false},
  {id:'scorpius',name:'Escorpio',symbol:'♏',start:1023,
    anchor:{name:'Antares',ra:247.3519,dec:-26.4320},detailedAtlas:false},
  {id:'sagittarius',name:'Sagitario',symbol:'♐',start:1122,
    anchor:{name:'Kaus Australis',ra:276.0430,dec:-34.3846},detailedAtlas:false},
  {id:'capricornus',name:'Capricornio',symbol:'♑',start:1222,
    anchor:{name:'Deneb Algedi',ra:326.7600,dec:-16.1273},detailedAtlas:false},
];

/** Returns null for absent, malformed or impossible calendar dates.
 * Uses the calendar date only; never shifts it using the browser timezone.
 */
export function constellationForBirthday(iso:string|null|undefined):ZodiacConstellation|null{
  if(!iso||!/^\d{4}-\d{2}-\d{2}$/.test(iso))return null;
  const [year,month,day]=iso.split('-').map(Number);
  if(year<1900||year>9999)return null;
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()+1!==month||
    date.getUTCDate()!==day)return null;
  const number=month*100+day;
  return [...ZODIAC_CONSTELLATIONS].reverse().find(s=>number>=s.start)
    ?? ZODIAC_CONSTELLATIONS[ZODIAC_CONSTELLATIONS.length-1];
}

/** The URL contains only public sky coordinates, never the birth date.
 * The Tauro atlas is additionally gated to the owner's saved sign.
 * All other constellations prefill one documented representative star.
 */
export function birthdaySkyRoute(sign:ZodiacConstellation):string{
  if(sign.detailedAtlas)return 'explore?constellation=taurus';
  return `explore?ra=${sign.anchor.ra}&dec=${sign.anchor.dec}&prefill=1`;
}
