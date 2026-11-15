import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/lib/taurus.ts',import.meta.url),'utf8');
const output=ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const {
  findTaurusTarget,TAURUS_TARGETS,TAURUS_CENTER,
  TAURUS_VIEW,TAURUS_FIGURE_LINES,projectTaurus,unprojectTaurus,withinTaurusChart,
  TAURUS_CHART,
}=await import('data:text/javascript;base64,'+Buffer.from(output).toString('base64'));

test('Taurus names stay off public navigation; DOB is required for the private atlas',()=>{
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  const explorer=readFileSync(new URL('../src/pages/ExplorerPage.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(app,/resolveSkyName|Buscar personas, Tauro/);
  assert.doesNotMatch(explorer,/constellation-lookup|locateByName|Buscar constelación u objeto/);
  assert.match(app,/constellationForBirthday\(user\?\.birth_date\)\?\.id===route\.constellation/);
  assert.equal(findTaurusTarget('Aldebarán')?.id,'aldebaran');
});

test('the main Taurus objects have distinct real J2000 positions',()=>{
  assert.equal(TAURUS_TARGETS.length>=10,true);
  const expected=[
    ['Aldebarán',68.980,16.5098],
    ['Elnath',81.5729,28.6079],
    ['Tianguan',84.4112,21.1426],
    ['Alcíone',56.8711,24.1053],
    ['Nebulosa del Cangrejo (M1)',83.6331,22.0145],
  ];
  for(const [name,ra,dec] of expected){
    const object=findTaurusTarget(name);
    assert.ok(object,name);
    assert.ok(Math.abs(object.ra-ra)<.0001);
    assert.ok(Math.abs(object.dec-dec)<.0001);
    assert.ok(withinTaurusChart(object));
  }
  for(const [a,b] of TAURUS_FIGURE_LINES){
    assert.ok(TAURUS_TARGETS.find(t=>t.id===a));
    assert.ok(TAURUS_TARGETS.find(t=>t.id===b));
  }
  assert.ok(withinTaurusChart(TAURUS_CENTER));
});
test('saved atlas targets retain their useful aliases',()=>{
  for(const [alias,id] of [
    ['aldebaran','aldebaran'],
    ['Aldebarán','aldebaran'],
    ['Pléyades','m45'],
    ['Pleiades','m45'],
    ['m45','m45'],
    ['M1','m1'],
    ['Nebulosa del Cangrejo','m1'],
  ])assert.equal(findTaurusTarget(alias)?.id,id);
  assert.equal(findTaurusTarget('No existe'),undefined);
});
test('chart orientation matches astronomical north up and east left',()=>{
  const center=projectTaurus({ra:70,dec:16});
  assert.ok(projectTaurus({ra:80,dec:16}).x<center.x,'Increasing RA moves left');
  assert.ok(projectTaurus({ra:70,dec:24}).y<center.y,'Increasing Dec moves up');
  assert.deepEqual(projectTaurus({ra:TAURUS_VIEW.raMax,dec:TAURUS_VIEW.decMax}),
    {x:TAURUS_CHART.left,y:TAURUS_CHART.top});
  assert.deepEqual(projectTaurus({ra:TAURUS_VIEW.raMin,dec:TAURUS_VIEW.decMin}),
    {x:TAURUS_CHART.right,y:TAURUS_CHART.bottom});
});
test('click-to-coordinate is invertible across the sky chart',()=>{
  for(const point of [...TAURUS_TARGETS,TAURUS_CENTER,
    {ra:TAURUS_VIEW.raMin,dec:TAURUS_VIEW.decMin},
    {ra:TAURUS_VIEW.raMax,dec:TAURUS_VIEW.decMax}]){
    const screen=projectTaurus(point);
    const returned=unprojectTaurus(screen.x,screen.y);
    assert.ok(Math.abs(returned.ra-point.ra)<1e-7);
    assert.ok(Math.abs(returned.dec-point.dec)<1e-7);
  }
  const clamped=unprojectTaurus(-1000,10000);
  assert.equal(clamped.ra,TAURUS_VIEW.raMax);
  assert.equal(clamped.dec,TAURUS_VIEW.decMin);
});
test('opening Tauro does not trigger an expensive job automatically',()=>{
  const explorer=readFileSync(new URL('../src/pages/ExplorerPage.tsx',import.meta.url),'utf8');
  const start=explorer.indexOf("if(!atlas){");
  assert.ok(start>=0);
  const end=explorer.indexOf("},[active,atlas]);",start);
  assert.ok(end>start);
  const effect=explorer.slice(start,end);
  assert.doesNotMatch(effect,/\bload\s*\(/);
  assert.doesNotMatch(effect,/\bwatchSearch\s*\(/);
  assert.match(explorer,/function searchSelectedRegion\(\)\{/);
});
