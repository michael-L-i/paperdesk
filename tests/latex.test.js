import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../server/process.js';
import { detectEngine, latexError, compileLatex, parseLog } from '../server/latex.js';
test('choose the engine from a magic comment, then the preamble', () => {
  assert.equal(detectEngine(String.raw`\documentclass{article}\usepackage[pdftex,colorlinks]{hyperref}\begin{document}\end{document}`), 'pdflatex');
  assert.equal(detectEngine(String.raw`\documentclass{article}\usepackage{amsmath, fontspec}`), 'xelatex');
  assert.equal(detectEngine(String.raw`\documentclass{article}\setmainfont{Helvetica}`), 'xelatex');
  assert.equal(detectEngine(String.raw`\usepackage{luacode}`), 'lualatex');
  assert.equal(detectEngine('% \\usepackage{fontspec}\n\\documentclass{article}'), 'pdflatex');
  assert.equal(detectEngine('% !TEX program = LuaLaTeX\n\\usepackage{fontspec}'), 'lualatex');
  assert.equal(detectEngine('\\documentclass{article}\\begin{document}\\verb|\\usepackage{fontspec}|'), 'pdflatex');
});
test('report the first TeX error without the transcript', () => {
  const log = "This is XeTeX\n(./hw.tex\n/opt/homebrew/share/texmf-dist/tex/latex/hyperref/hyperref.sty:4018: Package hyperref Error: Wrong driver option `pdftex',\n(hyperref)                because pdfTeX in PDF mode is not detected.\n";
  assert.match(latexError(log), /^hyperref\.sty:4018: Package hyperref Error: Wrong driver option `pdftex',\n\(hyperref\)/);
  assert.equal(latexError('Output written on hw.pdf.'), '');
});
test('compile each document with the engine it needs', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-latex-test-'));
  const build = async (name, source) => {
    const file = path.join(dir, name), out = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-latex-out-'));
    await fs.writeFile(file, source);
    try {
      const engine = await compileLatex(file, source, out);
      return { engine, text: (await run('pdftotext', [path.join(out, name.replace(/\.tex$/, '.pdf')), '-'])).stdout };
    } finally { await fs.rm(out, { recursive: true, force: true }); }
  };
  try {
    const hyperref = await build('hw.tex', String.raw`\documentclass{article}\usepackage[pdftex,colorlinks=true,urlcolor=blue]{hyperref}\begin{document}Driver \url{https://example.com}\end{document}`);
    assert.equal(hyperref.engine, 'pdfLaTeX');
    assert.equal((await build('font.tex', String.raw`\documentclass{article}\usepackage{fontspec}\begin{document}Font ok\end{document}`)).engine, 'XeLaTeX');
    assert.equal((await build('lua.tex', String.raw`\documentclass{article}\begin{document}\directlua{tex.print("Lua ok")}\end{document}`)).engine, 'LuaLaTeX');
    // A style file hides fontspec from the preamble check; the log triggers a XeLaTeX retry.
    await fs.writeFile(path.join(dir, 'fancy.sty'), '\\RequirePackage{fontspec}\n');
    const retried = await build('retry.tex', String.raw`\documentclass{article}\usepackage{fancy}\begin{document}Retried ok\end{document}`);
    assert.deepEqual([retried.engine, retried.text.includes('Retried ok')], ['XeLaTeX', true]);
    await fs.mkdir(path.join(dir, 'chapters'));
    await fs.writeFile(path.join(dir, 'chapters/one.tex'), 'Chapter text \\cite{knuth}.\n');
    await fs.writeFile(path.join(dir, 'refs.bib'), '@book{knuth, author={Donald Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}\n');
    const book = await build('book.tex', String.raw`\documentclass{article}\begin{document}\include{chapters/one}\bibliographystyle{plain}\bibliography{refs}\end{document}`);
    assert.match(book.text, /Chapter text \[1\]/);
    assert.match(book.text, /The TeXbook/);
    const biblatex = await build('modern.tex', String.raw`\documentclass{article}\usepackage[backend=biber]{biblatex}\addbibresource{refs.bib}\begin{document}Modern \cite{knuth}.\printbibliography\end{document}`);
    assert.match(biblatex.text, /Modern \[1\]/);
    assert.match(biblatex.text, /The TeXbook/);
    await assert.rejects(build('broken.tex', String.raw`\documentclass{article}\begin{document}\badcommand\end{document}`), e => e.status === 500 && /^broken\.tex:1: Undefined control sequence/.test(e.message));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('list every error and warning with the file and line it came from', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paperdesk-log-test-'));
  try {
    await fs.mkdir(path.join(dir, 'parts'));
    await fs.mkdir(path.join(dir, 'out'));
    const source = String.raw`\documentclass{article}
\begin{document}
See \ref{sec:missing}.
\badcommand here.
\input{parts/answer}
\hbox to 1in{This line is far far too wide for the box}
\end{document}`;
    await fs.writeFile(path.join(dir, 'main.tex'), source);
    await fs.writeFile(path.join(dir, 'parts/answer.tex'), 'Included \\alsobad{} text (with parens.\n\\begin{itemize}\\item x\n\\end{enumerate}\n');
    const error = await compileLatex(path.join(dir, 'main.tex'), source, path.join(dir, 'out')).catch(e => e);
    const found = error.diagnostics.map(d => [d.severity, d.file, d.line, d.message]);
    assert.deepEqual(found.filter(d => d[0] === 'error'), [
      ['error', './main.tex', 4, 'Undefined control sequence.'],
      ['error', './parts/answer.tex', 1, 'Undefined control sequence.'],
      ['error', './parts/answer.tex', 3, String.raw`LaTeX Error: \begin{itemize} on input line 2 ended by \end{enumerate}.`],
    ]);
    assert.match(error.diagnostics[1].detail, /^l\.4 \\badcommand/);
    assert.ok(found.some(d => d[0] === 'warning' && d[1] === './main.tex' && d[2] === 3 && /Reference `sec:missing'/.test(d[3])));
    // The box after the included file closes belongs to main.tex again.
    assert.ok(found.some(d => d[0] === 'typesetting' && d[1] === './main.tex' && d[2] === 6));
    assert.ok(!found.some(d => /Rerun/.test(d[3])));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  assert.deepEqual(parseLog('Package hyperref Warning: Token not allowed\n(hyperref)                removing `math shift\' on input line 9.\n'),
    [{ severity:'warning', file:null, line:9, message:"hyperref: Token not allowed removing `math shift'" }]);
});
