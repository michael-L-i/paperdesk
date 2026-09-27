import synctex from 'synctex-js';

// SyncTeX coordinates are PDF points measured from the top-left of the page.
// Word/glue records carry more precise source lines than their enclosing boxes.
export function parseSourceMap(text) {
  const parsed = synctex.parser.parseSyncTex(text);
  const records = [];
  for (const box of parsed.hBlocks) {
    const elements = box.elements.filter(e => ['g', 'x', 'k', 'h', 'v', '$'].includes(e.type) && e.file?.path);
    let previous = box.left;
    for (const element of elements) {
      const right = element.left;
      const left = element.type === 'k' && element.width ? right - element.width : Math.min(previous, right);
      const height = Math.max(2, Math.abs(element.height || box.height || 8));
      records.push({ path: element.file.path, line: element.line, page: element.page,
        left, right: Math.max(left, right), top: element.bottom - height,
        bottom: element.bottom + Math.max(0, (box.depth || 0) / 65781.76) });
      previous = right;
    }
    if (!elements.length && box.file?.path && box.height > 0) records.push({path:box.file.path,line:box.line,page:box.page,left:box.left,right:box.left+Math.abs(box.width),top:box.bottom-box.height,bottom:box.bottom});
  }
  return { files: Object.values(parsed.files).map(f => f.path).filter(Boolean), records };
}
export function inverseSearch(records, page, x, y) {
  let best = null, score = Infinity;
  for (const record of records) {
    if (record.page !== page) continue;
    const dx = Math.max(record.left-x, 0, x-record.right);
    const dy = Math.max(record.top-y, 0, y-record.bottom);
    // Prefer a nearby line over a horizontally closer but vertically distant one.
    const distance = dx*dx + dy*dy*16;
    if (distance < score) { best=record; score=distance; }
  }
  return best;
}
