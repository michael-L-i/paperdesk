// Optional live check: uses your Codex account. Run with npm run test:ai.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { run } from '../server/process.js';
import { askAI } from '../server/ai.js';
const temp = await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-ai-check-'));
try {
  await fs.writeFile(path.join(temp,'exam.tex'),String.raw`\documentclass{article}\usepackage{amsmath}\begin{document}\section*{Practice 1}\textbf{Problem 1.} Solve $2x+3=11$. Show your work.\end{document}`);
  await run('tectonic',['--untrusted',path.join(temp,'exam.tex')]);
  const result = await askAI({instruction:'Convert this PDF to editable LaTeX with blank solution space.',text:'',selection:'',style:'',examples:[],mode:'task',context:JSON.stringify({files:['exam.pdf'],primary:null,attachments:['exam.pdf']}),source:path.join(temp,'exam.pdf')});
  assert.ok(result.filename.endsWith('.tex') && result.filename !== 'exam.tex', 'Must preserve the original exam.pdf');
  assert.match(result.latex,/\\begin\{document\}/);
  assert.match(result.latex,/2\s*x\s*\+\s*3/);
  await fs.writeFile(path.join(temp,'converted.tex'),result.latex);
  await run('tectonic',['--untrusted',path.join(temp,'converted.tex')]);
  assert.equal((await fs.readFile(path.join(temp,'converted.pdf'))).subarray(0,4).toString(),'%PDF');
  console.log('Live Codex PDF → LaTeX → compiled PDF check passed.');
} finally { await fs.rm(temp,{recursive:true,force:true}); }
