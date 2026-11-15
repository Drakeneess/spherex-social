import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

function transpile(path){
  const source=readFileSync(new URL(path,import.meta.url),'utf8');
  return ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,
  }}).outputText;
}
function dataURL(js){return 'data:text/javascript;base64,'+Buffer.from(js).toString('base64');}
const zodiacURL=dataURL(transpile('../src/lib/zodiac.ts'));
const taurusURL=dataURL(transpile('../src/lib/taurus.ts'));
const atlasJS=transpile('../src/lib/zodiacAtlas.ts')
  .replace("from './zodiac'","from '"+zodiacURL+"'")
  .replace("from './taurus'","from '"+taurusURL+"'");
const {
  getZodiacAtlas,ATLAS_CHART,zodiacAtlasBounds,
  projectZodiac,unprojectZodiac,isInZodiacChart,signedRaOffset,
}=await import(dataURL(atlasJS));
const {ZODIAC_CONSTELLATIONS}=await import(zodiacURL);

test('12 different constellation charts are fully populated with catalogued stars',()=>{
  for(const sign of ZODIAC_CONSTELLATIONS){
    const atlas=getZodiacAtlas(sign.id);
    assert.ok(atlas,sign.id);
    assert.equal(atlas.sign.name,sign.name);
    assert.ok(atlas.targets.length>=5,`Too few points for ${sign.name}`);
    assert.ok(atlas.lines.length>=3,`Too few lines for ${sign.name}`);
    const seen=new Set();
    for(const t of atlas.targets){
      assert.ok(!seen.has(t.id),`Duplicate star ${sign.id}:${t.id}`);
      seen.add(t.id);
      assert.ok(Number.isFinite(t.ra)&&t.ra>=0&&t.ra<360);
      assert.ok(Number.isFinite(t.dec)&&t.dec>=-90&&t.dec<=90);
      assert.ok(t.name.length>2);
      assert.ok(isInZodiacChart(atlas,t));
      const p=projectZodiac(atlas,t);
      assert.ok(p.x>=ATLAS_CHART.left&&p.x<=ATLAS_CHART.right);
      assert.ok(p.y>=ATLAS_CHART.top&&p.y<=ATLAS_CHART.bottom);
    }
    for(const [a,b] of atlas.lines){
      assert.ok(seen.has(a),`Unknown line origin ${sign.id}:${a}`);
      assert.ok(seen.has(b),`Unknown line end ${sign.id}:${b}`);
      assert.notEqual(a,b);
    }
    const nearest=Math.min(...atlas.targets.map(t=>
      Math.hypot(signedRaOffset(t.ra,sign.anchor.ra),t.dec-sign.anchor.dec)));
    assert.ok(nearest<1.6,`Unmatched zodiac anchor for ${sign.id}: ${nearest}°`);
  }
  assert.equal(getZodiacAtlas('not-a-sign'),null);
});

test('RA and Dec roundtrip for all signs, including random points',()=>{
  for(const sign of ZODIAC_CONSTELLATIONS){
    const atlas=getZodiacAtlas(sign.id);
    const bounds=zodiacAtlasBounds(atlas);
    for(const position of atlas.targets){
      const screen=projectZodiac(atlas,position);
      const back=unprojectZodiac(atlas,screen.x,screen.y);
      assert.ok(Math.abs(signedRaOffset(back.ra,position.ra))<1e-8,sign.id);
      assert.ok(Math.abs(back.dec-position.dec)<1e-8,sign.id);
    }
    const north=projectZodiac(atlas,{ra:atlas.centerRA,dec:bounds.maxDec});
    const south=projectZodiac(atlas,{ra:atlas.centerRA,dec:bounds.minDec});
    assert.ok(north.y<south.y,sign.id);
    const east=projectZodiac(atlas,{ra:(atlas.centerRA+1)%360,dec:0});
    const west=projectZodiac(atlas,{ra:(atlas.centerRA+359)%360,dec:0});
    assert.ok(east.x<west.x,`RA orientation for ${sign.id}`);
  }
});

test('Pisces displays across the 0-hour meridian without a 360-degree jump',()=>{
  const atlas=getZodiacAtlas('pisces');
  const a=atlas.targets.find(t=>t.id==='yunyu');
  const b=atlas.targets.find(t=>t.id==='alrescha');
  assert.ok(a&&b);
  assert.ok(Math.abs(signedRaOffset(a.ra,b.ra))<43);
  const pa=projectZodiac(atlas,a),pb=projectZodiac(atlas,b);
  assert.ok(pa.x>pb.x,'Higher RA to the left even across midnight');
  assert.ok(Math.abs(pa.x-pb.x)<800);
});

test('representative stars match independently catalogued J2000 positions',()=>{
  for(const [sign,id,ra,dec] of [
    ['gemini','pollux',116.3307,28.0263],
    ['leo','regulus',152.0936,11.9672],
    ['virgo','spica',201.2983,-11.1613],
    ['scorpius','antares',247.35196,-26.4319],
    ['sagittarius','kaus_s',276.043,-34.3835],
    ['capricornus','deneb',326.76,-16.1266],
    ['aquarius','sadalsuud',322.8897,-5.5712],
    ['pisces','alrescha',30.5117,2.7638],
  ]){
    const star=getZodiacAtlas(sign).targets.find(t=>t.id===id);
    assert.ok(star);
    assert.ok(Math.abs(star.ra-ra)<.03,`RA ${sign} ${id}`);
    assert.ok(Math.abs(star.dec-dec)<.03,`Dec ${sign} ${id}`);
  }
});
test('all birthday links open their corresponding map, not a single star',()=>{
  const file=readFileSync(new URL('../src/lib/zodiac.ts',import.meta.url),'utf8');
  assert.doesNotMatch(file,/prefill=1|detailedAtlas/);
  const explorer=readFileSync(new URL('../src/pages/ExplorerPage.tsx',import.meta.url),'utf8');
  assert.match(explorer,/getZodiacAtlas\(constellation\?\?''\)/);
  assert.match(explorer,/ZodiacChart atlas=\{atlas\}/);
  assert.doesNotMatch(explorer,/showTaurus|selectTaurusPosition/);
});
