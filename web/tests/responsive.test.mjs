import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const css=read('../src/responsive.css');
const app=read('../src/App.tsx');
const entry=read('../src/main.tsx');
const index=read('../index.html');
const chart=read('../src/components/ZodiacChart.tsx');

test('responsive layer is last and viewport supports device safe areas',()=>{
  assert.ok(entry.indexOf("import './responsive.css'")>entry.indexOf("import './astrogram.css'"));
  assert.match(index,/name="viewport"[^>]+viewport-fit=cover/);
});

test('all major live views have dedicated responsive rules',()=>{
  for(const view of [
    'feed-layout','epoch-grid','profile-summary','profile-editor',
    'notifications','saved','settings-page','global-results',
    'compose-dialog','reveal-studio-dialog','post-media-lightbox-dialog',
    'taurus-atlas','gbox','ag-tour__tip','sky-background-dock',
  ]){
    assert.ok(css.includes(view),view+' is missing responsive coverage');
  }
  for(const width of [1100,900,820,680,520,390]){
    assert.ok(css.includes('@media(max-width:'+width+'px)'),String(width));
  }
});

test('mobile navigation is reachable with labeled buttons and top search',()=>{
  assert.match(app,/className="navbar-search-trigger"/);
  assert.match(app,/data-global-search-toggle/);
  assert.match(css,/\.astrogram-shell \.navbar \.nav\s*\{[^}]*position:fixed/s);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/\.astrogram-shell \.navbar \.nav button\.nav-search-mobile\{display:none\}/);
  for(const label of ['Inicio','Explorar','Juego','Perfil','Ajustes','Crear publicación']){
    assert.ok(app.includes('aria-label="'+label+'"'),label);
  }
});

test('overlays use dynamic viewport height and content can scroll',()=>{
  for(const cls of ['compose-dialog','reveal-studio-dialog','profile-post-dialog','post-media-lightbox-dialog']){
    assert.ok(css.includes('.'+cls),cls);
  }
  assert.match(css,/100dvh/);
  assert.match(css,/\.reveal-studio-workspace\{overflow-y:auto/);
  assert.match(css,/\.sky-background-dock\{[^}]*env\(safe-area-inset-bottom\)/s);
});

test('interactive game and zodiac charts stay operable on small viewports',()=>{
  assert.match(css,/\.gbox>svg\{[^}]*inline-size:100%/s);
  assert.match(chart,/className="taurus-atlas-map" tabIndex=\{0\} role="region"/);
  assert.match(css,/\.taurus-chart-svg\{[^}]*width:max\(100%,540px\)/s);
  assert.match(css,/\.taurus-map-swipe-hint\{/);
});
