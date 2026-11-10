import { StateField } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { linter, lintGutter, setDiagnostics } from '@codemirror/lint';
import { stex } from '@codemirror/legacy-modes/mode/stex';

// stex loses track of braces after constructs such as \] or \end{itemize} and paints the
// following } red as an error, even in a document that compiles.
const latex = StreamLanguage.define({ ...stex, token(stream, state) { const style = stex.token(stream, state); return style === 'error' ? null : style; } });

const verbatim = /\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\}/y, verb = /\\verb\*?([^a-zA-Z\s*])/y;
// Each bracket's partner position, or -1 for a brace without one. Comments, escapes such as \{
// and verbatim text are skipped. Braces must balance in TeX, so only they can be unmatched;
// ( and [ pair within their brace group, as in [0, 1) or an (a) label, and are otherwise ignored.
export function bracketPairs(text) {
  const pairs = new Map(), braces = [];
  let group = { '[': [], '(': [] };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '%') { i = text.indexOf('\n', i); if (i < 0) break; }
    else if (c === '\\') {
      verbatim.lastIndex = verb.lastIndex = i;
      const env = verbatim.exec(text), inline = !env && verb.exec(text);
      if (env) { const end = text.indexOf(`\\end{${env[1]}}`, verbatim.lastIndex); if (end < 0) break; i = end + env[1].length + 5; }
      else if (inline) { const end = text.indexOf(inline[1], verb.lastIndex); if (end < 0) break; i = end; }
      else i++; // The escaped character, such as \{, \% or a second backslash.
    }
    else if (c === '{') { braces.push({ at:i, group }); group = { '[': [], '(': [] }; }
    else if (c === '}') {
      const open = braces.pop();
      if (open) { pairs.set(open.at, i); pairs.set(i, open.at); group = open.group; }
      else pairs.set(i, -1);
    }
    else if (c === '[' || c === '(') group[c].push(i);
    else if (c === ']' || c === ')') {
      const open = group[c === ']' ? '[' : '('].pop();
      if (open !== undefined) { pairs.set(open, i); pairs.set(i, open); }
    }
  }
  for (const open of braces) pairs.set(open.at, -1);
  return pairs;
}

const pairsField = StateField.define({
  create: state => bracketPairs(state.doc.toString()),
  update: (pairs, tr) => tr.docChanged ? bracketPairs(tr.state.doc.toString()) : pairs,
});
const matching = Decoration.mark({ class:'cm-matchingBracket' }), nonmatching = Decoration.mark({ class:'cm-nonmatchingBracket' });
const bracketHighlight = EditorView.decorations.compute([pairsField, 'selection'], state => {
  const pairs = state.field(pairsField), marks = [];
  for (const range of state.selection.ranges) {
    const at = range.empty ? [range.head - 1, range.head].find(p => pairs.has(p)) : undefined;
    if (at === undefined) continue;
    const partner = pairs.get(at);
    if (partner < 0) marks.push(nonmatching.range(at, at + 1));
    else marks.push(matching.range(Math.min(at, partner), Math.min(at, partner) + 1), matching.range(Math.max(at, partner), Math.max(at, partner) + 1));
  }
  return Decoration.set(marks, true);
});
const bracketTheme = EditorView.baseTheme({
  '&.cm-focused .cm-matchingBracket': { backgroundColor:'#328c8252' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor:'#bb555544' },
});

// Compile results arrive through setDiagnostics; linter(null) only installs the underlines and tooltips.
export const latexExtensions = [latex, pairsField, bracketHighlight, bracketTheme, linter(null), lintGutter()];

// Compile log entries for this file as editor diagnostics. TeX's context line ("l.12 text") ends
// where it stopped reading, which marks the offending command; a warning's quoted name, such as
// an undefined reference, marks itself. Anything else marks the line.
export function showDiagnostics(view, entries) {
  const doc = view.state.doc;
  view.dispatch(setDiagnostics(view.state, entries.filter(e => e.line && e.severity !== 'typesetting').map(e => {
    const line = doc.line(Math.min(e.line, doc.lines));
    let from = line.from + line.text.search(/\S|$/), to = line.to;
    const before = e.detail?.match(/^l\.\d+ (?:\.\.\.)?(.*)$/m)?.[1], name = e.message.match(/`([^']+)'/)?.[1];
    const stop = before?.trim() ? line.text.lastIndexOf(before) : -1;
    if (stop >= 0) { to = line.from + stop + before.length; from = to - (before.match(/\\[A-Za-z@]+\*?(?:\{[^{}]*\})?$|\S+$/)?.[0].length || 0); }
    else if (name && line.text.includes(name)) { from = line.from + line.text.indexOf(name); to = from + name.length; }
    const renderMessage = () => {
      const box = document.createElement('div'), context = document.createElement('pre');
      box.textContent = e.message; context.textContent = e.detail || '';
      if (e.detail) box.append(context);
      return box;
    };
    return { from, to:Math.max(from, to), severity:e.severity, message:e.message, renderMessage };
  })));
}
