import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const file=readFileSync(new URL('../src/lib/zodiac.ts',import.meta.url),'utf8');
const js=ts.transpileModule(file,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const {ZODIAC_CONSTELLATIONS,constellationForBirthday,birthdaySkyRoute}=
  await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));

test('all twelve birthdate discoveries exist with unique valid sky positions',()=>{
  assert.equal(ZODIAC_CONSTELLATIONS.length,12);
  assert.equal(new Set(ZODIAC_CONSTELLATIONS.map(s=>s.id)).size,12);
  for(const sign of ZODIAC_CONSTELLATIONS){
    assert.match(sign.id,/^[a-z]+$/);
    assert.ok(sign.symbol.length>0);
    assert.ok(sign.anchor.ra>=0&&sign.anchor.ra<360);
    assert.ok(sign.anchor.dec>=-90&&sign.anchor.dec<=90);
    assert.ok(sign.anchor.name.length>0);
  }
});
test('birth dates map to conventional zodiac signs including boundary dates',()=>{
  for(const [date,name] of [
    ['2003-05-20','Tauro'],['2003-05-21','Géminis'],
    ['2003-06-20','Géminis'],['2003-06-21','Cáncer'],
    ['2003-07-22','Cáncer'],['2003-07-23','Leo'],
    ['2003-08-22','Leo'],['2003-08-23','Virgo'],
    ['2003-09-22','Virgo'],['2003-09-23','Libra'],
    ['2003-10-22','Libra'],['2003-10-23','Escorpio'],
    ['2003-11-21','Escorpio'],['2003-11-22','Sagitario'],
    ['2003-12-21','Sagitario'],['2003-12-22','Capricornio'],
    ['2003-01-19','Capricornio'],['2003-01-20','Acuario'],
    ['2003-02-18','Acuario'],['2003-02-19','Piscis'],
    ['2004-02-29','Piscis'],['2003-03-20','Piscis'],
    ['2003-03-21','Aries'],['2003-04-19','Aries'],
    ['2003-04-20','Tauro'],
  ]){
    assert.equal(constellationForBirthday(date)?.name,name,date);
  }
});
test('invalid or absent dates never trigger a surprise',()=>{
  for(const invalid of [null,undefined,'','2003/05/21','2003-5-21',
    '2003-02-29','1900-02-29','2004-02-30','2001-13-01',
    '1899-12-31','2000-00-12','invalid']){
    assert.equal(constellationForBirthday(invalid),null,String(invalid));
  }
});
test('private surprise routes never contain birthdays or start real IRSA jobs',()=>{
  for(const sign of ZODIAC_CONSTELLATIONS){
    const route=birthdaySkyRoute(sign);
    assert.equal(route.startsWith('explore?'),true);
    assert.doesNotMatch(route,/\d{4}-\d{2}-\d{2}/);
    if(sign.id==='taurus'){
      assert.equal(route,'explore?constellation=taurus');
    }else{
      assert.match(route,/&prefill=1$/);
      assert.ok(route.includes('ra=')&&route.includes('dec='));
    }
  }
});
test('the reveal is owner-only and appears only after the DOB is saved',()=>{
  const component=readFileSync(new URL('../src/components/ProfileEditor.tsx',import.meta.url),'utf8');
  const reveal=readFileSync(new URL('../src/components/BirthdaySkyReveal.tsx',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.match(component,/user\.birth_date&&birthDate===user\.birth_date/);
  assert.match(component,/BirthdaySkyReveal birthDate=\{user\.birth_date\}/);
  assert.match(reveal,/Este detalle solo aparece en tus ajustes/);
  assert.match(app,/constellationForBirthday\(user\?\.birth_date\)\?\.id==='taurus'/);
  const explorer=readFileSync(new URL('../src/pages/ExplorerPage.tsx',import.meta.url),'utf8');
  const marker=explorer.indexOf('if(prefillOnly){');
  assert.ok(marker>0);
  const end=explorer.indexOf('return;',marker);
  assert.ok(end>marker);
  assert.doesNotMatch(explorer.slice(marker,end),/\bload\s*\(/);
});
