/** Mission completion experience does not alter real mission semantics. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=file('../src/App.tsx');
const finale=file('../src/components/MissionFinale.tsx');
const style=file('../src/astrogram.css');
const audio=file('../src/lib/sounds.ts');

test('6/6 finale replaces transient confetti with a full accessible dialog',()=>{
  assert.match(app,/<MissionFinale onClose=\{closeFinale\}\/>/);
  assert.doesNotMatch(app,/className="ag-onboard-confetti"/);
  assert.match(finale,/createPortal\(/);
  assert.match(finale,/role="dialog" aria-modal="true"/);
  assert.match(finale,/aria-labelledby="mission-finale-title"/);
  assert.match(finale,/aria-describedby="mission-finale-description"/);
  assert.match(finale,/aria-label="Cerrar celebración"/);
  assert.match(finale,/document\.body\.style\.overflow='hidden'/);
  assert.match(finale,/event\.key==='Escape'/);
  assert.match(finale,/event\.key!=='Tab'/);
  assert.match(finale,/TASKS\.map\(/);
  assert.doesNotMatch(finale,/setTimeout\(/);
});

test('once-per-account unlock is explicit but completed accounts can replay',()=>{
  assert.match(app,/newlyCompletedAllMissions\(prior,updated\)/);
  assert.match(app,/!readFlag\(user\.id,'missions-finale-v2'\)/);
  assert.match(app,/writeFlag\(user\.id,'missions-finale-v2'\)/);
  assert.match(app,/function replayFinale\(\)/);
  assert.match(app,/allMissionsCompleted\(readTasks\(user\.id\)\)/);
  assert.match(app,/Revivir celebración/);
  assert.match(app,/canReplayFinale=\{allMissionsCompleted\(missions\)\}/);
  assert.doesNotMatch(app,/setCelebrate\(false\),3400/);
});

test('new fanfare respects existing user preference and does not autoplay',()=>{
  assert.match(audio,/\| 'milestone';/);
  assert.match(audio,/milestone:\s*\[/);
  assert.match(app,/playSound\('milestone'\)/);
  assert.match(audio,/if \(!enabled \|\| volume === 0\) return;/);
  assert.match(audio,/document\.visibilityState === 'hidden'/);
});

test('mobile-safe celebration has particle animation and reduced motion fallback',()=>{
  assert.match(style,/\.mission-finale\{/);
  assert.match(style,/\.mission-finale-panel\{/);
  assert.match(style,/\.mission-finale-medal/);
  assert.match(style,/\.mission-finale-primary/);
  assert.match(style,/@media\(max-width:520px\)/);
  assert.match(style,/@media\(prefers-reduced-motion:reduce\)\{\s*\.mission-finale/);
  assert.match(style,/\.mission-finale-particle\{display:none\}/);
  assert.doesNotMatch(style,/\.ag-onboard-confetti\{/);
});
