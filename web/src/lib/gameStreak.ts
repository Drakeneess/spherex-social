/**
 * Local-only educational-game streak. No server ranking or rewards are
 * claimed, and no social/profile data is stored by this module.
 */
const KEY = 'astrogram.local_game_streak.v1';
type Progress = { count: number; lastDay: string };
function localDay(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')].join('-');
}
function read(): Progress {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}') as Progress;
    if (typeof data.count === 'number' && Number.isInteger(data.count) &&
        data.count >= 0 && typeof data.lastDay === 'string') return data;
  } catch { /* invalid or unavailable browser storage */ }
  return { count: 0, lastDay: '' };
}
export function getGameStreak() {
  const progress = read();
  const now = new Date();
  const today = localDay(now);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const active = progress.lastDay === today || progress.lastDay === localDay(yesterday);
  return { count: active ? progress.count : 0, playedToday: progress.lastDay === today };
}
export function recordGameCompleted() {
  const progress = read();
  const now = new Date();
  const today = localDay(now);
  if (progress.lastDay === today) return;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const consecutive = progress.lastDay === localDay(yesterday);
  try {
    localStorage.setItem(KEY, JSON.stringify({
      count: consecutive ? progress.count + 1 : 1, lastDay: today,
    } satisfies Progress));
  } catch { /* the game still works without storage */ }
}
