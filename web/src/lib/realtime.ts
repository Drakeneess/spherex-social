/** A single authenticated SSE stream per mounted AstroGram application.
 * PostgreSQL signals are invalidations; always re-read authoritative REST data.
 * Streams reconnect with bounded backoff and reconcile on every new connection.
 */
import { realtimeBase, realtimeToken } from './api';

export const REALTIME_EVENT = 'astrogram:realtime';

export type RealtimeChange = {
  kind: 'resync'|'feed'|'interaction'|'comments'|'profile'|'profile_stats'|
        'profile_posts'|'bookmarks'|'notifications'|'sky_job';
  post_id?: string;
  username?: string;
  job_id?: string;
};

const kinds = new Set<RealtimeChange['kind']>([
  'resync','feed','interaction','comments','profile','profile_stats',
  'profile_posts','bookmarks','notifications','sky_job',
]);

function decodeChange(raw: string): RealtimeChange | null {
  try {
    const value: unknown = JSON.parse(raw);
    if(!value || typeof value !== 'object')return null;
    const object = value as Record<string,unknown>;
    if(typeof object.kind !== 'string' || !kinds.has(object.kind as RealtimeChange['kind']))return null;
    const change: RealtimeChange = {kind:object.kind as RealtimeChange['kind']};
    for(const key of ['post_id','username','job_id'] as const){
      if(typeof object[key] === 'string')change[key] = object[key] as string;
    }
    return change;
  }catch{return null;}
}

export function subscribeRealtime(handler:(change:RealtimeChange)=>void):()=>void {
  const listener=(event:Event)=>{
    const change=(event as CustomEvent<RealtimeChange>).detail;
    if(change && kinds.has(change.kind))handler(change);
  };
  window.addEventListener(REALTIME_EVENT,listener);
  return ()=>window.removeEventListener(REALTIME_EVENT,listener);
}

export function startRealtime(onChange:(change:RealtimeChange)=>void, authenticated=false,
                              jobId?:string):()=>void {
  let stopped=false;
  let connected=false;
  let active:AbortController|null=null;
  let retryTimer:ReturnType<typeof setTimeout>|null=null;
  let finishRetry:(()=>void)|null=null;
  let backoff=1500;

  const publish=(change:RealtimeChange)=>onChange(change);
  const fallback=window.setInterval(()=>{
    if(!connected && document.visibilityState==='visible')publish({kind:'resync'});
  },60000);

  const onFocus=()=>{
    if(document.visibilityState==='visible' && !connected)publish({kind:'resync'});
  };
  window.addEventListener('focus',onFocus);
  document.addEventListener('visibilitychange',onFocus);

  async function connect(){
    while(!stopped){
      active=new AbortController();
      try{
        // A fresh short-lived JWT also survives reconnects after 30 minutes.
        const token=authenticated ? await realtimeToken() : null;
        if(stopped)return;
        const response=await fetch(realtimeBase+'/v1/events'+(jobId?'?job_id='+encodeURIComponent(jobId):''),{
          method:'GET',credentials:'same-origin',cache:'no-store',
          headers:{'Accept':'text/event-stream',...(token?{'Authorization':'Bearer '+token}:{})},
          signal:active.signal,
        });
        if(!response.ok || !response.body)throw new Error('Realtime transport unavailable');
        connected=true;
        backoff=1500;
        const reader=response.body.getReader();
        const decoder=new TextDecoder();
        let buffer='';
        while(!stopped){
          const {done,value}=await reader.read();
          if(done)break;
          buffer += decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');
          if(buffer.length>65536)throw new Error('Oversized event');
          let boundary=buffer.indexOf('\n\n');
          while(boundary!==-1){
            const packet=buffer.slice(0,boundary);
            buffer=buffer.slice(boundary+2);
            const type=packet.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
            if(type==='ready')publish({kind:'resync'});
            else if(type==='change'){
              const raw=packet.split('\n').filter(line=>line.startsWith('data:'))
                .map(line=>line.slice(5).trimStart()).join('\n');
              const change=decodeChange(raw);
              if(change)publish(change);
            }
            boundary=buffer.indexOf('\n\n');
          }
        }
      }catch{
        // REST refresh on focus / fallback; no error modal for a transient stream.
      }finally{
        connected=false;
        active=null;
      }
      if(stopped)break;
      const delay=backoff;
      backoff=Math.min(backoff*2,30000);
      await new Promise<void>(resolve=>{
        finishRetry=resolve;
        retryTimer=setTimeout(()=>{
          retryTimer=null;
          finishRetry=null;
          resolve();
        },delay);
      });
    }
  }
  void connect();

  return ()=>{
    stopped=true;
    active?.abort();
    if(retryTimer!==null)clearTimeout(retryTimer);
    finishRetry?.();
    window.clearInterval(fallback);
    window.removeEventListener('focus',onFocus);
    document.removeEventListener('visibilitychange',onFocus);
  };
}
