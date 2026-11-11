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
const longLatex=String.raw`\documentclass{article}\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\begin{document}
\section{First}\label{sec:first}
Solve $2x+3=11$. See Section~\ref{sec:third}, \hyperlink{detail}{details}, and~\cite{sample}. Visit \href{https://example.com/}{Example}.

\newpage
\section{Second}
Second target paragraph.

Alpha first selectable line.\\
Bravo middle selectable line.\\
Charlie last selectable line.\par Back to Section~\ref{sec:first}.

\newpage
\section{Third}\label{sec:third}
Third target paragraph.

\input{parts/answer}
\par\vspace{2cm}\noindent
\hypertarget{detail}{Detailed destination.}
\newpage
\begin{thebibliography}{1}
\bibitem{sample} A sample reference.
\end{thebibliography}
\end{document}`+'\n'+Array.from({length:150},(_,i)=>'% line '+i).join('\n');
await fs.mkdir(path.join(root,'Course/parts'));
await fs.writeFile(path.join(root,'Course/parts/answer.tex'),'Included answer paragraph.\n');
await fs.writeFile(path.join(root,'Course/main.tex'),longLatex);
await fs.writeFile(path.join(root,'Course/other.tex'),latex.replace('Solve','Find x in'));
await fs.writeFile(path.join(root,'Import/exam.tex'),latex);
await run('pdflatex',['-interaction=nonstopmode','exam.tex'],{cwd:path.join(root,'Import')});
for(const ext of ['tex','aux','log'])await fs.unlink(path.join(root,'Import/exam.'+ext));
const originalPDF=await fs.readFile(path.join(root,'Import/exam.pdf'));
const pixelBase64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', pixel=Buffer.from(pixelBase64,'base64');
await fs.writeFile(path.join(root,'board.png'),pixel);
// Deterministic model fixture; PDF extraction/rendering, API jobs, application, and compilation remain real.
const fake=path.join(root,'fake-codex.mjs');
const matrixReply=String.raw`$$M\begin{bmatrix}
y_1\\y_2\\y_3\\y_4\end{bmatrix}=\begin{bmatrix}0\\-0.5\\5\\-0.5\end{bmatrix}.$$

Both coordinates start at $0$ and end at $5$.`;
await fs.writeFile(fake,`#!${process.execPath}\nimport fs from 'node:fs/promises';\nlet input='';for await(const chunk of process.stdin)input+=chunk;\nconsole.log(JSON.stringify({type:'item.started',item:{type:'command_execution',command:'/bin/zsh -lc "pdftotext -layout exam.pdf -"'}}));\nawait new Promise(r=>setTimeout(r,input.endsWith('Take your time.')?120000:2500));\nconst result={message:${JSON.stringify('Converted **exam.pdf**: solve $2x+3=11$.\n\n'+matrixReply)},style:'',edits:[{path:'exam_solutions.tex',content:${JSON.stringify(latex)}},{path:'notes/summary.txt',content:'Solve for x.'}]};\nawait fs.writeFile(${JSON.stringify(path.join(root,'codex-call.json'))},JSON.stringify({args:process.argv.slice(2),prompt:input}));\nawait fs.writeFile(process.argv[process.argv.indexOf('-o')+1],JSON.stringify(result));\n`);
await fs.chmod(fake,0o755);
const server=spawn(process.execPath,['server/index.js'],{cwd:app,env:{...process.env,NODE_ENV:'production',PAPERDESK_LIBRARY:path.join(root,'library'),PAPERDESK_DATA_DIR:path.join(root,'.app-data'),PORT:String(port),CODEX_BIN:fake},stdio:'pipe'});
let browser,page;
try {
  for(let i=0;i<60;i++){try{if((await fetch(url+'/api/projects')).ok)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'});
  page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let chosenDirectory='Course';
  await page.route('**/api/choose-directory',route=>route.fulfill({json:chosenDirectory === null ? {cancelled:true} : {path:path.join(root,chosenDirectory)}}));
  const mainFile=()=>page.locator('.tree-row.main').getAttribute('data-path');
  const openFolder=async()=>{await page.getByRole('button',{name:'New project'}).click();await page.getByRole('button',{name:'Open folder…'}).click();};
  await page.goto(url);
  await page.getByText('No projects yet.',{exact:false}).waitFor();
  await openFolder();
  await page.locator('canvas[data-rendered=true]').first().waitFor({timeout:180000});
  assert.equal(await page.locator('iframe').count(),0);
  assert.equal(await page.getByLabel('Download PDF').count(),1);
  assert.equal(await page.locator('.right .panel-title>span').first().textContent(),'PDF · pdfLaTeX');
  assert.equal(await mainFile(),'main.tex');

  // Real hyperref annotations jump to their exact target, including an unpainted page.
  const initialURL=page.url();
  const reference=page.getByRole('link',{name:'Go to reference 3',exact:true});
  await reference.waitFor();
  const editorBeforeLink=await page.locator('.cm-scroller').evaluate(el=>el.scrollTop);
  assert.equal(await page.locator('.pdf-page').nth(2).locator('canvas').getAttribute('data-rendered'),null);
  await reference.click();
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-page canvas')[2]?.dataset.rendered==='true');
  const thirdTop=await page.locator('.pdf-pages').evaluate(el=>el.scrollTop);
  assert.ok(thirdTop>1000,'Cross-reference scrolls down to page three');
  const thirdHeading=await page.locator('.pdf-page').nth(2).locator('.pdf-text-layer span').filter({hasText:/^Third$/}).boundingBox();
  const previewTop=(await page.locator('.pdf-pages').boundingBox()).y;
  assert.ok(thirdHeading.y>=previewTop && thirdHeading.y<previewTop+60,'Destination appears near the top of the pane');
  assert.equal(page.url(),initialURL,'Internal PDF links do not navigate the application');
  assert.equal(await page.locator('.cm-scroller').evaluate(el=>el.scrollTop),editorBeforeLink);
  await page.locator('.pdf-pages').evaluate(el=>{el.scrollTop=0;});
  await page.getByRole('link',{name:'Go to reference details',exact:true}).click();
  await page.waitForFunction(top=>document.querySelector('.pdf-pages').scrollTop>top+50,thirdTop);
  const detailTop=await page.locator('.pdf-pages').evaluate(el=>el.scrollTop);
  assert.ok(detailTop>thirdTop+50,'Targets within a page honor their vertical coordinate');
  // Keyboard activation and links going backward work too.
  await page.locator('.pdf-page').nth(1).getByRole('link',{name:'Go to reference 1',exact:true}).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.pdf-pages').scrollTop<250);
  await page.locator('.pdf-page').first().getByRole('link',{name:'Go to reference 1',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.pdf-page canvas')[3]?.dataset.rendered==='true');
  await page.waitForFunction(top=>document.querySelector('.pdf-pages').scrollTop>top,detailTop);
  assert.ok(await page.locator('.pdf-pages').evaluate(el=>el.scrollTop)>detailTop,'Citations jump to the bibliography');
  await page.locator('.pdf-pages').evaluate(el=>{el.scrollTop=0;});
  const external=page.getByRole('link',{name:'https://example.com/',exact:true});
  assert.equal(await external.getAttribute('target'),'_blank');
  assert.equal(await external.getAttribute('rel'),'noopener noreferrer');
  await page.context().route('https://example.com/',route=>route.fulfill({body:'External link destination'}));
  const popupPromise=page.waitForEvent('popup');await external.click();
  const popup=await popupPromise;await popup.waitForLoadState();assert.equal(popup.url(),'https://example.com/');await popup.close();

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
    const response=page.waitForResponse(r=>r.url().endsWith('/inverse-search'));
    await page.locator('.pdf-page').nth(pageNumber-1).dblclick({position:{x:(+match[1]+ +match[3])/2/+pageXML[1]*box.width,y:(+match[2]+ +match[4])/2/+pageXML[2]*box.height}});
    const result=await response;
    assert.equal(result.status(),200,await result.text());
    await page.waitForFunction(()=>document.activeElement?.classList.contains('cm-content'));
    return result.json();
  }
  let inverseRequests=0;
  page.on('request',r=>{if(r.url().endsWith('/inverse-search'))inverseRequests++;});
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
  assert.equal(firstJump.path,'main.tex');
  assert.ok(firstJump.line===7||firstJump.line===8);
  // Selected text must be the actual source line in CodeMirror, not just an API result.
  await page.waitForFunction(()=>window.getSelection()?.toString().includes('Second'));
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),longLatex.split('\n')[firstJump.line-1]);
  const includedJump=await clickPDFWord(3,'Included');
  assert.equal(includedJump.path,'parts/answer.tex');
  await page.waitForFunction(()=>document.querySelector('.left .panel-title')?.textContent==='parts/answer.tex');
  assert.equal(await mainFile(),'main.tex','Included-file navigation retains the main document');
  await page.waitForFunction(()=>window.getSelection()?.toString()==='Included answer paragraph.');
  const includedBefore=await fs.readFile(path.join(root,'Course/parts/answer.tex'),'utf8');
  const editedAt=Date.now();
  const autoBuild=page.waitForRequest(r=>r.url().endsWith('/compile'));
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
  // New files: a .bib or a subfolder chapter opens without changing the main document.
  const newFile=async name=>{
    await page.getByRole('button',{name:'New file',exact:true}).click();
    await page.getByLabel('Filename').fill(name);await page.getByRole('button',{name:'Create',exact:true}).click();
    await page.waitForFunction(n=>document.querySelector('.left .panel-title')?.textContent===n,name);
  };
  await newFile('refs.bib');
  await page.keyboard.insertText('@misc{knuth, title={The TeXbook}}');
  await page.getByText('Saved',{exact:true}).waitFor();
  await newFile('parts/extra.tex');
  assert.equal(await fs.readFile(path.join(root,'Course/parts/extra.tex'),'utf8'),'');
  assert.equal(await mainFile(),'main.tex');
  assert.equal((await(await fetch(url+'/api/style')).json()).examples,0,'Only .tex edits become style examples');
  const upload=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Upload files'}).click();
  await (await upload).setFiles(path.join(root,'Import/exam.pdf'));
  await page.locator('.tree-row[data-path="exam.pdf"]').waitFor();
  assert.deepEqual(await fs.readFile(path.join(root,'Course/exam.pdf')),originalPDF);
  // Images open in a file pane with download, rename, and delete; the close button returns to the editor.
  await fs.writeFile(path.join(root,'Course/plot.png'),pixel);
  await page.getByRole('button',{name:'More',exact:true}).click();await page.getByRole('button',{name:'Refresh files'}).click();
  await page.getByRole('button',{name:'plot.png',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.file-pane img')?.naturalWidth===1);
  assert.equal(await page.locator('.left .panel-title').textContent(),'plot.png');
  assert.equal(await page.getByLabel('Download file').getAttribute('download'),'plot.png');
  await page.getByRole('button',{name:'Rename file'}).click();
  await page.getByLabel('New name').fill('figures/plot.png');
  await page.getByRole('button',{name:'Rename',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.left .panel-title')?.textContent==='figures/plot.png');
  assert.ok((await fs.stat(path.join(root,'Course/figures/plot.png'))).isFile());
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Delete file'}).click();
  await page.locator('.tree-row[data-path="figures/plot.png"]').waitFor({state:'detached'});
  await assert.rejects(fs.stat(path.join(root,'Course/figures/plot.png')));
  await page.getByRole('button',{name:'exam.pdf',exact:true}).click();
  await page.locator('.file-pane canvas[data-rendered=true]').first().waitFor();
  await page.getByRole('button',{name:'Close file'}).click();
  assert.equal(await page.locator('.file-pane').count(),0);
  assert.equal(await page.locator('.left .panel-title').textContent(),'parts/extra.tex');
  // Opening another document switches the PDF; the star switches it back.
  await page.getByRole('button',{name:'other.tex',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.tree-row.main')?.dataset.path==='other.tex');
  await page.getByRole('button',{name:'Set main.tex as main document'}).click();
  assert.equal(await mainFile(),'main.tex');

  await page.getByRole('button',{name:'other.tex',exact:true}).click();
  await page.getByRole('button',{name:'main.tex',exact:true}).click();
  await page.locator('canvas[data-rendered=true]').first().waitFor();
  // Return to the first PDF page for independent scrolling checks below.
  await page.locator('.pdf-pages').evaluate(el=>{el.scrollTop=0;});
  let taskRequests=0;
  page.on('request',r=>{if(r.url().endsWith('/task'))taskRequests++;});
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
  // Native trackpad pinch zoom pans the whole workspace horizontally from either pane.
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:2});
  const beforePan=await positions();
  await page.mouse.move(600,200);await page.mouse.wheel(900,0);
  await page.waitForFunction(()=>visualViewport.offsetLeft>300);
  const firstPan=await page.evaluate(()=>visualViewport.offsetLeft);
  await page.mouse.move(1100,200);await page.mouse.wheel(300,0);
  await page.waitForFunction(x=>visualViewport.offsetLeft>x,firstPan);
  assert.deepEqual(await positions(),beforePan,'Horizontal panning leaves both vertical offsets alone');
  assert.equal(await page.locator('.pdf-pages').evaluate(el=>el.scrollLeft),0,'The PDF does not pan separately');
  await page.mouse.wheel(-2000,0);
  await page.waitForFunction(()=>visualViewport.offsetLeft===0);
  await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:1});
  await cdp.detach();
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
  page.on('request',r=>{if(r.url().endsWith('/compile'))compileRequests++;});
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
  await page.route('**/file?**',async route=>{await pdfGate;await route.continue();});
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
  const refreshedURL=await page.locator('.pdf-pages').getAttribute('data-url');
  await page.getByRole('link',{name:'Go to reference 3',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.pdf-pages').scrollTop>1000);
  assert.ok(await page.locator('.pdf-pages').evaluate(el=>el.scrollTop)>1000);
  assert.equal(await page.locator('.pdf-pages').getAttribute('data-url'),refreshedURL);

  await page.unroute('**/file?**');
  assert.equal(compileRequests,1);
  await page.reload();
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('menuitemcheckbox',{name:'Auto-compile: off'}).waitFor();
  await page.getByRole('menuitemcheckbox',{name:'Auto-compile: off'}).click();
  await page.getByRole('button',{name:'other.tex',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.pdf-pages')?.dataset.url.includes('other.pdf'));
  await page.getByRole('button',{name:'More',exact:true}).click();
  await page.getByRole('button',{name:'Writing style',exact:true}).click();
  await page.getByLabel('Writing profile').fill('Use short sentences.');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  // Home lists projects; a cancelled picker stays home, and reopening restores the main file.
  await page.getByRole('button',{name:'All projects'}).click();
  chosenDirectory=null;
  await openFolder();
  await page.getByRole('link',{name:'Course',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.tree-row.main')?.dataset.path==='other.tex');
  // A blank project lives in the library and compiles right away.
  await page.getByRole('button',{name:'All projects'}).click();
  await page.getByRole('button',{name:'New project'}).click();
  await page.getByRole('button',{name:'Blank project'}).click();
  await page.getByLabel('Project name').fill('Thesis');
  await page.getByRole('button',{name:'Create',exact:true}).click();
  await page.locator('canvas[data-rendered=true]').first().waitFor({timeout:180000});
  assert.equal(await page.locator('.project-name').textContent(),'Thesis');
  assert.ok((await fs.stat(path.join(root,'library/Thesis/main.pdf'))).isFile());
  await page.getByRole('button',{name:'All projects'}).click();
  await page.locator('.projects tbody a').first().waitFor();
  assert.deepEqual(await page.locator('.projects tbody a').allTextContents(),['Thesis','Course']);
  chosenDirectory='Import';
  await openFolder();
  await page.getByText('Select a .tex file or ask the agent to create one.').waitFor();
  // Stopping a long request kills it right away and frees the agent.
  await page.getByLabel('Agent request').fill('Take your time.');
  await page.getByLabel('Agent request').press('Enter');
  await page.locator('.thinking').filter({hasText:'Reading exam.pdf'}).waitFor();
  const stoppedAt=Date.now();
  await page.getByRole('button',{name:'Stop agent'}).click();
  await page.locator('.message:not(.user) .markdown').filter({hasText:'Stopped.'}).waitFor();
  assert.ok(Date.now()-stoppedAt<10000,'Stop takes effect right away');
  assert.equal(await page.getByRole('button',{name:'Stop agent'}).count(),0);
  const chooser=page.waitForEvent('filechooser');
  await page.getByRole('button',{name:'Attach files'}).click();
  await (await chooser).setFiles(path.join(root,'board.png'));
  // Pasting the same image twice at once still gives each copy its own name.
  await page.evaluate(base64=>{
    for(let i=0;i<2;i++){
      const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'image.png',{type:'image/png'}));
      document.querySelector('textarea[aria-label="Agent request"]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    }
  },pixelBase64);
  await page.getByRole('button',{name:'Remove image-2.png'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.attachments .attachment:not(.uploading)').length===3);
  assert.deepEqual((await page.locator('.attachments .attachment').allTextContents()).sort(),['board.png','image-2.png','image.png']);
  for(const name of ['board.png','image.png','image-2.png']) assert.deepEqual(await fs.readFile(path.join(root,'Import',name)),pixel,'Attachments are copied into the project');
  await page.locator('.tree-row[data-path="image-2.png"]').waitFor();
  await page.getByLabel('Agent request').fill('Convert this PDF to LaTeX.');
  await page.getByLabel('Agent request').press('Enter');
  await page.getByRole('button',{name:'Remove board.png'}).waitFor({state:'detached'});
  await page.locator('.thinking').filter({hasText:'Reading exam.pdf'}).waitFor();
  await page.locator('.message.user').filter({hasText:'Convert this PDF to LaTeX.'}).filter({hasText:'board.png'}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.tree-row.main')?.dataset.path==='exam_solutions.tex',{},{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('.pdf-pages')?.dataset.url.includes('exam_solutions.pdf'),{},{timeout:180000});
  assert.deepEqual(await fs.readFile(path.join(root,'Import/exam.pdf')),originalPDF);
  const reply=page.locator('.message:not(.user) .markdown').filter({hasText:'Converted exam.pdf'});
  await reply.waitFor();
  assert.equal(await reply.locator('strong').textContent(),'exam.pdf','Replies render Markdown');
  assert.equal(await reply.locator('.katex').count(),4,'Replies render inline math and matrices');
  assert.equal(await reply.locator('.katex-display').count(),1,'Matrix equations use display math');
  assert.equal(await reply.locator('.katex-error').count(),0,'Matrix delimiters do not produce red parse errors');
  assert.equal(await reply.locator('math mtable mtr').count(),8,'Both column vectors keep all four rows');
  assert.equal(await page.getByRole('button',{name:'Collapse chat history'}).count(),1,'Sending opens the thread');
  const codexCall=JSON.parse(await fs.readFile(path.join(root,'codex-call.json'),'utf8'));
  assert.ok(codexCall.args.includes('workspace-write'),'The agent can only write in its scratch directory');
  assert.match(codexCall.prompt,/The user's project folder is \S*Import\./,'The agent is pointed at the folder');
  assert.match(codexCall.prompt,/attached these files for this request; they are saved in the project:\n- board\.png: \S*Import\/board\.png/,'Attachments are passed by their project path');
  assert.deepEqual(codexCall.args.filter((a,i)=>codexCall.args[i-1]==='-i').map(f=>path.basename(f)).sort(),['board.png','image-2.png','image.png'],'Images go to Codex as image input');
  assert.match(await fs.readFile(path.join(root,'Import/exam_solutions.tex'),'utf8'),/Solve/);
  assert.equal(await fs.readFile(path.join(root,'Import/notes/summary.txt'),'utf8'),'Solve for x.','Edits can create files in subfolders');
  assert.deepEqual(await page.getByLabel('Changed files').locator('.attachment').allTextContents(),['exam_solutions.tex','notes/summary.txt']);
  assert.match(codexCall.prompt,/- exam\.pdf \(\d+ KB\)/,'The agent sees the project files');
  assert.equal((await(await fetch(url+'/api/style')).json()).examples,1,'AI output excluded from human style');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('.tree-row.main')?.dataset.path==='exam_solutions.tex');
  const importProject=(await(await fetch(url+'/api/projects')).json()).find(p=>p.name==='Import');
  const projectURL=url+'/api/projects/'+importProject.id;
  const req=async(endpoint,body,method='POST')=>{const r=await fetch(projectURL+endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return{status:r.status,data:await r.json()};};
  const doc=await(await fetch(projectURL+'/document?path=exam_solutions.tex')).json();
  const goodPDF=await fs.readFile(path.join(root,'Import/exam_solutions.pdf'));
  const broken=await req('/document',{path:doc.path,revision:doc.revision,text:'\\documentclass{article}\\begin{document}\\badcommand\\end{document}'},'PUT');
  const failed=await req('/compile',{path:doc.path,revision:broken.data.revision});
  assert.equal(failed.status,500);
  assert.match(failed.data.error,/^exam_solutions\.tex:1: Undefined control sequence/);
  assert.deepEqual(await fs.readFile(path.join(root,'Import/exam_solutions.pdf')),goodPDF);
  assert.equal((await req('/document',{path:doc.path,revision:doc.revision,text:'lost'},'PUT')).status,409);
  assert.equal((await req('/inverse-search',{path:doc.path,revision:doc.revision,page:1,x:140,y:135})).status,409,'Stale source mappings are rejected');
  assert.equal((await req('/inverse-search',{path:doc.path,revision:doc.revision,page:0,x:0,y:0})).status,400);
  assert.equal((await fetch(projectURL+'/document?path=../Course/main.tex')).status,403,'Files outside the project are rejected');
  assert.equal((await fetch(url+'/api/projects/missing/document?path=main.tex')).status,404);
  assert.equal((await req('/task',{instruction:'Summarize.',attachments:['missing.png']})).status,404);
  assert.equal((await fetch(projectURL+'/new-document',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify({name:'bad.tex'})})).status,403);
  await fs.mkdir(path.join(root,'Gone'));
  const gone=await(await fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:path.join(root,'Gone')})})).json();
  await fs.rm(path.join(root,'Gone'),{recursive:true});
  const goneFiles=await fetch(url+'/api/projects/'+gone.id+'/files');
  assert.equal(goneFiles.status,404);assert.match((await goneFiles.json()).error,/moved or deleted/);
  assert.equal((await fetch(url+'/api/projects/'+gone.id,{method:'DELETE'})).status,200,'A project with a missing folder can still be removed');
  // A linked folder with code and data: documents show by default, other files are a click away,
  // build files can be cleaned up, and Paperdesk leaves nothing of its own in the folder.
  await fs.mkdir(path.join(root,'Old/Tidy/src'),{recursive:true});
  for(const [name,text] of [['report.tex',latex],['report.aux','x'],['server.log','keep'],['src/top.v','module top; endmodule'],['data.csv','1,2']])await fs.writeFile(path.join(root,'Old/Tidy',name),text);
  const post=(route,body)=>fetch(url+'/api'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const tidy=await(await post('/projects',{path:path.join(root,'Old/Tidy')})).json();
  await page.goto(url+'/p/'+tidy.id);
  await page.locator('.pdf-page').first().waitFor();
  assert.equal(await page.locator('.tree-row[data-path="data.csv"]').count(),0,'Non-document files are hidden by default');
  await page.getByRole('button',{name:'Show 2 other files'}).click();
  await page.locator('.tree-row[data-path="data.csv"]').waitFor();
  await page.getByRole('button',{name:'Show documents only'}).click();
  await page.getByRole('button',{name:'More'}).click();
  await page.getByRole('button',{name:'Clean up build files'}).click();
  await page.getByText('Moved 1 build file to the Trash').waitFor();
  assert.deepEqual((await fs.readdir(path.join(root,'Old/Tidy'))).sort(),['data.csv','report.pdf','report.tex','server.log','src'],'Only build files beside a source are removed, and no .paperdesk folder is added');
  // Moving the parent folder marks its projects missing; Locate re-points this one and its sibling.
  await fs.mkdir(path.join(root,'Old/Sibling'));
  const sibling=await(await post('/projects',{path:path.join(root,'Old/Sibling')})).json();
  await fs.rename(path.join(root,'Old'),path.join(root,'Moved'));
  await page.goto(url);
  chosenDirectory='Moved/Tidy';
  await page.locator('tr',{hasText:'Tidy'}).getByRole('button',{name:'Folder missing · Locate…'}).click();
  await page.waitForFunction(()=>!document.body.textContent.includes('Folder missing'));
  assert.equal((await(await fetch(url+'/api/projects')).json()).find(p=>p.id===sibling.id).path,path.join(root,'Moved/Sibling'));
  // Settings show what is installed and save the agent choice.
  await page.getByRole('button',{name:'Settings'}).click();
  const settings=page.getByRole('dialog',{name:'Settings'});
  await settings.getByText('Compiles your documents').waitFor();
  assert.equal(await settings.getByRole('radio',{name:/Codex/}).isChecked(),true,'The installed agent is selected');
  await settings.getByLabel('Model').fill('test-model');
  await settings.getByRole('button',{name:'Save'}).click();
  await settings.waitFor({state:'detached'});
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'.app-data/settings.json'),'utf8')),{agent:'codex',model:'test-model',library:path.join(root,'library')});
  await page.goto(url+'/p/'+tidy.id);
  await page.locator('.tree-row[data-path="report.tex"]').waitFor();
  await page.setViewportSize({width:390,height:844});
  const tree=await page.locator('.tree').boundingBox(), editorBox=await page.locator('.left').boundingBox();
  assert.ok(tree.width>350 && tree.y+tree.height<=editorBox.y+1,'On a phone the file tree stacks above the editor');
  assert.deepEqual(errors,[]);
  console.log('Passed: quiet background PDF swaps, preserved scroll, auto-compile debounce, persistent manual mode, PDF selection/copy and inverse search (double-click, source selection, included sources, stale-map rejection), project list, library projects, folder linking, file tree with main-document switching, new and uploaded files, the image and PDF file pane with rename and delete, autosave, style memory, stopping the agent, attachments copied into the project, and PDF-only folder conversion with multi-file agent edits, automatic result loading/compilation, original PDF preservation, reload persistence, failed-build recovery, missing project folders, phone layout, stale-write and origin protection.');
}catch(e){
  // Keep a picture of the page at the moment a check failed.
  const shot=path.join(os.tmpdir(),'paperdesk-failure.png');
  await page?.screenshot({path:shot,timeout:5000}).then(()=>console.error('Screenshot: '+shot),()=>{});throw e;
}
finally{await browser?.close();server.kill('SIGTERM');await fs.rm(root,{recursive:true,force:true});}
