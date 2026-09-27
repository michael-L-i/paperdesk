import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { run } from '../server/process.js';
import { parseSourceMap, inverseSearch } from '../server/synctex.js';

test('real SyncTeX maps repeated text, math and included files across pages', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-sync-test-'));
  try {
    await fs.mkdir(path.join(dir,'parts'));
    const source=String.raw`\documentclass{article}
\usepackage{amsmath}
\begin{document}
\section{First}
Repeated paragraph here.

\[
x^2+y^2=z^2
\]
\newpage
\section{Second}
Repeated paragraph here.

\input{parts/answer}
\end{document}`;
    await fs.writeFile(path.join(dir,'main.tex'),source);
    await fs.writeFile(path.join(dir,'parts/answer.tex'),'Included answer here.\n');
    await run('tectonic',['--untrusted','--synctex',path.join(dir,'main.tex')],{cwd:dir});
    const map=parseSourceMap(gunzipSync(await fs.readFile(path.join(dir,'main.synctex.gz'))).toString());
    const {stdout}=await run('pdftotext',['-bbox',path.join(dir,'main.pdf'),'-']);
    const pages=[...stdout.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g)];
    function word(page,text) {
      const match=[...pages[page-1][1].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)].find(m=>m[5]===text);
      assert.ok(match,`Missing PDF word ${text}`);
      return inverseSearch(map.records,page,(+match[1]+ +match[3])/2,(+match[2]+ +match[4])/2);
    }
    assert.equal(word(1,'Repeated').line,5);
    assert.equal(word(2,'Repeated').line,12);
    const included=word(2,'Included');
    assert.match(included.path,/parts\/answer\.tex$/);
    assert.equal(included.line,1);
    const math=map.records.filter(r=>r.page===1 && r.line>=7 && r.line<=9 && r.top>160 && r.top<220);
    assert.ok(math.length);
    const target=math.find(r=>r.right>r.left && r.line===9);
    assert.ok(target);
    const hit=inverseSearch(map.records,1,(target.left+target.right)/2,(target.top+target.bottom)/2);
    assert.ok(hit.line>=7&&hit.line<=9);
    assert.equal(inverseSearch(map.records,99,100,100),null);
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
