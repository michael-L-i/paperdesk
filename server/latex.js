import fs from 'node:fs/promises';
import path from 'node:path';
import { run } from './process.js';
import { httpError } from './workspace.js';

const engines = { pdflatex: ['-pdf', 'pdfLaTeX'], xelatex: ['-xelatex', 'XeLaTeX'], lualatex: ['-lualatex', 'LuaLaTeX'] };
// Log messages that mean the document needs a different engine.
const needs = [
  [/requires either XeTeX or LuaTeX|only supports XeTeX|Cannot be run with pdfLaTeX/, 'xelatex'],
  [/requires LuaTeX|LuaTeX is required/, 'lualatex'],
  [/pdfTeX in PDF mode is not detected/, 'pdflatex'],
];
// A `% !TEX program = …` comment wins; otherwise the preamble decides, defaulting to pdfLaTeX.
export function detectEngine(text) {
  const magic = text.match(/^\s*%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)\b/im);
  if (magic) return magic[1].toLowerCase();
  const code = text.replace(/(^|[^\\])%.*$/gm, '$1'), preamble = code.split(/\\begin\s*\{document\}/)[0];
  const packages = [...preamble.matchAll(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g)].flatMap(m => m[1].split(',').map(p => p.trim()));
  if (packages.includes('luacode') || /\\directlua\b/.test(code)) return 'lualatex';
  if (packages.some(p => ['fontspec', 'unicode-math', 'polyglossia', 'xeCJK', 'mathspec'].includes(p)) || /\\set(?:main|sans|mono)font\b/.test(preamble)) return 'xelatex';
  return 'pdflatex';
}
// The first TeX error and its context, not latexmk's whole transcript.
export function latexError(log) {
  const lines = log.split('\n'), start = lines.findIndex(l => /^(?:\S+:\d+: |! )/.test(l));
  if (start < 0) return '';
  lines[start] = lines[start].replace(/^\S*\/(?=[^/\s]+:\d+: )/, '');
  return lines.slice(start, start + 12).join('\n').trim();
}
// Builds into `outdir` so a failed run never replaces the last good PDF.
export async function compileLatex(file, text, outdir) {
  const tried = [];
  for (let engine = detectEngine(text); ; ) {
    tried.push(engine);
    // With -file-line-error, latexmk no longer creates \include subfolders in outdir itself.
    for (const [, name] of text.matchAll(/\\include\s*\{([^}]+)\}/g)) if (!name.includes('..')) await fs.mkdir(path.join(outdir, path.dirname(name.trim())), { recursive: true });
    try {
      await run('latexmk', [engines[engine][0], '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-synctex=1', '-outdir=' + outdir, path.basename(file)], { cwd: path.dirname(file), timeout: 180000, env: { max_print_line: '10000' } });
      return engines[engine][1];
    } catch (e) {
      const log = await fs.readFile(path.join(outdir, path.basename(file, '.tex') + '.log'), 'utf8').catch(() => '');
      // Package messages wrap onto `(package)` continuation lines.
      const flat = log.replace(/\s*\n(?:\([\w-]+\))?\s*/g, ' ');
      const next = needs.find(([pattern]) => pattern.test(flat))?.[1];
      if (!next || tried.includes(next)) throw httpError(latexError(log) || e.message, 500);
      await fs.rm(outdir, { recursive: true, force: true });
      await fs.mkdir(outdir);
      engine = next;
    }
  }
}
