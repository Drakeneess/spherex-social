/** Taurus (IAU abbreviation Tau), a navigable J2000 reference star chart.
 * Star positions (RA/Dec, deg) are from published Hipparcos/HYG-based
 * tables: https://en.wikipedia.org/wiki/List_of_stars_in_Taurus
 * M1: NASA Hubble (05h34m31.94s, +22°00′52.2″):
 * https://science.nasa.gov/asset/hubble/scale-and-compass-for-crab-nebula/
 * IAU nomenclature: https://www.iau.org/IAU/Astronomy-FAQs/Constellations.aspx
 *
 * Figure strokes are an illustrative asterism, NOT official IAU borders.
 * Neither the chart nor its star dots are SPHEREx images/measurements.
 */
export type SkyPosition={ra:number;dec:number};
export type TaurusTarget=SkyPosition&{
  id:string;name:string;aliases:readonly string[];
  kind:'star'|'cluster'|'nebula';magnitude?:number;
};
export const TAURUS_ID='taurus';
export const TAURUS_CENTER:SkyPosition={ra:67.65,dec:17.52};
export const TAURUS_VIEW={raMin:47,raMax:92,decMin:0,decMax:36};
export const TAURUS_CHART={width:900,height:510,left:64,right:836,top:51,bottom:448};

export const TAURUS_TARGETS:readonly TaurusTarget[]=[
  {id:'aldebaran',name:'Aldebarán',aliases:['aldebaran','alpha tauri','α tauri'],
    kind:'star',ra:68.980,dec:16.5098,magnitude:.87},
  {id:'elnath',name:'Elnath',aliases:['elnath','el nath','beta tauri'],
    kind:'star',ra:81.5729,dec:28.6079,magnitude:1.65},
  {id:'alcyone',name:'Alcíone',aliases:['alcyone','alcione','eta tauri'],
    kind:'star',ra:56.8711,dec:24.1053,magnitude:2.85},
  {id:'tianguan',name:'Tianguan',aliases:['tianguan','zeta tauri'],
    kind:'star',ra:84.4112,dec:21.1426,magnitude:2.97},
  {id:'chamukuy',name:'Chamukuy',aliases:['chamukuy','theta tauri'],
    kind:'star',ra:67.1653,dec:15.8710,magnitude:3.40},
  {id:'lambda',name:'Lambda Tauri',aliases:['lambda tauri','λ tauri'],
    kind:'star',ra:60.1701,dec:12.4904,magnitude:3.41},
  {id:'ain',name:'Ain',aliases:['ain','epsilon tauri','ε tauri'],
    kind:'star',ra:67.1539,dec:19.1805,magnitude:3.53},
  {id:'omicron',name:'Ómicron Tauri',aliases:['omicron tauri','ο tauri'],
    kind:'star',ra:51.2035,dec:9.0291,magnitude:3.61},
  {id:'gamma',name:'Prima Hyadum',aliases:['prima hyadum','gamma tauri','γ tauri'],
    kind:'star',ra:64.9480,dec:15.6277,magnitude:3.65},
  {id:'delta1',name:'Secunda Hyadum',aliases:['secunda hyadum','delta tauri'],
    kind:'star',ra:65.7335,dec:17.5426,magnitude:3.77},
  {id:'m45',name:'Pléyades (M45)',
    aliases:['pleyades','pleiades','m45','messier 45','las siete hermanas'],
    kind:'cluster',ra:56.75,dec:24.1167},
  {id:'m1',name:'Nebulosa del Cangrejo (M1)',
    aliases:['m1','messier 1','nebulosa del cangrejo','crab nebula','ngc 1952'],
    kind:'nebula',ra:83.6331,dec:22.0145},
];

/** Decorative connectivity only, not IAU official boundaries or photometry. */
export const TAURUS_FIGURE_LINES:readonly (readonly [string,string])[]=[
  ['elnath','ain'],['ain','delta1'],['delta1','gamma'],
  ['gamma','chamukuy'],['chamukuy','aldebaran'],
  ['aldebaran','tianguan'],['gamma','lambda'],
];

const normalize=(text:string)=>text.normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'').trim().toLowerCase()
  .replace(/\s+/g,' ');

export function findTaurusTarget(text:string):TaurusTarget|undefined{
  const term=normalize(text);
  return TAURUS_TARGETS.find(target=>
    normalize(target.name)===term ||
    target.aliases.some(name=>normalize(name)===term));
}

export type SkyNameMatch={type:'constellation';id:'taurus'}|
  {type:'target';id:'taurus';target:TaurusTarget};

/** Exact matches: names of unrelated profiles must still go to profile search. */
export function resolveSkyName(text:string):SkyNameMatch|null{
  const term=normalize(text);
  if(['tauro','taurus','tau','constelacion tauro','constelacion de tauro',
      'constelacion taurus','constellation taurus'].includes(term)){
    return {type:'constellation',id:'taurus'};
  }
  const target=findTaurusTarget(term);
  return target?{type:'target',id:'taurus',target}:null;
}

function clamp(value:number,min:number,max:number){
  return Math.min(max,Math.max(min,value));
}

/** Equirectangular RA/Dec guide grid: north up, east (higher RA) left. */
export function projectTaurus(position:SkyPosition):{x:number;y:number}{
  const {raMin,raMax,decMin,decMax}=TAURUS_VIEW;
  const {left,right,top,bottom}=TAURUS_CHART;
  return {
    x:left+(raMax-position.ra)/(raMax-raMin)*(right-left),
    y:top+(decMax-position.dec)/(decMax-decMin)*(bottom-top),
  };
}
export function unprojectTaurus(x:number,y:number):SkyPosition{
  const {raMin,raMax,decMin,decMax}=TAURUS_VIEW;
  const {left,right,top,bottom}=TAURUS_CHART;
  return {
    ra:clamp(raMax-(x-left)/(right-left)*(raMax-raMin),raMin,raMax),
    dec:clamp(decMax-(y-top)/(bottom-top)*(decMax-decMin),decMin,decMax),
  };
}
export function withinTaurusChart(position:SkyPosition){
  return Number.isFinite(position.ra)&&Number.isFinite(position.dec)
    &&position.ra>=TAURUS_VIEW.raMin&&position.ra<=TAURUS_VIEW.raMax
    &&position.dec>=TAURUS_VIEW.decMin&&position.dec<=TAURUS_VIEW.decMax;
}
