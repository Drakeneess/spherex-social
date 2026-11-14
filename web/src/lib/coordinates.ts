/** Format ICRS-style sky positions for display; source values remain degrees. */
export function formatRa(raDegrees: number): string {
  const hours = ((raDegrees / 15) % 24 + 24) % 24;
  const h = Math.floor(hours);
  const minutes = (hours - h) * 60;
  const m = Math.floor(minutes);
  const seconds = (minutes - m) * 60;
  return `${String(h).padStart(2, '0')}h${String(m).padStart(2, '0')}m${seconds.toFixed(1)}s`;
}
export function formatDec(degrees: number): string {
  const value = Math.abs(degrees);
  const d = Math.floor(value);
  const m = Math.floor((value - d) * 60);
  return `${degrees < 0 ? '−' : '+'}${String(d).padStart(2, '0')}°${String(m).padStart(2, '0')}′`;
}
