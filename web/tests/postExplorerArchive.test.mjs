import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const app=file('../src/App.tsx');
const explorer=file('../src/pages/ExplorerPage.tsx');
const post=file('../src/components/PostCard.tsx');
const detail=file('../src/components/PostDetailPage.tsx');

test('post-to-explorer route carries the source post identity',()=>{
  assert.match(post,/onExplore\(region\.id,post\.id\)/);
  assert.match(app,/source_post/);
  assert.match(app,/function openObservation\(id:string,sourcePostId\?:string\)/);
  assert.match(app,/sourcePostId=\{explorerVisible\?route\.sourcePostId:undefined\}/);
  assert.match(detail,/onExplore:\(id:string,sourcePostId\?:string\)/);
  assert.match(post,/&source_post=\$\{encodeURIComponent\(post\.id\)\}/);
});

test('post-linked sky images reuse their stored job without POSTing a second IRSA search',()=>{
  assert.match(explorer,/const linked = await api\.preparePostBlink\(sourcePostId\)/);
  assert.match(explorer,/const existing = await api\.getPersistentSkyJob\(linked\.job_id\)/);
  assert.match(explorer,/watchSearch\(existing\.job_id,storedParams,true,true\)/);
  assert.match(explorer,/if \(!alreadyStored\) await api\.createPersistentSkyJob/);
  assert.match(explorer,/frames: query\.max_frames/);
  assert.match(explorer,/JSON\.stringify\(\{jobId:existing\.job_id,params:storedParams\}\)/);
});

test('reused image job must match the saved observation and cannot be a demo',()=>{
  assert.match(explorer,/if \(query\.demo \|\|/);
  assert.match(explorer,/Math\.abs\(query\.ra - saved\.ra_deg\) > 1e-7/);
  assert.match(explorer,/Math\.abs\(query\.dec - saved\.dec_deg\) > 1e-7/);
  assert.match(explorer,/Math\.abs\(query\.size_arcmin - saved\.fov_arcmin\) > 1e-7/);
  assert.match(explorer,/query\.detector !== saved\.detector/);
  assert.match(explorer,/No fue posible recuperar las imágenes archivadas/);
});

test('standalone saved searches remain available without a post link',()=>{
  assert.match(explorer,/if \(sourcePostId\) \{/);
  assert.match(explorer,/load\(params\);\s*setSavedId\(saved\.id\);/);
  assert.match(explorer,/if \(!observationId\) return;/);
});
