import type { ExplorerBackgroundStatus } from '../components/BackgroundSkyDock';
import type { SearchTrace } from '../components/SearchProgress';

export function isTerminalSkyPhase(phase:SearchTrace['phase']):boolean {
  return ['complete','partial','empty','failed','cancelled'].includes(phase);
}

/** An older completed job remains available, not an unread notification. */
export function shouldShowSkyDock(
  status:ExplorerBackgroundStatus|null,
  explorerVisible:boolean,
  dismissed:boolean,
):boolean {
  if(explorerVisible||dismissed||!status?.trace)return false;
  if(!status.restored)return true; // A search initiated here can notify once.
  return Boolean(status.loading&&
    (status.trace.phase==='catalog'||status.trace.phase==='frames'));
}
