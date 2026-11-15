/** The project's official uploaded logo, reused in the header, auth and loading screen. */
export default function BrandLogo({size=36,className=''}:{
  size?:number;className?:string;
}) {
  return <span className={`brand-mark ${className}`.trim()}
    style={{width:size,height:size}} aria-hidden="true">
    <img src="/astrogram-logo.svg" alt="" decoding="async" />
  </span>;
}
