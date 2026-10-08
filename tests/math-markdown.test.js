import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { normalizeMathMarkdown } from '../src/mathMarkdown.js';
const render = text => renderToStaticMarkup(React.createElement(Markdown, {
  remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex],
}, normalizeMathMarkdown(text)));
const equation = String.raw`M\begin{bmatrix}y_1\\y_2\\y_3\\y_4\end{bmatrix}=\begin{bmatrix}0\\-0.5\\5\\-0.5\end{bmatrix}.`;
test('render matrices with display delimiters beside the equation or on separate lines', () => {
  for (const source of ['$$' + equation + '$$', '$$\n' + equation + '$$', '$$' + equation.replace('y_1', '\ny_1') + '\n$$', '$$\n' + equation + '\n$$']) {
    const html = render(source + '\n\nBoth coordinates start at $0$ and end at $5$.');
    assert.doesNotMatch(html, /katex-error/);
    assert.equal((html.match(/class="katex-display"/g) || []).length, 1);
    assert.equal((html.match(/<mtable /g) || []).length, 2);
    assert.equal((html.match(/<mtr>/g) || []).length, 8);
    assert.match(html, /Both coordinates start at/);
    assert.equal((html.match(/class="katex"/g) || []).length, 3);
  }
});
test('support LaTeX display and inline delimiters alongside prose', () => {
  const html = render(String.raw`The equation is \[` + equation + String.raw`\] so use \(M\).`);
  assert.doesNotMatch(html, /katex-error/);
  assert.equal((html.match(/class="katex"/g) || []).length, 2);
  assert.match(html, /The equation is/);
  assert.match(html, /so use/);
});
test('preserve math examples in code and escaped or incomplete delimiters', () => {
  for (const source of [
    '`$$' + equation + '$$`', '`` `\\[x\\]` ``',
    '```tex\n$$' + equation + '$$\n```\n', '~~~~\n\\[x\\]\n~~~\n~~~~\n',
    String.raw`Escaped \$$5 and \$$10.`, String.raw`Escaped \\[x\\].`,
    '$$unfinished', String.raw`\[unfinished`,
  ]) assert.equal(normalizeMathMarkdown(source), source);
  assert.equal(normalizeMathMarkdown('Plain **Markdown** and $x$.'), 'Plain **Markdown** and $x$.');
});
