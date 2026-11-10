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
const inputFile = /^\((\.{0,2}\/[^\s()]*|[^\s()]+\.(?:tex|sty|cls|clo|cfg|def|fd|aux|toc|bbl|ltx|lua|ldf|out|lof|lot))/;
// Errors, warnings and bad boxes from a TeX log, each with the file and line it came from.
// TeX opens "(file" when it starts reading an input and ")" when it finishes, so a stack of
// parentheses says which file a warning without a file name belongs to.
export function parseLog(log) {
  const lines = log.split('\n'), entries = [], stack = [];
  const current = () => stack.findLast(Boolean) || null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    let m;
    if ((m = text.match(/^(.+?):(\d+): (.*)$/)) && !/^\s/.test(text)) {
      // Keep the context TeX prints, up to the source line it stopped at.
      const detail = [];
      for (let j = i + 1; j < lines.length && j < i + 15; j++) {
        detail.push(lines[j]);
        if (/^l\.\d+/.test(lines[j])) { detail.push(lines[j + 1] || ''); i = j + 1; break; }
        if (j === i + 14) i = j;
      }
      const context = detail.filter(l => l.trim() && !/^(See the LaTeX manual|Type {2}H <return>|\s*\.\.\.\s*$)/.test(l));
      entries.push({ severity:'error', file:m[1], line:+m[2], message:m[3].trim(), detail:context.join('\n') });
      continue;
    }
    if ((m = text.match(/^(?:LaTeX|LaTeX Font|(?:Package|Class) ([\w.-]+)) Warning: (.*)$/))) {
      let message = m[2];
      // Package warnings continue on lines that start with "(package)".
      while (m[1] && lines[i + 1]?.startsWith(`(${m[1]})`)) message += ' ' + lines[++i].slice(m[1].length + 2).trim();
      if (/Rerun to get|may have changed\. Rerun/.test(message)) continue;
      const line = message.match(/on input line (\d+)\.?$/);
      entries.push({ severity:'warning', file:line ? current() : null, line:line ? +line[1] : null, message:(m[1] ? `${m[1]}: ` : '') + message.replace(/ on input line \d+\.?$/, '').trim() });
      continue;
    }
    if ((m = text.match(/^((?:Over|Under)full \\[hv]box \([^)]*\)) .*?lines? (\d+)/))) {
      entries.push({ severity:'typesetting', file:current(), line:+m[2], message:m[1] });
      // The box contents that follow can hold unbalanced parentheses from the document.
      while (i + 1 < lines.length && lines[i + 1].trim()) i++;
      continue;
    }
    for (let k = 0; k < text.length; k++) {
      if (text[k] === '(') stack.push(text.slice(k).match(inputFile)?.[1] || null);
      else if (text[k] === ')') stack.pop();
    }
  }
  const seen = new Set();
  return entries.filter(e => { const key = [e.severity, e.file, e.line, e.message].join('\0'); return !seen.has(key) && seen.add(key); });
}
// Builds into `outdir` so a failed run never replaces the last good PDF.
export async function compileLatex(file, text, outdir) {
  const tried = [];
  for (let engine = detectEngine(text); ; ) {
    tried.push(engine);
    // With -file-line-error, latexmk no longer creates \include subfolders in outdir itself.
    for (const [, name] of text.matchAll(/\\include\s*\{([^}]+)\}/g)) if (!name.includes('..')) await fs.mkdir(path.join(outdir, path.dirname(name.trim())), { recursive: true });
    try {
      await run('latexmk', [engines[engine][0], '-interaction=nonstopmode', '-file-line-error', '-synctex=1', '-outdir=' + outdir, path.basename(file)], { cwd: path.dirname(file), timeout: 180000, env: { max_print_line: '10000' } });
      return engines[engine][1];
    } catch (e) {
      const log = await fs.readFile(path.join(outdir, path.basename(file, '.tex') + '.log'), 'utf8').catch(() => '');
      // Package messages wrap onto `(package)` continuation lines.
      const flat = log.replace(/\s*\n(?:\([\w-]+\))?\s*/g, ' ');
      const next = needs.find(([pattern]) => pattern.test(flat))?.[1];
      if (!next || tried.includes(next)) {
        const message = latexError(log) || e.message, diagnostics = parseLog(log);
        if (!diagnostics.some(d => d.severity === 'error')) diagnostics.unshift({ severity:'error', file:null, line:null, message });
        throw Object.assign(httpError(message, 500), { diagnostics });
      }
      await fs.rm(outdir, { recursive: true, force: true });
      await fs.mkdir(outdir);
      engine = next;
    }
  }
}
