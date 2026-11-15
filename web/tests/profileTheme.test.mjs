import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/lib/profileTheme.ts',import.meta.url),'utf8');
const transpiled=ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const {
  fallbackAvatarColors, safeHexColor, themeGradient, PROFILE_PRESETS,
}=await import('data:text/javascript;base64,'+Buffer.from(transpiled).toString('base64'));

test('default avatar colors are stable and valid for all usernames',()=>{
  for(const name of ['skywatcher','rémi','drakeneess','a_123']){
    const one=fallbackAvatarColors(name);
    assert.deepEqual(one,fallbackAvatarColors(name));
    assert.match(one.start,/^#[0-9a-f]{6}$/);
    assert.match(one.end,/^#[0-9a-f]{6}$/);
    assert.notEqual(one.start,one.end);
  }
});
test('profile background helper rejects CSS injection and unsafe colors',()=>{
  assert.equal(safeHexColor('#A0B8D9','#ffffff'),'#a0b8d9');
  assert.equal(safeHexColor('url(javascript:alert(1))','#112233'),'#112233');
  assert.equal(safeHexColor('#gg0012','#112233'),'#112233');
  assert.equal(themeGradient({start:'#336699',end:'#ee7788'}),
    'linear-gradient(135deg, #336699, #ee7788)');
  assert.equal(PROFILE_PRESETS.length>=3,true);
});
test('profile editor keeps the initials centered as a grid',()=>{
  const css=readFileSync(new URL('../src/astrogram.css',import.meta.url),'utf8');
  assert.match(css,/\.profile-editor-avatar>\.avatar\s*\{\s*display:grid;place-items:center;line-height:1;/);
});
