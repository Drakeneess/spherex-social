/** Node-only checks for account-scoped onboarding state and guide contracts. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/lib/onboarding.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const spec=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const {
  TASKS, TASK_EVENT, NUDGE_EVENT,
  readTasks,saveTasks,readFlag,writeFlag,storageKey,signalTask,signalNudge,
  isTaskKey,welcomeSteps,explorerSteps,gameSteps,publishingSteps,nudgeStep,
}=spec;

class BrowserStorage {
  #data=new Map();
  getItem(key){return this.#data.get(key)??null;}
  setItem(key,value){this.#data.set(key,String(value));}
  removeItem(key){this.#data.delete(key);}
}
beforeEach(()=>{
  globalThis.localStorage=new BrowserStorage();
  globalThis.window=new EventTarget();
});
test('six uniquely keyed missions are associated with actual activities',()=>{
  assert.deepEqual(TASKS.map(x=>x.key),['explore','mark','game','like','bio','post']);
  for(const item of TASKS)assert.ok(item.title&&item.route);
  assert.equal(isTaskKey('like'),true);
  assert.equal(isTaskKey('forged'),false);
});
test('progress, seen flags and hidden state are isolated per account',()=>{
  saveTasks('account-a',{explore:true,mark:true});
  assert.deepEqual(readTasks('account-a'),{explore:true,mark:true});
  assert.deepEqual(readTasks('account-b'),{});
  writeFlag('account-a','welcome');
  writeFlag('account-a','hidden');
  assert.equal(readFlag('account-a','welcome'),true);
  assert.equal(readFlag('account-b','welcome'),false);
  assert.equal(readFlag('account-a','hidden'),true);
  writeFlag('account-a','hidden',false);
  assert.equal(readFlag('account-a','hidden'),false);
  assert.notEqual(storageKey('account-a','tasks'),storageKey('account-b','tasks'));
});
test('malformed or unrecognized stored tasks never unlock progress',()=>{
  localStorage.setItem(storageKey('p','tasks'),'{broken');
  assert.deepEqual(readTasks('p'),{});
  localStorage.setItem(storageKey('p','tasks'),JSON.stringify({explore:'true',mark:1,game:true,stranger:true}));
  assert.deepEqual(readTasks('p'),{game:true});
});
test('milestone and contextual events carry explicit action identities',()=>{
  const seen=[];
  const nudges=[];
  window.addEventListener(TASK_EVENT,e=>seen.push(e.detail.key));
  window.addEventListener(NUDGE_EVENT,e=>nudges.push(e.detail.key));
  signalTask('post');signalNudge('like');
  assert.deepEqual(seen,['post']);assert.deepEqual(nudges,['like']);
});
test('mock-derived guides only describe features that currently exist',()=>{
  const intro=welcomeSteps('Luna');
  assert.ok(intro.length>=7);
  assert.match(intro[0].title,/Luna/);
  assert.ok(intro.some(step=>step.target?.includes('first-steps')));
  assert.ok(explorerSteps.some(step=>step.target?.includes('explore-canvas')));
  assert.ok(gameSteps.some(step=>step.target?.includes('game-start')));
  assert.equal(publishingSteps(true).length,3);
  assert.equal(publishingSteps(false).length,3);
  assert.match(publishingSteps(true)[1].description,/marcas aún no se adjuntan/);
  assert.ok(nudgeStep('like').target.includes('like-button'));
});
