import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path,import.meta.url),'utf8');
const sounds = read('../src/lib/sounds.ts');
const main = read('../src/main.tsx');
const app = read('../src/App.tsx');
const settings = read('../src/components/SoundSettingsPanel.tsx');
const quick = read('../src/components/SoundQuickToggle.tsx');
const posts = read('../src/components/PostCard.tsx');
const explorer = read('../src/pages/ExplorerPage.tsx');
const game = read('../src/pages/GamePage.tsx');
const publish = read('../src/components/PublishModal.tsx');

test('all sound cues are original Web Audio tones with envelope and volume bounds', () => {
  assert.match(sounds,/new AudioContext\(\)/);
  assert.match(sounds,/ctx\.createOscillator\(\)/);
  assert.match(sounds,/ctx\.createGain\(\)/);
  assert.match(sounds,/oscillator\.stop\(end \+ \.02\)/);
  assert.match(sounds,/Math\.max\(0, Math\.min\(100, raw\.volume\)\)/);
  assert.match(sounds,/volume \/ 100\) \* \.16/);
  assert.doesNotMatch(sounds,/\bfetch\(|new Audio\(|<audio|playbackRate/);
  for (const cue of [
    'tap','navigate','open','close','toggle','like','unlike',
    'bookmark','unbookmark','comment','repost','unrepost',
    'follow','unfollow','publish','search','mark','success','error',
    'game-win','game-miss',
  ]) {
    assert.ok(sounds.includes(cue+':') || sounds.includes("'"+cue+"':"),
      'missing palette cue: '+cue);
  }
});

test('playback is limited to user interactions and respects mute, volume, tab visibility',()=>{
  assert.match(sounds,/enabled: true, volume: 45/);
  assert.match(sounds,/!enabled \|\| volume === 0/);
  assert.match(sounds,/document\.visibilityState === 'hidden'/);
  assert.match(sounds,/element\.dataset\.sound === 'none'/);
  assert.match(sounds,/ctx\.resume\(\)\.catch/);
  assert.match(sounds,/localStorage\.setItem\(SOUND_STORAGE_KEY/);
  assert.match(sounds,/window\.addEventListener\('storage',storage\)/);
  assert.match(sounds,/document\.addEventListener\('click',click,true\)/);
  assert.match(main,/installInteractionSounds\(\)/);
  assert.match(sounds,/return \(\) => \{/);
});

test('settings panel exposes persistent mute, volume and five sound demos',()=>{
  assert.match(app,/<SoundSettingsPanel\/>/);
  assert.match(settings,/checked=\{settings\.enabled\}/);
  assert.match(settings,/type="range" min=\{0\} max=\{100\} step=\{5\}/);
  assert.match(settings,/onClick=\{\(\)=>playSound\(item\.name\)\}/);
  assert.match(settings,/data-sound="none"/);
  for(const label of ['Pulsación','Me encoheta','Guardar','Publicar','Marcar estrella']){
    assert.ok(settings.includes(label),label);
  }
});

test('social feedback follows confirmed async results, never just optimistic clicks',()=>{
  assert.match(posts,/await api\.like\(post\.id\)/);
  assert.match(posts,/playSound\(liked\?'unlike':'like'\)/);
  assert.match(posts,/await api\.bookmark\(post\.id\)/);
  assert.match(posts,/playSound\(wasBookmarked\?'unbookmark':'bookmark'\)/);
  assert.match(posts,/await api\.createComment\(post\.id,draft\.trim\(\)\);playSound\('comment'\)/);
  assert.match(posts,/playSound\(wasReposted\?'unrepost':'repost'\)/);
  assert.match(app,/playSound\(wasFollowing\?'unfollow':'follow'\)/);
  assert.match(app,/playSound\('publish'\);setToast\('Publicación creada en AstroGram'\)/);
  assert.match(publish,/data-tour="publish-submit" data-sound="none"/);
  assert.match(posts,/data-tour="like-button" data-sound="none"/);
});

test('science and educational gameplay use contextual, non-automatic sounds',()=>{
  assert.match(explorer,/playSound\('mark'\)/);
  assert.match(explorer,/playSound\('search'\)/);
  assert.match(explorer,/playSound\('bookmark'\)/);
  assert.match(game,/playSound\(correct\?'game-win':'game-miss'\)/);
  assert.match(game,/playSound\('success'\)/);
  assert.doesNotMatch(explorer,/useEffect\([^)]*playSound/s);
});


test('guests and signed-in users can mute immediately without visiting settings',()=>{
  assert.match(app,/import SoundQuickToggle from '\.\/components\/SoundQuickToggle'/);
  assert.match(app,/<SoundQuickToggle className="auth-sound-toggle"\/>/);
  assert.match(app,/<SoundQuickToggle\/>/);
  assert.match(quick,/data-sound="none"/);
  assert.match(quick,/aria-label=\{label\}/);
  assert.match(quick,/updateSoundSettings\(\{enabled:!audible/);
  assert.match(quick,/if\(next\.enabled\)playSound\('toggle'\)/);
});
