import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bracketPairs } from '../src/latexEditor.js';

const partner = (text, at) => bracketPairs(text).get(typeof at === 'number' ? at : text.indexOf(at));
test('match LaTeX braces and brackets the way TeX reads them', () => {
  // A long argument containing display math and environments still pairs its braces.
  const answer = String.raw`\answer{Here \[ x = \frac{1}{2} \] and \begin{itemize}\item a\end{itemize}
}`;
  assert.equal(partner(answer, 7), answer.length - 1);
  // Escaped braces, comments and verbatim text do not count.
  assert.equal(bracketPairs(String.raw`\{ \} % { unmatched in a comment
\verb|{| \begin{verbatim}
}
\end{verbatim}`).size, 0);
  // Only braces must balance; ( and [ pair inside their group and are otherwise ignored.
  assert.equal(partner('{a', 0), -1);
  assert.equal(partner('a}', 1), -1);
  assert.equal(partner('[0, 1) and (a) item', '['), undefined);
  assert.equal(partner('(a) item', 0), 2);
  assert.equal(partner(String.raw`\textbf{a [b} c]`, '['), undefined);
  assert.equal(partner(String.raw`\section[short]{long}`, '['), 14);
});
