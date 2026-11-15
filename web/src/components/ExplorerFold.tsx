import { useId, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';

type Props = {
  id?:string;
  title:string;
  summary?:string;
  badge?:string;
  icon:LucideIcon;
  open:boolean;
  onToggle:(open:boolean)=>void;
  children:ReactNode;
  className?:string;
  busy?:boolean;
};

/**
 * Keep children mounted while the section is collapsed. This preserves
 * unsaved search parameters, analyzed candidates and the FITS reveal editor.
 */
export default function ExplorerFold({
  id,title,summary,badge,icon:Icon,open,onToggle,children,className='',busy=false,
}:Props){
  const generatedId=useId();
  const contentId=id??generatedId;
  return <section className={['card','explorer-fold',className,open?'is-open':'is-closed'].join(' ')}>
    <h2 className="explorer-fold-heading">
      <button type="button" className="explorer-fold-trigger"
        aria-expanded={open} aria-controls={contentId} onClick={()=>onToggle(!open)}>
        <span className="explorer-fold-icon"><Icon size={18} aria-hidden="true"/></span>
        <span className="explorer-fold-label">
          <strong>{title}</strong>
          {summary&&<small>{summary}</small>}
        </span>
        {badge&&<span className="explorer-fold-badge">{badge}</span>}
        <ChevronDown size={17} className="explorer-fold-chevron" aria-hidden="true"/>
      </button>
    </h2>
    {busy&&<div className="explorer-fold-live" aria-hidden="true"><span/></div>}
    <div id={contentId} className="explorer-fold-content" hidden={!open}>
      {children}
    </div>
  </section>;
}
