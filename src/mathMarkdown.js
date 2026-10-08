// remark-math expects display delimiters on their own lines. Agent replies also
// use same-line $$ and LaTeX delimiters; normalize before Markdown can eat them.
export function normalizeMathMarkdown(text) {
  let result = '', i = 0;
  const escaped = index => {
    let slashes = 0;
    while (text[--index] === '\\') slashes++;
    return slashes % 2 === 1;
  };
  const closing = (delimiter, start) => {
    for (let end = text.indexOf(delimiter, start); end >= 0; end = text.indexOf(delimiter, end + delimiter.length)) {
      if (!escaped(end)) return end;
    }
    return -1;
  };
  while (i < text.length) {
    // Keep fenced code and inline code literal, including examples of equations.
    const fence = (i === 0 || text[i - 1] === '\n') && text.slice(i).match(/^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/);
    if (fence) {
      const endPattern = new RegExp('^ {0,3}' + fence[1][0] + '{' + fence[1].length + ',}[ \\t]*(?:\\n|$)', 'gm');
      endPattern.lastIndex = i + fence[0].length;
      const end = endPattern.exec(text);
      const next = end ? end.index + end[0].length : text.length;
      result += text.slice(i, next); i = next; continue;
    }
    if (text[i] === '`' && !escaped(i)) {
      const run = text.slice(i).match(/^`+/)[0];
      let end = text.indexOf(run, i + run.length);
      while (end >= 0 && (text[end - 1] === '`' || text[end + run.length] === '`')) end = text.indexOf(run, end + run.length);
      const next = end >= 0 ? end + run.length : i + run.length;
      result += text.slice(i, next); i = next; continue;
    }
    const delimiter = !escaped(i) && (text.startsWith('$$', i) ? '$$' : text.startsWith('\\[', i) ? '\\[' : text.startsWith('\\(', i) ? '\\(' : null);
    if (delimiter) {
      const close = delimiter === '$$' ? '$$' : delimiter === '\\[' ? '\\]' : '\\)';
      const end = closing(close, i + delimiter.length);
      if (end >= 0) {
        const math = text.slice(i + delimiter.length, end).trim();
        result += delimiter === '\\(' ? '$' + math + '$' : '\n\n$$\n' + math + '\n$$\n\n';
        i = end + close.length; continue;
      }
    }
    result += text[i++];
  }
  return result;
}
