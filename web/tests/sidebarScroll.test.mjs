import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const text=readFileSync(new URL('../src/lib/sidebarScroll.ts',import.meta.url),'utf8');
const js=ts.transpileModule(text,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
}}).outputText;
const {feedSidebarStickyTop}=await import(
  'data:text/javascript;base64,'+Buffer.from(js).toString('base64')
);

test('short sidebars stay beneath the sticky header',()=>{
  assert.equal(feedSidebarStickyTop(900,350),76);
  assert.equal(feedSidebarStickyTop(900,800),76);
});
test('tall sidebar scrolls with the page until its footer is on screen',()=>{
  const offset=feedSidebarStickyTop(800,1250);
  assert.equal(offset,-466);
  assert.equal(offset+1250,800-16);
});
test('viewport resize and onboarding height dynamically change the offset',()=>{
  assert.equal(feedSidebarStickyTop(1200,900),76);
  assert.equal(feedSidebarStickyTop(700,900),-216);
  assert.equal(feedSidebarStickyTop(800,900),-116);
});
test('invalid measurements fall back to normal sticky placement',()=>{
  assert.equal(feedSidebarStickyTop(Infinity,1000),76);
  assert.equal(feedSidebarStickyTop(800,NaN),76);
});
