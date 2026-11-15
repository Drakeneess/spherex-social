/**
 * AstroGram's original, procedural UI sound palette.
 *
 * All tones are generated locally using Web Audio: no requests, media files,
 * autoplay or tracking. An AudioContext is only created from a user gesture.
 * Playback is ignored when the app is hidden, muted, or audio is unsupported.
 */
export type UISound =
  | 'tap' | 'navigate' | 'open' | 'close' | 'toggle'
  | 'like' | 'unlike' | 'bookmark' | 'unbookmark'
  | 'comment' | 'repost' | 'unrepost' | 'follow' | 'unfollow'
  | 'publish' | 'search' | 'mark' | 'success' | 'error'
  | 'game-win' | 'game-miss';

export type SoundSettings = { enabled: boolean; volume: number };
export const SOUND_STORAGE_KEY = 'astrogram.sound.v1';
export const SOUND_SETTINGS_EVENT = 'astrogram:sound-settings';
export const DEFAULT_SOUND_SETTINGS: Readonly<SoundSettings> = {
  enabled: true, volume: 45,
};

type Voice = {
  at?: number;
  hz: number;
  to?: number;
  duration: number;
  level: number;
  type?: OscillatorType;
};

// Volume is bounded globally to 16% of full output. The individual voices
// use small envelopes with no abrupt edges to avoid harsh clicks.
const PALETTE: Readonly<Record<UISound, readonly Voice[]>> = {
  tap:       [{hz:540,to:465,duration:.065,level:.24}],
  navigate:  [{hz:485,to:630,duration:.105,level:.28},
              {at:.072,hz:795,to:710,duration:.09,level:.20}],
  open:      [{hz:380,to:620,duration:.155,level:.31},
              {at:.09,hz:740,to:860,duration:.12,level:.17}],
  close:     [{hz:680,to:390,duration:.105,level:.26}],
  toggle:    [{hz:460,to:570,duration:.075,level:.25}],
  like:      [{hz:330,to:810,duration:.19,level:.44,type:'triangle'},
              {at:.10,hz:970,to:1240,duration:.16,level:.34},
              {at:.205,hz:1318,to:1180,duration:.105,level:.19}],
  unlike:    [{hz:660,to:430,duration:.12,level:.27}],
  bookmark:  [{hz:650,to:900,duration:.12,level:.32},
              {at:.10,hz:1175,to:1045,duration:.135,level:.28}],
  unbookmark:[{hz:775,to:470,duration:.125,level:.25}],
  comment:   [{hz:570,to:710,duration:.11,level:.27},
              {at:.082,hz:850,to:940,duration:.10,level:.22}],
  repost:    [{hz:465,to:720,duration:.12,level:.32},
              {at:.10,hz:650,to:990,duration:.18,level:.30}],
  unrepost:  [{hz:710,to:490,duration:.11,level:.24}],
  follow:    [{hz:523,duration:.14,level:.29},
              {at:.10,hz:659,duration:.16,level:.29},
              {at:.22,hz:784,duration:.20,level:.34}],
  unfollow:  [{hz:600,to:410,duration:.13,level:.23}],
  publish:   [{hz:523,duration:.18,level:.33},
              {at:.10,hz:659,duration:.19,level:.36},
              {at:.20,hz:784,duration:.25,level:.37},
              {at:.27,hz:1047,duration:.25,level:.27}],
  search:    [{hz:760,to:1090,duration:.13,level:.28},
              {at:.13,hz:560,to:710,duration:.14,level:.19}],
  mark:      [{hz:1030,to:660,duration:.14,level:.29,type:'triangle'},
              {at:.075,hz:1430,to:1150,duration:.08,level:.12}],
  success:   [{hz:659,duration:.15,level:.30},
              {at:.12,hz:880,duration:.17,level:.30},
              {at:.23,hz:1175,duration:.20,level:.28}],
  error:     [{hz:392,to:320,duration:.11,level:.18,type:'triangle'},
              {at:.11,hz:350,to:260,duration:.14,level:.14}],
  'game-win':[{hz:660,duration:.13,level:.33},
              {at:.095,hz:880,duration:.14,level:.35},
              {at:.20,hz:1320,duration:.22,level:.35}],
  'game-miss':[{hz:370,to:270,duration:.155,level:.19,type:'triangle'}],
};

export function normalizeSoundSettings(value: unknown): SoundSettings {
  const raw = value && typeof value === 'object' ? value as Partial<SoundSettings> : {};
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume)
    ? Math.round(Math.max(0, Math.min(100, raw.volume)))
    : DEFAULT_SOUND_SETTINGS.volume;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_SOUND_SETTINGS.enabled,
    volume,
  };
}

let cache: SoundSettings | null = null;
let context: AudioContext | null = null;
let lastPlayed: Partial<Record<UISound, number>> = {};

export function getSoundSettings(): SoundSettings {
  if (cache) return {...cache};
  let saved: unknown = null;
  try {
    if (typeof localStorage !== 'undefined') {
      const text = localStorage.getItem(SOUND_STORAGE_KEY);
      if (text) saved = JSON.parse(text) as unknown;
    }
  } catch { /* Private browsing and blocked storage remain functional. */ }
  cache = normalizeSoundSettings(saved);
  return {...cache};
}

export function updateSoundSettings(partial: Partial<SoundSettings>): SoundSettings {
  const next = normalizeSoundSettings({...getSoundSettings(), ...partial});
  cache = next;
  try { localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(next)); } catch { /* optional */ }
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(SOUND_SETTINGS_EVENT, {detail:next}));
  return {...next};
}

function audio(): AudioContext | null {
  if (context && context.state !== 'closed') return context;
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  try { context = new AudioContext(); } catch { return null; }
  return context;
}

export function unlockAudio(): void {
  const settings = getSoundSettings();
  if (!settings.enabled || settings.volume === 0) return;
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume().catch(()=>{});
}

export function playSound(name: UISound): void {
  const {enabled,volume} = getSoundSettings();
  if (!enabled || volume === 0) return;
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
  if (!(name in PALETTE)) return;

  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(()=>{});
  if (ctx.state === 'closed') return;

  const now = ctx.currentTime;
  const cooldown = name === 'tap' ? .065 : name === 'toggle' ? .09 : .13;
  const last = lastPlayed[name];
  if (last !== undefined && now - last < cooldown) return;
  lastPlayed[name] = now;

  try {
    for (const voice of PALETTE[name]) {
      const start = now + .006 + (voice.at ?? 0);
      const end = start + voice.duration;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = voice.type ?? 'sine';
      oscillator.frequency.setValueAtTime(voice.hz, start);
      if (voice.to && voice.to !== voice.hz) {
        oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, voice.to), end);
      }
      const peak = (volume / 100) * .16 * voice.level;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(peak, start + Math.min(.012, voice.duration * .2));
      gain.gain.exponentialRampToValueAtTime(.0001, end);
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(end + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    }
  } catch { /* Old browsers or interrupted audio devices fail silently. */ }
}

const isSound = (value:string|null): value is UISound =>
  value !== null && Object.prototype.hasOwnProperty.call(PALETTE,value);

/**
 * One delegated event listener for the whole React application. It's installed
 * once in main.tsx, NOT once per component, and plays at most one navigation/
 * control click. data-sound="none" defers feedback to confirmed async actions.
 */
export function installInteractionSounds(): () => void {
  if (typeof document === 'undefined') return () => {};
  const click = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const element = target.closest<HTMLElement>('button,a[href],[role="button"]');
    if (!element || element.closest('[aria-hidden="true"]')) return;
    if (element.matches(':disabled,[aria-disabled="true"]')) return;
    if (element.dataset.sound === 'none') {
      unlockAudio();
      return;
    }
    unlockAudio();
    playSound(isSound(element.dataset.sound ?? null) ? element.dataset.sound as UISound
      : element.matches('a[href]') ? 'navigate' : 'tap');
  };
  const change = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element) || target.closest('[data-sound="none"]')) return;
    if (target.matches('select,input[type="checkbox"]')) playSound('toggle');
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') unlockAudio();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== SOUND_STORAGE_KEY) return;
    cache = null;
    window.dispatchEvent(new CustomEvent(SOUND_SETTINGS_EVENT,{detail:getSoundSettings()}));
  };
  document.addEventListener('click',click,true);
  document.addEventListener('change',change,true);
  document.addEventListener('keydown',keydown,true);
  window.addEventListener('storage',storage);
  return () => {
    document.removeEventListener('click',click,true);
    document.removeEventListener('change',change,true);
    document.removeEventListener('keydown',keydown,true);
    window.removeEventListener('storage',storage);
  };
}
