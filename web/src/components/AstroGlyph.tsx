/** Visual-only icon sprite sourced from the supplied FINAL2.html design reference. */
type AstroGlyphName = 'home'|'telescope'|'target'|'bell'|'gear'|'spark'|'ship'|'ship-on'|'galaxy'|'flame'|'pin'|'pen';

export default function AstroGlyph({name,size=20,className=''}:{
  name:AstroGlyphName;size?:number;className?:string;
}) {
  return <svg className={`ag-glyph ${className}`.trim()} width={size} height={size}
    viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <use href={`#ag-${name}`}/>
  </svg>;
}
