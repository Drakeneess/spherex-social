import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const tsSource=readFileSync(new URL('../src/lib/skyDock.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(tsSource,{
  compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022},
}).outputText;
const {isTerminalSkyPhase,shouldShowSkyDock}=await import(
  'data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'),
);
const status=(phase,restored=false,loading=false)=>({
  jobId:'same-persistent-job',restored,loading,
  trace:{phase,startedAt:1,source:'sia2',frames:[]},
});

test('resumed completed searches do not replay an obsolete ready notice',()=>{
  for(const phase of ['complete','partial','empty','failed','cancelled']){
    assert.equal(isTerminalSkyPhase(phase),true);
    assert.equal(shouldShowSkyDock(status(phase,true,false),false,false),false);
  }
  assert.equal(shouldShowSkyDock(status('complete',false,false),false,false),true);
});
test('restored searches keep their real background progress visible',()=>{
  assert.equal(shouldShowSkyDock(status('catalog',true,true),false,false),true);
  assert.equal(shouldShowSkyDock(status('frames',true,true),false,false),true);
  assert.equal(shouldShowSkyDock(status('frames',true,false),false,false),false);
  assert.equal(shouldShowSkyDock(status('complete',true,false),false,false),false);
});
test('no dock while exploring, after explicit dismiss or before status hydration',()=>{
  assert.equal(shouldShowSkyDock(status('frames',false,true),true,false),false);
  assert.equal(shouldShowSkyDock(status('frames',false,true),false,true),false);
  assert.equal(shouldShowSkyDock(null,false,false),false);
});
