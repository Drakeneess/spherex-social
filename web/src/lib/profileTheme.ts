/** Pure, deterministic profile color defaults and safe background helpers. */
export type ThemeColors={start:string;end:string};
const HEX=/^#[0-9a-f]{6}$/i;
export const DEFAULT_COVER:ThemeColors={start:'#12254b',end:'#3c2256'};
export const PROFILE_PRESETS:{name:string;colors:ThemeColors}[]=[
  {name:'Nebulosa',colors:{start:'#536dfe',end:'#f46ba5'}},
  {name:'Cian',colors:{start:'#43bbed',end:'#06678a'}},
  {name:'Aurora',colors:{start:'#49c78e',end:'#284dc3'}},
  {name:'Solar',colors:{start:'#f7a74f',end:'#db477f'}},
  {name:'Nocturno',colors:{start:'#152650',end:'#52285f'}},
];

function hslToHex(h:number,s:number,l:number):string{
  s/=100;l/=100;
  const a=s*Math.min(l,1-l);
  const convert=(n:number)=>{
    const k=(n+h/30)%12;
    const color=l-a*Math.max(-1,Math.min(k-3,9-k,1));
    return Math.round(255*color).toString(16).padStart(2,'0');
  };
  return '#'+convert(0)+convert(8)+convert(4);
}
export function fallbackAvatarColors(username:string):ThemeColors{
  const hue=Array.from(username).reduce((sum,ch)=>sum+ch.charCodeAt(0)*17,0)%360;
  return {start:hslToHex(hue,80,60),end:hslToHex((hue+70)%360,76,48)};
}
export function safeHexColor(color:string|null|undefined,fallback:string):string{
  return color&&HEX.test(color)?color.toLowerCase():fallback;
}
export function themeGradient(colors:ThemeColors):string{
  return `linear-gradient(135deg, ${safeHexColor(colors.start,'#536dfe')}, ${safeHexColor(colors.end,'#f46ba5')})`;
}
