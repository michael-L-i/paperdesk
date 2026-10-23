const unit = 65781.76; // scaled points per PDF point
const node = /^([[(hvxkg$])(\d+),(\d+)(?:,-?\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;

// SyncTeX coordinates are PDF points measured from the top-left of the page.
// Glue, kern, math and position records mark where material ends, so each one covers the
// stretch of its hbox since the previous record or nested box.
export function parseSourceMap(text) {
  const files = {}, records = [];
  let page = 0, stack = [];
  const rect = (from, left, right, box, level) => ({ path: from.path, line: from.line, page, left, right: Math.max(left, right),
    top: box.v - Math.max(2, Math.abs(box.height || 8)), bottom: box.v + Math.max(0, box.depth), level });
  function closeHbox(box) {
    const children = box.children.filter(c => c.path), first = children.find(c => c.kind !== 'x');
    // Position records before the first glue or kern inherit the hbox's tag, which on a paragraph
    // line is the line that ended the paragraph, not the line of the first word.
    for (const child of children) { if (child === first) break; if (first && child.line === box.line) child.line = first.line; }
    for (const child of children) records.push(rect(child, child.left, child.h, box, box.level + 1));
    if (!children.length && box.path && box.height > 0) records.push({ ...rect(box, box.h, box.h + Math.abs(box.width), box, box.level), box: true });
  }
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^Input:(\d+):(.*)$/))) { files[m[1]] = m[2]; continue; }
    if ((m = line.match(/^\{(\d+)$/))) { page = +m[1]; stack = []; continue; }
    if (line === ')' || line === ']') {
      const box = stack.pop();
      if (box?.kind === '(') closeHbox(box);
      if (box && stack.length) stack.at(-1).cursor = box.h + box.width;
      continue;
    }
    if (!page || !(m = line.match(node))) continue;
    const [, kind, tag, sourceLine, h, v, w = 0, height = 0, depth = 0] = m;
    const item = { kind, path: files[tag], line: +sourceLine, h: h / unit, v: v / unit, width: w / unit, height: height / unit, depth: depth / unit };
    const box = stack.at(-1);
    if (kind === '(' || kind === '[') stack.push({ ...item, cursor: item.h, children: [], level: stack.length });
    else if (kind === 'h' || kind === 'v') {
      if (item.path && item.height + item.depth > 0) records.push({ ...rect(item, item.h, item.h + Math.abs(item.width), item, stack.length), box: true });
      if (box) box.cursor = item.h + item.width;
    } else if (box?.kind === '(') {
      box.children.push({ ...item, left: kind === 'k' && item.width ? item.h - item.width : Math.min(box.cursor, item.h) });
      box.cursor = item.h;
    }
  }
  return { files: [...new Set(Object.values(files))], records };
}

// On a tie, text beats a bare box, and a table cell beats the table around it.
const rank = record => (record.box ? 0 : 1000) + (record.level || 0);
export function inverseSearch(records, page, x, y) {
  let best = null, score = Infinity;
  for (const record of records) {
    if (record.page !== page) continue;
    const dx = Math.max(record.left-x, 0, x-record.right);
    const dy = Math.max(record.top-y, 0, y-record.bottom);
    // Prefer a nearby line over a horizontally closer but vertically distant one.
    const distance = dx*dx + dy*dy*16;
    if (distance < score || (distance === score && rank(record) > rank(best))) { best=record; score=distance; }
  }
  return best;
}

const words = text => [...text.normalize('NFKC').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map(m => m[0]);
const sourceWords = line => words(line.replace(/(^|[^\\])%.*$/, '$1').replace(/\\[a-zA-Z@]+/g, ' '));
// TeX tags everything typeset from a macro argument, such as \answer{...} or \title{...}, with the
// line where the argument ends. The clicked word normally lies after the previous tagged line, so
// look for it there, using the PDF text around it to choose between repeats.
export function refineLine(records, match, text, { word = '', before = '', after = '' } = {}) {
  const anchor = words(word).sort((a, b) => b.length - a.length)[0];
  // Text on a tall record, such as an included PDF page or image, was never in the source.
  if (!anchor || match.bottom - match.top > 40) return match.line;
  const start = Math.max(0, match.line - 400);
  let floor = start;
  for (const r of records) if (r.path === match.path && r.line < match.line && r.line > floor) floor = r.line;
  const lines = text.split('\n'), tokens = [];
  for (let n = start + 1; n <= Math.min(match.line, lines.length); n++) for (const w of sourceWords(lines[n-1])) tokens.push({ w, line: n });
  const left = words(before).slice(-6), right = words(after).slice(0, 6);
  // How many of the clicked word's PDF neighbours surround it in the source, nearby or in order.
  const nearby = i => {
    const near = (from, to) => new Set(tokens.slice(Math.max(0, from), to).map(t => t.w));
    const l = near(i - 12, i), r = near(i + 1, i + 13);
    return left.filter(w => l.has(w)).length + right.filter(w => r.has(w)).length;
  };
  const inOrder = i => [1, 2, 3].filter(j => tokens[i-j]?.w === left.at(-j)).length + [1, 2, 3].filter(j => tokens[i+j]?.w === right[j-1]).length;
  const best = (hits, score, minimum) => {
    let found = null;
    // Ties go to the occurrence nearest the tagged line.
    for (const i of hits) { const s = score(i); if (s >= minimum) { found = tokens[i]; minimum = s; } }
    return found;
  };
  // A word hyphenated across PDF lines only appears in the source as part of a longer word.
  let hits = tokens.flatMap((t, i) => t.w === anchor ? [i] : []);
  if (!hits.length && anchor.length >= 3) hits = tokens.flatMap((t, i) => t.w.startsWith(anchor) || t.w.endsWith(anchor) ? [i] : []);
  // Unrelated material, such as a list label, can carry a tag inside the argument. Then look
  // further back, but only trust a match whose neighbours read the same as in the PDF.
  const found = best(hits.filter(i => tokens[i].line > floor), nearby, 0) || best(hits, inOrder, 3);
  return found ? found.line : match.line;
}
