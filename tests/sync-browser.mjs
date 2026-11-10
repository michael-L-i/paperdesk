import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-sync-browser-'));
const port=await new Promise(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const p=probe.address().port;probe.close(()=>resolve(p));});});
const url=`http://127.0.0.1:${port}`;
const source=String.raw`\documentclass{article}
\begin{document}
First version.
\input{chapter}
\end{document}`;
await fs.writeFile(path.join(root,'main.tex'),source);
await fs.writeFile(path.join(root,'chapter.tex'),'Original chapter.');
const server=spawn(process.execPath,['server/index.js'],{cwd:app,env:{...process.env,NODE_ENV:'production',PORT:String(port),PAPERDESK_DATA_DIR:path.join(root,'.data')},stdio:'pipe'});
let browser;
try {
  for(let i=0;i<600;i++){try{if((await fetch(url+'/api/projects')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const project=await(await fetch(url+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:root})})).json();
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
  const context=await browser.newContext();
  const a=await context.newPage(), b=await context.newPage();
  for(const page of [a,b]) {
    await page.goto(url+'/p/'+project.id);
    await page.locator('.cm-content').waitFor();
    await page.waitForFunction(()=>document.querySelector('.right .pdf-pages') && document.querySelector('.right .status')?.textContent==='',{timeout:60000});
  }
  const preview=page=>page.locator('.right .pdf-pages').getAttribute('data-url');
  const old=await preview(b);
  await fs.writeFile(path.join(root,'main.tex'),source.replace('First version.','External saved version.'));
  for(const page of [a,b])await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('External saved version.'),{timeout:15000});
  await b.waitForFunction(old=>document.querySelector('.right .pdf-pages')?.dataset.url!==old && document.querySelector('.right .status')?.textContent==='',old,{timeout:60000});
  assert.notEqual(await preview(b),old,'Other tabs adopt a current rebuilt PDF');
  await fs.writeFile(path.join(root,'chapter.tex'),'Updated included chapter.');
  await b.waitForFunction(()=>document.querySelector('.right .pdf-text-layer')?.textContent.includes('Updated included chapter.'),{timeout:60000});
  // A tab in manual mode still adopts another instance's completed build.
  await b.getByRole('button',{name:'More',exact:true}).click();
  await b.getByRole('menuitemcheckbox',{name:/Auto-compile/}).click();
  await b.locator('.cm-content').press('ControlOrMeta+End');
  await b.locator('.cm-content').press('End');
  await b.locator('.cm-content').pressSequentially('\n% saved in second tab');
  await b.waitForFunction(()=>document.querySelector('header .status')?.textContent==='Saved');
  await a.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('% saved in second tab'),{timeout:15000});
  await b.waitForFunction(()=>document.querySelector('.right .status')?.textContent==='',{timeout:60000});
  // Hold a dirty draft while another writer changes disk; polling must not replace it.
  await a.getByRole('button',{name:'More',exact:true}).click();
  await a.getByRole('menuitemcheckbox',{name:/Auto-compile/}).click();
  await a.route('**/document',route=>route.request().method()==='PUT'?route.fulfill({status:409,json:{error:'Conflict fixture'}}):route.continue());
  await a.locator('.cm-content').press('ControlOrMeta+End');
  await a.locator('.cm-content').pressSequentially('\n% local unsaved draft');
  await fs.writeFile(path.join(root,'main.tex'),source.replace('First version.','Concurrent disk version.'));
  await a.locator('summary').getByText('This file changed in another tab or on disk. Your draft is preserved. Download it or choose Use disk version.',{exact:true}).waitFor();
  assert.match(await a.locator('.cm-content').innerText(),/local unsaved draft/);
  assert.doesNotMatch(await a.locator('.cm-content').innerText(),/Concurrent disk version/);
  assert.match(await fs.readFile(path.join(root,'main.tex'),'utf8'),/Concurrent disk version/);
  console.log('Passed: external edits, two-tab source/PDF sync, included-source rebuilding, manual-mode PDF adoption, and dirty-draft protection.');
} finally {await browser?.close();server.kill('SIGTERM');await fs.rm(root,{recursive:true,force:true});}
