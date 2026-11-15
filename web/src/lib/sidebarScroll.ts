/** Adaptive sticky positioning for the feed's companion column.
 * Use a negative top when the sidebar is taller than the visible viewport:
 * its contents then scroll into view rather than staying unreachable above
 * a never-ending feed. When short, preserve the 76px header clearance.
 */
export function feedSidebarStickyTop(
  viewportHeight:number,sidebarHeight:number,
  headerClearance=76,bottomClearance=16,
):number {
  if(!Number.isFinite(viewportHeight)||!Number.isFinite(sidebarHeight)
    ||viewportHeight<=0||sidebarHeight<0)return headerClearance;
  return Math.min(headerClearance,Math.floor(viewportHeight-sidebarHeight-bottomClearance));
}
