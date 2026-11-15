/** Curated bright stars (J2000, FK5-like reference positions) for all 12
 * traditional zodiac constellation easter eggs.
 *
 * Coordinates are transcribed as sexagesimal RA/Dec from the named-star
 * tables at https://en.wikipedia.org/wiki/List_of_stars_in_<IAU name>.
 * Taurus includes the pre-existing NASA M1 and Pleiades reference objects.
 * Asterism lines are illustrative star connections, NOT IAU boundaries.
 * No points are claimed to represent actual SPHEREx detections.
 */
import { ZODIAC_CONSTELLATIONS, type ZodiacConstellation } from './zodiac';
import { TAURUS_FIGURE_LINES, TAURUS_TARGETS } from './taurus';

export type SkyPoint={ra:number;dec:number};
export type AtlasTarget=SkyPoint &{
  id:string; name:string; kind:'star'|'cluster'|'nebula'; magnitude?:number;
};
export type ZodiacAtlas={
  sign:ZodiacConstellation;
  targets:readonly AtlasTarget[];
  lines:readonly (readonly [string,string])[];
  centerRA:number;
};
export const ATLAS_CHART={width:900,height:510,left:65,right:835,top:48,bottom:447};

function sexagesimal(value:string,ra:boolean):number{
  const match=value.match(/^([+-]?)(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);
  if(!match)throw new Error('Invalid star coordinates: '+value);
  const hours=Number(match[2]),minutes=Number(match[3]),seconds=Number(match[4]);
  if(minutes>=60||seconds>=60||hours>(ra?23:90))throw new Error('Out-of-range coordinates: '+value);
  const scalar=hours+minutes/60+seconds/3600;
  return (match[1]==='-'?-1:1)*scalar*(ra?15:1);
}
function star(id:string,name:string,ra:string,dec:string,magnitude:number):AtlasTarget{
  return {id,name,kind:'star',ra:sexagesimal(ra,true),
    dec:sexagesimal(dec,false),magnitude};
}
type RawAtlas={targets:AtlasTarget[];lines:[string,string][];centerRA?:number};
const RAW:Record<string,RawAtlas>={
  aquarius:{
    targets:[
      star('sadalsuud','Sadalsuud','21:31:33.52','-05:34:16.2',2.90),
      star('sadalmelik','Sadalmelik','22:05:47.03','-00:19:11.4',2.95),
      star('skat','Skat','22:54:39.04','-15:49:14.7',3.27),
      star('sadaltager','Sadaltager','22:28:49.80','-00:01:12.2',3.65),
      star('safina','Safina','23:09:26.76','-21:10:20.9',3.68),
      star('hydor','Hydor','22:52:36.86','-07:34:46.8',3.73),
      star('albali','Albali','20:47:40.53','-09:29:44.5',3.78),
      star('sadachbia','Sadachbia','22:21:39.30','-01:23:14.5',3.86),
    ],
    lines:[['albali','sadalsuud'],['sadalsuud','sadalmelik'],
      ['sadalmelik','sadachbia'],['sadachbia','sadaltager'],
      ['sadaltager','hydor'],['hydor','skat'],['skat','safina']],
  },
  pisces:{
    centerRA:0,
    targets:[
      star('alrescha','Alrescha','02:02:02.80','+02:45:49.5',4.33),
      star('alpherg','Alpherg','01:31:28.99','+15:20:45.0',3.62),
      star('yunyu','Yunyu','23:17:09.49','+03:16:56.1',3.70),
      star('pili','Pili','23:59:18.60','+06:51:48.9',4.03),
      star('iota','Iota Piscium','23:39:56.82','+05:37:38.5',4.13),
      star('torcular','Torcular','01:45:23.59','+09:09:27.5',4.26),
      star('epsilon','Épsilon Piscium','01:02:56.66','+07:53:24.3',4.27),
      star('theta','Theta Piscium','23:27:58.17','+06:22:44.8',4.27),
      star('waiping','Waiping','00:48:40.90','+07:35:06.7',4.44),
    ],
    lines:[['yunyu','theta'],['theta','iota'],['iota','pili'],
      ['pili','waiping'],['waiping','epsilon'],['epsilon','torcular'],
      ['torcular','alpherg'],['alpherg','alrescha']],
  },
  aries:{
    targets:[
      star('hamal','Hamal','02:07:10.29','+23:27:46.0',2.01),
      star('sheratan','Sheratan','01:54:38.35','+20:48:29.9',2.64),
      star('bharani','Bharani','02:49:58.99','+27:15:38.8',3.61),
      star('botein','Botein','03:11:37.67','+19:43:36.1',4.35),
      star('hd20644','HD 20644','03:20:20.37','+29:02:54.6',4.47),
    ],
    lines:[['sheratan','hamal'],['hamal','bharani'],['bharani','botein'],
      ['bharani','hd20644']],
  },
  taurus:{
    targets:TAURUS_TARGETS.map(t=>({...t})),
    lines:TAURUS_FIGURE_LINES.map(([a,b]):[string,string]=>[a,b]),
    centerRA:67.65,
  },
  gemini:{
    targets:[
      star('pollux','Pólux','07:45:19.36','+28:01:34.7',1.16),
      star('castor','Cástor','07:34:36.00','+31:53:19.1',1.90),
      star('alhena','Alhena','06:37:42.70','+16:23:57.9',1.93),
      star('tejat','Tejat','06:22:57.59','+22:30:49.9',2.87),
      star('mebsuta','Mebsuta','06:43:55.93','+25:07:52.2',3.06),
      star('propus','Propus','06:14:52.70','+22:30:24.6',3.31),
      star('alzir','Alzir','06:45:17.43','+12:53:45.8',3.35),
      star('wasat','Wasat','07:20:07.39','+21:58:56.4',3.50),
      star('mekbuda','Mekbuda','07:04:06.54','+20:34:13.1',4.01),
    ],
    lines:[['castor','wasat'],['pollux','wasat'],['wasat','mekbuda'],
      ['mekbuda','alhena'],['alhena','alzir'],
      ['castor','mebsuta'],['mebsuta','tejat'],['tejat','propus']],
  },
  cancer:{
    targets:[
      star('tarf','Tarf','08:16:30.95','+09:11:08.4',3.53),
      star('asellus_a','Asellus Australis','08:44:41.11','+18:09:17.5',3.94),
      star('yuyu','Yuyu','08:46:41.83','+28:45:36.0',4.03),
      star('acubens','Acubens','08:58:29.20','+11:51:28.0',4.26),
      star('asellus_b','Asellus Borealis','08:43:17.21','+21:28:06.9',4.66),
      star('tegmine','Tegmine','08:12:12.71','+17:38:53.3',4.67),
    ],
    lines:[['tarf','tegmine'],['tegmine','asellus_b'],
      ['asellus_b','yuyu'],['asellus_b','asellus_a'],
      ['asellus_a','acubens']],
  },
  leo:{
    targets:[
      star('regulus','Régulo','10:08:22.46','+11:58:01.9',1.36),
      star('denebola','Denébola','11:49:03.88','+14:34:20.4',2.14),
      star('algieba','Algieba','10:19:58.16','+19:50:30.7',2.37),
      star('zosma','Zosma','11:14:06.41','+20:31:26.5',2.56),
      star('ras','Ras Elased','09:45:51.10','+23:46:27.4',2.97),
      star('chertan','Chertan','11:14:14.44','+15:25:47.1',3.33),
    ],
    lines:[['ras','algieba'],['algieba','regulus'],
      ['algieba','zosma'],['zosma','denebola'],
      ['zosma','chertan'],['chertan','regulus']],
  },
  virgo:{
    targets:[
      star('spica','Espiga','13:25:11.60','-11:09:40.5',.98),
      star('porrima','Porrima','12:41:40.00','-01:26:58.3',2.74),
      star('vindemiatrix','Vindemiatrix','13:02:10.76','+10:57:32.8',2.85),
      star('heze','Heze','13:34:41.75','-00:35:45.4',3.38),
      star('auva','Auva','12:55:36.48','+03:23:51.4',3.39),
      star('zavijava','Zavijava','11:50:41.29','+01:45:55.4',3.59),
      star('zaniah','Zaniah','12:19:54.39','-00:40:00.3',3.89),
      star('syrma','Syrma','14:16:00.88','-05:59:58.3',4.07),
    ],
    lines:[['zavijava','zaniah'],['zaniah','porrima'],
      ['porrima','auva'],['auva','vindemiatrix'],
      ['auva','heze'],['heze','spica'],['spica','syrma']],
  },
  libra:{
    targets:[
      star('zubeneschamali','Zubeneschamali','15:17:00.47','-09:22:58.3',2.61),
      star('zubenelgenubi','Zubenelgenubi','14:50:52.78','-16:02:29.8',2.75),
      star('brachium','Brachium','15:04:04.26','-25:16:54.7',3.25),
      star('upsilon','Ípsilon Librae','15:37:01.46','-28:08:06.3',3.60),
      star('zubenelhakrabi','Zubenelhakrabi','15:35:31.54','-14:47:22.4',3.91),
      star('theta','Theta Librae','15:53:49.48','-16:43:46.6',4.13),
      star('delta','Delta Librae','15:00:58.39','-08:31:08.2',4.91),
    ],
    lines:[['delta','zubenelgenubi'],['zubenelgenubi','zubeneschamali'],
      ['zubeneschamali','zubenelhakrabi'],
      ['zubenelhakrabi','theta'],['zubenelgenubi','brachium'],
      ['brachium','upsilon']],
  },
  scorpius:{
    targets:[
      star('antares','Antares','16:29:24.47','-26:25:55.0',.91),
      star('shaula','Shaula','17:33:36.53','-37:06:13.5',1.62),
      star('sargas','Sargas','17:37:19.13','-42:59:52.2',1.86),
      star('dschubba','Dschubba','16:00:20.01','-22:37:17.8',2.29),
      star('larawag','Larawag','16:50:10.24','-34:17:33.4',2.29),
      star('girtab','Girtab','17:42:29.28','-39:01:47.7',2.39),
      star('acrab','Acrab','16:05:26.23','-19:48:19.4',2.62),
      star('lesath','Lesath','17:30:45.84','-37:17:44.7',2.70),
      star('paikauhale','Paikauhale','16:35:52.96','-28:12:57.5',2.82),
    ],
    lines:[['acrab','dschubba'],['dschubba','antares'],
      ['antares','paikauhale'],['paikauhale','larawag'],
      ['larawag','lesath'],['lesath','shaula'],
      ['shaula','girtab'],['girtab','sargas']],
  },
  sagittarius:{
    targets:[
      star('kaus_s','Kaus Australis','18:24:10.32','-34:23:00.5',1.85),
      star('nunki','Nunki','18:55:15.93','-26:17:48.2',2.05),
      star('ascella','Ascella','19:02:36.72','-29:52:48.4',2.60),
      star('kaus_m','Kaus Media','18:20:59.62','-29:49:40.9',2.72),
      star('kaus_n','Kaus Borealis','18:27:58.27','-25:25:16.5',2.82),
      star('al_baldah','Al Baldah','19:09:45.83','-21:01:24.7',2.88),
      star('alnasl','Alnasl','18:05:48.52','-30:25:25.1',2.98),
      star('nantou','Nantou','18:45:39.35','-26:59:26.8',3.17),
      star('heryibwia','Heryibwia','18:17:37.73','-36:45:40.6',3.10),
    ],
    lines:[['alnasl','kaus_m'],['kaus_m','kaus_s'],
      ['kaus_s','ascella'],['ascella','nunki'],
      ['nunki','kaus_n'],['kaus_n','kaus_m'],
      ['nunki','nantou'],['nunki','al_baldah'],['kaus_s','heryibwia']],
  },
  capricornus:{
    targets:[
      star('deneb','Deneb Algedi','21:47:02.29','-16:07:35.6',2.85),
      star('dabih','Dabih','20:21:00.65','-14:46:53.0',3.05),
      star('algedi','Algedi','20:18:03.22','-12:32:41.5',3.58),
      star('nashira','Nashira','21:40:05.34','-16:39:44.1',3.69),
      star('marakk','Marakk','21:26:40.03','-22:24:41.0',3.77),
    ],
    lines:[['algedi','dabih'],['dabih','marakk'],
      ['marakk','deneb'],['deneb','nashira'],['nashira','algedi']],
  },
};

export function getZodiacAtlas(id:string):ZodiacAtlas|null{
  const sign=ZODIAC_CONSTELLATIONS.find(item=>item.id===id);
  const data=RAW[id];
  if(!sign||!data)return null;
  return {sign,targets:data.targets,lines:data.lines,
    centerRA:data.centerRA??sign.anchor.ra};
}

/** Signed RA offset in [-180,180) relative to the chart centre.
 * Essential for Pisces, whose stars straddle 00h.
 */
export function signedRaOffset(ra:number,centerRA:number):number{
  return ((ra-centerRA+540)%360+360)%360-180;
}
export function normalizeRA(ra:number):number{
  return ((ra%360)+360)%360;
}

export type AtlasBounds={
  minRA:number;maxRA:number;minDec:number;maxDec:number;
};
export function zodiacAtlasBounds(atlas:ZodiacAtlas):AtlasBounds{
  const offsets=atlas.targets.map(t=>signedRaOffset(t.ra,atlas.centerRA));
  const decs=atlas.targets.map(t=>t.dec);
  const minRA=Math.min(...offsets),maxRA=Math.max(...offsets);
  const minDec=Math.min(...decs),maxDec=Math.max(...decs);
  const raPad=Math.max(3,(maxRA-minRA)*.13);
  const decPad=Math.max(3,(maxDec-minDec)*.18);
  return {minRA:minRA-raPad,maxRA:maxRA+raPad,
    minDec:Math.max(-90,minDec-decPad),maxDec:Math.min(90,maxDec+decPad)};
}
export function projectZodiac(atlas:ZodiacAtlas,position:SkyPoint):{x:number;y:number}{
  const b=zodiacAtlasBounds(atlas),c=ATLAS_CHART;
  const offset=signedRaOffset(position.ra,atlas.centerRA);
  return {
    x:c.left+(b.maxRA-offset)/(b.maxRA-b.minRA)*(c.right-c.left),
    y:c.top+(b.maxDec-position.dec)/(b.maxDec-b.minDec)*(c.bottom-c.top),
  };
}
export function unprojectZodiac(atlas:ZodiacAtlas,x:number,y:number):SkyPoint{
  const b=zodiacAtlasBounds(atlas),c=ATLAS_CHART;
  const bounded=(v:number,min:number,max:number)=>Math.min(max,Math.max(min,v));
  const offset=b.maxRA-(bounded(x,c.left,c.right)-c.left)/(c.right-c.left)*(b.maxRA-b.minRA);
  const dec=b.maxDec-(bounded(y,c.top,c.bottom)-c.top)/(c.bottom-c.top)*(b.maxDec-b.minDec);
  return {ra:normalizeRA(atlas.centerRA+offset),dec};
}
export function isInZodiacChart(atlas:ZodiacAtlas,position:SkyPoint):boolean{
  const b=zodiacAtlasBounds(atlas);
  const offset=signedRaOffset(position.ra,atlas.centerRA);
  return Number.isFinite(offset)&&Number.isFinite(position.dec)
    &&offset>=b.minRA&&offset<=b.maxRA
    &&position.dec>=b.minDec&&position.dec<=b.maxDec;
}
