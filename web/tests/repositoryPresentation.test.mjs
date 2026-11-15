import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');

test('project overview links to real docs and live AstroGram',()=>{
  const intro=read('../../README.md');
  assert.match(intro,/# AstroGram/);
  assert.match(intro,/https:\/\/astrogram\.up\.railway\.app\//);
  assert.match(intro,/docs\/ARCHITECTURE\.md/);
  assert.match(intro,/docs\/DEVELOPMENT\.md/);
  assert.match(intro,/docs\/SCIENCE\.md/);
  assert.match(intro,/NASA\/IPAC IRSA/);
  assert.match(intro,/no es un producto oficial de NASA/);
  assert.ok(intro.split('\n').length<210,'README must remain a compact presentation, not a sprint log');
  for(const f of ['ARCHITECTURE.md','DEVELOPMENT.md','SCIENCE.md']){
    assert.ok(existsSync(new URL('../../docs/'+f,import.meta.url)),f);
  }
});

test('local Vite proxy must never target production accidentally',()=>{
  const vite=read('../vite.config.ts');
  assert.match(vite,/const astroApi = env\.ASTRO_API_TARGET \|\| 'http:\/\/127\.0\.0\.1:8000'/);
  assert.match(vite,/const socialApi = env\.SOCIAL_API_TARGET \|\| 'http:\/\/127\.0\.0\.1:8000'/);
  assert.doesNotMatch(vite,/api-production-/);
});

test('scientific assets and secrets cannot be accidentally staged',()=>{
  const ignore=read('../../.gitignore');
  assert.match(ignore,/\.sky-frames\//);
  assert.match(ignore,/\.env/);
  assert.match(ignore,/node_modules\//);
  assert.match(ignore,/\.venv\//);
  assert.match(ignore,/\*\.tsbuildinfo/);
});

test('CI is reproducible and limits token permissions',()=>{
  const ci=read('../../.github/workflows/ci.yml');
  assert.match(ci,/npm ci/);
  assert.doesNotMatch(ci,/npm install/);
  assert.match(ci,/permissions:\s*\n\s*contents: read/);
  assert.match(ci,/postgres-realtime:/);
});
