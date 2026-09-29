import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { run } from '../server/process.js';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-browser-'));
const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});}),url=`http://127.0.0.1:${port}`;
const latex=String.raw`\documentclass{article}\begin{document}Solve $2x+3=11$.\end{document}`;
await fs.mkdir(path.join(root,'Course'));
await fs.mkdir(path.join(root,'Import'));
const longLatex=String.raw`\documentclass{article}
\begin{document}
\section{First}
Solve $2x+3=11$.

\newpage
\section{Second}
Second target paragraph.

Alpha first selectable line.\\
Bravo middle selectable line.\\
Charlie last selectable line.

\newpage
\section{Third}
Third target paragraph.

\input{parts/answer}
\end{document}`+'\n'+Array.from({length:150},(_,i)=>'% line '+i).join('\n');
await fs.mkdir(path.join(root,'Course/parts'));
await fs.writeFile(path.join(root,'Course/parts/answer.tex'),'Included answer paragraph.\n');
await fs.writeFile(path.join(root,'Course/main.tex'),longLatex);
await fs.writeFile(path.join(root,'Course/other.tex'),latex.replace('Solve','Find x in'));
await fs.writeFile(path.join(root,'Import/exam.tex'),latex);
await run('pdflatex',['-interaction=nonstopmode','exam.tex'],{cwd:path.join(root,'Import')});
for(const ext of ['tex','aux','log'])await fs.unlink(path.join(root,'Import/exam.'+ext));
const originalPDF=await fs.readFile(path.join(root,'Import/exam.pdf'));
// Deterministic model fixture; PDF extraction/rendering, API jobs, application, and compilation remain real.
const fake=path.join(root,'fake-codex.mjs');
await fs.writeFile(fake,`#!${process.execPath}\nimport fs from 'node:fs/promises';\nlet input='';for await(const chunk of process.stdin)input+=chunk;\nconst result={message:'Converted exam.pdf.',latex:${JSON.stringify(latex)},style:'',filename:'exam_solutions.tex'};\nawait fs.writeFile(${JSON.stringify(path.join(root,'codex-call.json'))},JSON.stringify({args:process.argv.slice(2),prompt:input}));\nawait fs.writeFile(process.argv[process.argv.indexOf('-o')+1],JSON.stringify(result));\n`);
await fs.chmod(fake,0o755);
const server=spawn(process.execPath,['server/index.js'],{cwd:app,env:{...process.env,NODE_ENV:'production',WORKSPACE_ROOT:root,PAPERDESK_DATA_DIR:path.join(root,'.app-data'),PORT:String(port),CODEX_BIN:fake},stdio:'pipe'});
let browser,page;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url+'/api/directory')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let chosenDirectory='Course';
  await page.route('**/api/choose-directory',route=>route.fulfill({json:chosenDirectory === null ? {cancelled:true} : {path:chosenDirectory}}));
  await page.goto(url);
  await page.getByRole('button',{name:'Choose directory',exact:true}).click();
  await page.locator('canvas[data-rendered=true]').first().waitFor({timeout:180000});
  assert.equal(await page.locator('iframe').count(),0);
  assert.equal(await page.getByLabel('Download PDF').count(),1);
  assert.equal(await page.locator('.right .panel-title>span').first().textContent(),'PDF · pdfLaTeX');
  assert.equal(await page.getByLabel('Primary TeX file').inputValue(),'Course/main.tex');

  // Select only part of the active source line: its background must not hide the highlight.
  const sourceLine=page.locator('.cm-line').filter({hasText:'Second target paragraph.'});
  const sourceBounds=await sourceLine.evaluate(el=>{
    const range=document.createRange();range.selectNodeContents(el);
    const box=range.getBoundingClientRect();return {x:box.x,y:box.y,height:box.height};
  });
  await page.mouse.move(sourceBounds.x+2,sourceBounds.y+sourceBounds.height/2);
  await page.mouse.down();
  await page.mouse.move(sourceBounds.x+95,sourceBounds.y+sourceBounds.height/2,{steps:12});
  await page.mouse.up();
  const sourceSelection=await page.evaluate(()=>window.getSelection().toString());
  assert.ok(sourceSelection.length>3 && !sourceSelection.includes('\n') && sourceSelection.length<'Second target paragraph.'.length);
  await page.waitForFunction(()=>[...document.querySelectorAll('.cm-selectionBackground')].some(el=>el.getBoundingClientRect().width>50));
  const selectionPaint=await page.evaluate(()=>({
    highlight:getComputedStyle(document.querySelector('.cm-selectionBackground')).backgroundColor,
    activeLine:getComputedStyle(document.querySelector('.cm-activeLine')).backgroundColor,
  }));
  assert.equal(selectionPaint.highlight,'rgb(181, 213, 255)');
  assert.match(selectionPaint.activeLine,/rgba\(.+, 0\.04\)/,'Active line must allow the selection underneath to show');
  await page.screenshot({path:'/tmp/paperdesk-inline-selection.png'});

  const bbox=(await run('pdftotext',['-bbox',path.join(root,'Course/main.pdf'),'-'])).stdout;
  async function clickPDFWord(pageNumber,word){
    const pageXML=[...bbox.matchAll(/<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g)][pageNumber-1];
    const match=[...pageXML[3].matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]+)<\/word>/g)].find(m=>m[5]===word);
    assert.ok(match);
    const canvas=page.getByRole('img',{name:`PDF page ${pageNumber}`,exact:true});
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForFunction(n=>document.querySelectorAll('.pdf-page canvas')[n-1]?.dataset.rendered==='true',pageNumber);
    const box=await canvas.boundingBox();
    await page.locator('.pdf-page').nth(pageNumber-1).locator('.pdf-text-layer[data-rendered=true]').waitFor();
    const response=page.waitForResponse(r=>r.url().includes('/api/inverse-search'));
    await page.locator('.pdf-page').nth(pageNumber-1).dblclick({position:{x:(+match[1]+ +match[3])/2/+pageXML[1]*box.width,y:(+match[2]+ +match[4])/2/+pageXML[2]*box.height}});
    const result=await response;
    assert.equal(result.status(),200,await result.text());
    await page.waitForFunction(()=>document.activeElement?.classList.contains('cm-content'));
    return result.json();
  }
  let inverseRequests=0;
  page.on('request',r=>{if(r.url().includes('/api/inverse-search'))inverseRequests++;});
  const selectable=page.locator('.pdf-page').nth(1).locator('.pdf-text-layer span').filter({hasText:'Second target paragraph.'});
  await selectable.scrollIntoViewIfNeeded();
  await selectable.click();
  assert.equal(inverseRequests,0,'Single clicks must not jump to source');
  const selectionBounds=await selectable.boundingBox();
  await page.mouse.move(selectionBounds.x+1,selectionBounds.y+selectionBounds.height/2);
  await page.mouse.down();
  await page.mouse.move(selectionBounds.x+selectionBounds.width-1,selectionBounds.y+selectionBounds.height/2,{steps:12});
  await page.mouse.up();
  const selectedPDFText=await page.evaluate(()=>window.getSelection().toString());
  assert.match(selectedPDFText,/Second target paragraph/);
  assert.equal(inverseRequests,0,'Dragging must not jump to source');
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);
  const previousClipboard=await page.evaluate(()=>navigator.clipboard.readText());
  try {
    await page.keyboard.press('Meta+c');
    assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),selectedPDFText);
  } finally {await page.evaluate(text=>navigator.clipboard.writeText(text),previousClipboard);}
  const middle=page.locator('.pdf-page').nth(1).locator('.pdf-text-layer span').filter({hasText:'Bravo middle selectable line.'});
  const middleBox=await middle.boundingBox();
  async function dragSelection(start,end){
    await page.evaluate(()=>window.getSelection().removeAllRanges());
    await page.waitForFunction(()=>!document.querySelector('.pdf-text-layer.selecting'));
    await page.mouse.move(start.x,start.y);await page.mouse.down();
    await page.mouse.move(end.x,end.y,{steps:20});
    await page.mouse.up();
    return page.evaluate(()=>window.getSelection().toString());
  }
  const middleY=middleBox.y+middleBox.height/2;
  const intoWhitespace=await dragSelection({x:middleBox.x+1,y:middleY},{x:middleBox.x+middleBox.width+60,y:middleY});
  assert.match(intoWhitespace,/Bravo middle selectable line/);
  assert.ok(!/Alpha|Charlie|Second|Third/.test(intoWhitespace),'Dragging beyond a line must not grab the page');
  const backwards=await dragSelection({x:middleBox.x+middleBox.width-5,y:middleY},{x:middleBox.x+5,y:middleY});
  assert.match(backwards,/ravo middle selectable lin/);
  assert.ok(!/Alpha|Charlie|Second|Third/.test(backwards),'Backward drag stays on the intended line');
  const last=page.locator('.pdf-page').nth(1).locator('.pdf-text-layer span').filter({hasText:'Charlie last selectable line.'});
  const lastBox=await last.boundingBox();
  const twoLines=await dragSelection({x:middleBox.x+1,y:middleY},{x:lastBox.x+lastBox.width-1,y:lastBox.y+lastBox.height/2});
  assert.match(twoLines,/Bravo middle selectable line/);assert.match(twoLines,/Charlie last selectable line/);
  assert.ok(!/Alpha|Second|Third/.test(twoLines),'Multiline selection excludes surrounding text');
  assert.equal(inverseRequests,0,'Selection gestures must not trigger inverse search');
  const firstJump=await clickPDFWord(2,'Second');
  assert.equal(inverseRequests,1,'Double-click jumps once');
  assert.equal(firstJump.path,'Course/main.tex');
  assert.ok(firstJump.line===7||firstJump.line===8);
  // Selected text must be the actual source line in CodeMirror, not just an API result.
  await page.waitForFunction(()=>window.getSelection()?.toString().includes('Second'));
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),longLatex.split('\n')[firstJump.line-1]);
  const includedJump=await clickPDFWord(3,'Included');
  assert.equal(includedJump.path,'Course/parts/answer.tex');
  await page.waitForFunction(()=>document.querySelector('.left .panel-title')?.textContent==='answer.tex');
  assert.equal(await page.getByLabel('Primary TeX file').inputValue(),'Course/main.tex','Included-file navigation retains the primary compile target');
  await page.waitForFunction(()=>window.getSelection()?.toString()==='Included answer paragraph.');
  const includedBefore=await fs.readFile(path.join(root,'Course/parts/answer.tex'),'utf8');
  const editedAt=Date.now();
  const autoBuild=page.waitForRequest(r=>r.url().endsWith('/api/compile'));
  await page.keyboard.insertText('Updated included answer.');
  await page.getByText('Saved',{exact:true}).waitFor();
  assert.equal(await fs.readFile(path.join(root,'Course/parts/answer.tex'),'utf8'),'Updated included answer.\n');
  await autoBuild;
  assert.ok(Date.now()-editedAt>=1500,'Auto-compile waits for a typing pause');
  await page.waitForFunction(()=>document.querySelector('.right .status')?.textContent==='');
  assert.equal(await page.locator('.pdf-pages').getAttribute('data-url').then(u=>u.includes('main.pdf')),true);
  // Undo the edit so the later provenance check still has one human example.
  await page.keyboard.press('Meta+z');
  await page.getByText('Saved',{exact:true}).waitFor();
  assert.equal(await fs.readFile(path.join(root,'Course/parts/answer.tex'),'utf8'),includedBefore);
  await fetch(url+'/api/style/examples',{method:'DELETE'});

  await page.getByLabel('Primary TeX file').selectOption('Course/other.tex');
  await page.getByLabel('Primary TeX file').selectOption('Course/main.tex');
  await page.locator('canvas[data-rendered=true]').first().waitFor();
  // Return to the first PDF page for independent scrolling checks below.
  await page.locator('.pdf-pages').evaluate(el=>{el.scrollTop=0;});
  let taskRequests=0;
  page.on('request',r=>{if(r.url().endsWith('/api/task'))taskRequests++;});
  await page.getByLabel('Agent request').fill('Keep this draft.');
  await page.getByLabel('Agent request').press('Shift+Enter');
  await page.getByLabel('Agent request').press('Meta+Enter');
  assert.equal(await page.getByLabel('Agent request').inputValue(),'Keep this draft.\n\n','Shift/⌘ Enter add lines');
  await page.getByLabel('Agent request').fill('Keep this draft.');
  assert.equal(taskRequests,0,'Adding lines does not send');
  await page.getByRole('button',{name:'Expand chat history'}).click();
  const resize=page.getByRole('separator',{name:'Resize chat history'});
  await resize.focus();await page.keyboard.press('ArrowUp');
  assert.equal(await resize.getAttribute('aria-valuenow'),'200');
  await page.getByRole('button',{name:'Collapse chat history'}).click();
  assert.equal(await page.getByLabel('Agent request').inputValue(),'Keep this draft.');
  assert.equal(await page.getByLabel('Agent request').isVisible(),true);
  await page.getByLabel('Agent request').fill('');
  // Wheel input is contained by the pane under the pointer, including at boundaries.
  const positions=()=>page.evaluate(()=>({editor:document.querySelector('.cm-scroller').scrollTop,pdf:document.querySelector('.pdf-pages').scrollTop,page:document.scrollingElement.scrollTop}));
  const editorPane=page.locator('.cm-scroller');
  await editorPane.hover();await page.mouse.wheel(0,500);
  await page.waitForFunction(()=>document.querySelector('.cm-scroller').scrollTop>0);
  const leftScrolled=await positions();assert.equal(leftScrolled.pdf,0);assert.equal(leftScrolled.page,0);
  await page.locator('.pdf-pages').hover();await page.mouse.wheel(0,600);
  await page.waitForFunction(()=>document.querySelector('.pdf-pages').scrollTop>0);
  const rightScrolled=await positions();assert.equal(rightScrolled.editor,leftScrolled.editor);assert.equal(rightScrolled.page,0);
  await page.evaluate(()=>{const el=document.querySelector('.cm-scroller');el.scrollTop=el.scrollHeight;});
  await editorPane.hover();await page.mouse.wheel(0,500);
  await page.waitForTimeout(200);
  assert.equal((await positions()).pdf,rightScrolled.pdf);assert.equal((await positions()).page,0);
  assert.equal(await page.evaluate(()=>document.scrollingElement.scrollHeight<=window.innerHeight),true);
  await page.getByRole('button',{name:'Expand chat history'}).click();
  const handle=await page.getByRole('separator',{name:'Resize chat history'}).boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(handle.x+handle.width/2,handle.y-75,{steps:5});await page.mouse.up();
  assert.ok(Number(await page.getByRole('separator',{name:'Resize chat history'}).getAttribute('aria-valuenow'))>250);
  const inputBox=await page.getByLabel('Agent request').boundingBox();assert.ok(inputBox.y+inputBox.height<960);
  await page.getByRole('button',{name:'Collapse chat history'}).click();


  // Manual mode still saves, but does not compile until requested.
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('menuitemcheckbox',{name:'Auto-compile: on'}).click();
  await page.waitForFunction(()=>!document.querySelector('.pdf-pending'));
  let compileRequests=0;
  page.on('request',r=>{if(r.url().endsWith('/api/compile'))compileRequests++;});
  const editor=page.locator('.cm-content');
  await editor.click();await page.keyboard.press('Meta+End');await page.keyboard.insertText('\n% My phrasing: first isolate the variable, then simplify.');
  await page.getByText('Saved',{exact:true}).waitFor();
  assert.match(await fs.readFile(path.join(root,'Course/main.tex'),'utf8'),/My phrasing/);
  assert.equal((await(await fetch(url+'/api/style')).json()).examples,1);
  await page.waitForTimeout(2000);
  assert.equal(compileRequests,0,'Manual mode saves without compiling');
  const beforeRefresh=await page.locator('.pdf-pages').evaluate(el=>({url:el.dataset.url,top:el.scrollTop,pixels:el.querySelector('canvas').toDataURL()}));
  assert.ok(beforeRefresh.top>0);
  let releasePDF;
  const pdfGate=new Promise(resolve=>{releasePDF=resolve;});
  await page.route('**/api/pdf?**',async route=>{await pdfGate;await route.continue();});
  await page.getByRole('button',{name:'Compile',exact:true}).click();
  await page.waitForFunction(old=>document.querySelector('.pdf-pages').dataset.requestedUrl!==old,beforeRefresh.url);
  const whileLoading=await page.locator('.pdf-pages').evaluate(el=>({url:el.dataset.url,top:el.scrollTop,pixels:el.querySelector('canvas').toDataURL()}));
  assert.deepEqual(whileLoading,beforeRefresh,'Keep the old PDF and scroll offset while its replacement loads');
  assert.equal(await page.locator('.preview .empty').count(),0,'No loading flash during a refresh');
  assert.equal(await page.locator('.spin').count(),0,'Compilation has no spinning animation');
  releasePDF();
  await page.waitForFunction(old=>document.querySelector('.pdf-pages').dataset.url!==old,beforeRefresh.url);
  assert.equal(await page.locator('.pdf-pages').evaluate(el=>el.scrollTop),beforeRefresh.top,'Swap preserves scroll offset');
  assert.equal(await page.locator('.pdf-pending').count(),0);
  await page.unroute('**/api/pdf?**');
  assert.equal(compileRequests,1);
  await page.reload();
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('menuitemcheckbox',{name:'Auto-compile: off'}).waitFor();
  await page.getByRole('menuitemcheckbox',{name:'Auto-compile: off'}).click();
  await page.getByLabel('Primary TeX file').selectOption('Course/other.tex');
  await page.waitForFunction(()=>document.querySelector('.pdf-pages')?.dataset.url.includes('other.pdf'));
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('button',{name:'Writing style',exact:true}).click();
  await page.getByLabel('Writing profile').fill('Use short sentences.');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.screenshot({path:'/tmp/paperdesk-simple.png',fullPage:true});
  chosenDirectory=null;
  await page.getByRole('button',{name:'Course',exact:true}).click();
  await page.getByRole('button',{name:'Course',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Primary TeX file').inputValue(),'Course/other.tex');
  chosenDirectory='Import';
  await page.getByRole('button',{name:'Course',exact:true}).click();
  await page.getByText('Select a .tex file or ask the agent to create one.').waitFor();
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Attach files'}).click();
  await (await chooser).setFiles(path.join(root,'Import/exam.pdf'));
  await page.getByRole('button',{name:'Remove exam.pdf'}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.attachment.uploading'));
  await page.getByLabel('Agent request').fill('Convert this PDF to LaTeX.');
  await page.getByLabel('Agent request').press('Enter');
  await page.getByRole('button',{name:'Remove exam.pdf'}).waitFor({state:'detached'});
  await page.locator('.message.user').filter({hasText:'Convert this PDF to LaTeX.'}).filter({hasText:'exam.pdf'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Primary TeX file"]')?.value==='Import/exam_solutions.tex',{},{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('.pdf-pages')?.dataset.url.includes('exam_solutions.pdf'),{},{timeout:180000});
  assert.deepEqual(await fs.readFile(path.join(root,'Import/exam.pdf')),originalPDF);
  await page.locator('.message:not(.user)').filter({hasText:'Converted exam.pdf.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Collapse chat history'}).count(),1,'Sending opens the thread');
  const codexCall=JSON.parse(await fs.readFile(path.join(root,'codex-call.json'),'utf8'));
  assert.ok(codexCall.args.includes('-i'),'Attached PDF pages are sent as images');
  assert.match(codexCall.prompt,/--- exam\.pdf ---\n[\s\S]*Solve/,'Attached PDF text is in the prompt');
  assert.deepEqual(await fs.readdir(path.join(root,'.app-data/uploads')),[],'Uploads are removed after the request');
  assert.match(await fs.readFile(path.join(root,'Import/exam_solutions.tex'),'utf8'),/Solve/);
  assert.equal((await(await fetch(url+'/api/style')).json()).examples,1,'AI output excluded from human style');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('select[aria-label="Primary TeX file"]')?.value==='Import/exam_solutions.tex');
  const req=async(endpoint,body,method='POST')=>{const r=await fetch(url+'/api'+endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
  const doc=await(await fetch(url+'/api/document?path=Import/exam_solutions.tex')).json();
  const goodPDF=await fs.readFile(path.join(root,'Import/exam_solutions.pdf'));
  const broken=await req('/document',{path:doc.path,revision:doc.revision,text:'\\documentclass{article}\\begin{document}\\badcommand\\end{document}'},'PUT');
  const failed=await req('/compile',{path:doc.path,revision:broken.data.revision});
  assert.equal(failed.status,500);
  assert.match(failed.data.error,/^exam_solutions\.tex:1: Undefined control sequence/);
  assert.deepEqual(await fs.readFile(path.join(root,'Import/exam_solutions.pdf')),goodPDF);
  assert.equal((await req('/document',{path:doc.path,revision:doc.revision,text:'lost'},'PUT')).status,409);
  assert.equal((await req('/inverse-search',{path:doc.path,revision:doc.revision,page:1,x:140,y:135})).status,409,'Stale source mappings are rejected');
  assert.equal((await req('/inverse-search',{path:doc.path,revision:doc.revision,page:0,x:0,y:0})).status,400);
  assert.equal((await fetch(url+'/api/directory?path=..')).status,403);
  assert.equal((await fetch(url+'/api/uploads?name=blob.bin',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:new Uint8Array([1,0,2])})).status,415);
  assert.equal((await req('/task',{directory:'Import',instruction:'Summarize.',attachments:['missing']})).status,410);
  assert.equal((await fetch(url+'/api/new-document',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({directory:'Import',name:'bad.tex'})})).status,403);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/paperdesk-simple-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Passed: quiet background PDF swaps, preserved scroll, auto-compile debounce, persistent manual mode, PDF selection/copy and inverse search (double-click, source selection, included sources, stale-map rejection), directory selection, primary file switching, autosave, style memory, file attachments and PDF-only directory conversion, automatic result loading/compilation, original PDF preservation, reload persistence, failed-build recovery, stale-write and origin protection.');
}catch(e){await page?.screenshot({path:'/tmp/paperdesk-failure.png',timeout:5000}).catch(()=>{});throw e;}
finally{await browser?.close();server.kill('SIGTERM');await fs.rm(root,{recursive:true,force:true});}
