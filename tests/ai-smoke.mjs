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
  await run('pdflatex',['-interaction=nonstopmode','exam.tex'],{cwd:temp});
  for (const ext of ['tex','aux','log']) await fs.unlink(path.join(temp,'exam.'+ext));
  // Nothing is attached: the agent has to find and read the PDF in the folder itself.
  const activity = [];
  const result = await askAI({instruction:'Convert the exam in this folder to editable LaTeX with blank solution space.',mode:'task',folder:temp,files:['- exam.pdf (12 KB)'],onActivity:a=>activity.push(a)});
  assert.ok(activity.some(a=>a.includes('exam.pdf')), `The agent read exam.pdf: ${activity}`);
  const [edit] = result.edits;
  assert.ok(result.edits.length === 1 && edit.path.endsWith('.tex') && edit.path !== 'exam.tex', 'Must create one new document and preserve the original exam.pdf');
  assert.match(edit.content,/\\begin\{document\}/);
  assert.match(edit.content,/2\s*x\s*\+\s*3/);
  await fs.writeFile(path.join(temp,'converted.tex'),edit.content);
  await run('pdflatex',['-interaction=nonstopmode','-halt-on-error','converted.tex'],{cwd:temp});
  assert.equal((await fs.readFile(path.join(temp,'converted.pdf'))).subarray(0,4).toString(),'%PDF');
  console.log(`Live check passed: the agent read the folder (${activity.join(', ')}) and its LaTeX compiles.`);
} finally { await fs.rm(temp,{recursive:true,force:true}); }
