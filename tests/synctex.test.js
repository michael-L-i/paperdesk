import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { gunzipSync } from 'node:zlib';
import { run } from '../server/process.js';
import { compileLatex } from '../server/latex.js';
import { parseSourceMap, inverseSearch, refineLine } from '../server/synctex.js';

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
    await fs.mkdir(path.join(dir,'out'));
    await compileLatex(path.join(dir,'main.tex'),source,path.join(dir,'out'));
    const map=parseSourceMap(gunzipSync(await fs.readFile(path.join(dir,'out/main.synctex.gz'))).toString());
    const {stdout}=await run('pdftotext',['-bbox',path.join(dir,'out/main.pdf'),'-']);
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

test('inverse search finds words in macro arguments, table rows and paragraph lines', async () => {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-sync-test-'));
  try {
    const source=String.raw`\documentclass{article}
\newcommand{\answer}[1]{\par\smallskip{#1\par}\medskip}
\begin{document}
\begin{enumerate}
\item
\answer{Alpha opens the answer here,
then bravo continues on another line,
and charlie closes it.}
\end{enumerate}
\begin{tabular}{ll}
Delta & one \\
Echo & two \\
\end{tabular}

Foxtrot starts a paragraph that runs long enough to wrap across several printed lines, so that Golf begins a later line and the first word of each line is checked against the source line of this paragraph rather than the blank line after it.

\end{document}`;
    await fs.writeFile(path.join(dir,'main.tex'),source);
    await fs.mkdir(path.join(dir,'out'));
    await compileLatex(path.join(dir,'main.tex'),source,path.join(dir,'out'));
    const map=parseSourceMap(gunzipSync(await fs.readFile(path.join(dir,'out/main.synctex.gz'))).toString());
    const {stdout}=await run('pdftotext',['-bbox',path.join(dir,'out/main.pdf'),'-']);
    const words=[...stdout.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)];
    function jump(text) {
      const i=words.findIndex(m=>m[5].replace(/,$/,'')===text), m=words[i];
      assert.ok(m,`Missing PDF word ${text}`);
      const match=inverseSearch(map.records,1,(+m[1]+ +m[3])/2,(+m[2]+ +m[4])/2);
      const near=(from,to)=>words.slice(Math.max(0,from),to).map(w=>w[5]).join(' ');
      return {synctex:match.line,line:refineLine(map.records,match,source,{word:m[5],before:near(i-8,i),after:near(i+1,i+9)})};
    }
    // TeX tags the whole argument with its closing line; refinement finds the clicked word.
    assert.equal(jump('bravo').synctex,8);
    assert.equal(jump('Alpha').line,6);
    assert.equal(jump('bravo').line,7);
    assert.equal(jump('charlie').line,8);
    assert.equal(jump('Delta').synctex,11);
    assert.equal(jump('Echo').synctex,12);
    const golf=words.find(m=>m[5]==='Golf');
    const lineStart=words.find(m=>m[2]===golf[2]);
    assert.notEqual(lineStart[5],'Foxtrot');
    assert.equal(jump(lineStart[5]).synctex,15);
    assert.equal(jump('Foxtrot').synctex,15);
    assert.equal(refineLine(map.records,{path:'main.tex',line:15,top:0,bottom:500},source,{word:'Foxtrot'}),15,'Tall records such as included PDFs are not refined');
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
