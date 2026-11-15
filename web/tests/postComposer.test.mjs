import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source=readFileSync(new URL('../src/lib/postComposer.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext},
}).outputText;
const {extractPostHashtags,validHashtag}=await import(
  'data:text/javascript;base64,'+Buffer.from(compiled).toString('base64')
);

test('hashtag pills are deduplicated and support Spanish accents',()=>{
  assert.deepEqual(
    extractPostHashtags('Cielo #Astronomía #SPHEREx #astronomía #CieloNocturno'),
    ['astronomía','spherex','cielonocturno'],
  );
  assert.deepEqual(extractPostHashtags('No hay etiquetas'),[]);
});
test('tag input supports one searchable label only',()=>{
  assert.equal(validHashtag(' #astro_2026 '),'astro_2026');
  assert.equal(validHashtag('galaxias'),'galaxias');
  assert.equal(validHashtag('#a'),null);
  assert.equal(validHashtag('two tags'),null);
  assert.equal(validHashtag('hola.html'),null);
  assert.equal(validHashtag(''),null);
});
test('URLs and plain text are never treated as hashtags',()=>{
  assert.deepEqual(extractPostHashtags('https://site.test/thing#fragment'),[]);
  assert.deepEqual(extractPostHashtags('a#right #visible'),['visible']);
});
