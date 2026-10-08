export function viewportRectangle(viewport, [x1,y1,x2,y2]) {
  return [...viewport.convertToViewportPoint(x1,y1), ...viewport.convertToViewportPoint(x2,y2)];
}

// PDF destinations use zero-based page indexes or indirect page references.
export async function resolveDestination(pdf, destination) {
  const dest = typeof destination === 'string' ? await pdf.getDestination(destination) : destination;
  if (!Array.isArray(dest)) throw new Error('This reference has no destination.');
  const ref = dest[0];
  const index = Number.isInteger(ref) ? ref : ref && typeof ref === 'object' ? await pdf.getPageIndex(ref) : -1;
  if (index < 0 || index >= pdf.numPages) throw new Error('This reference points to a missing page.');
  return { index, dest };
}

// Keep the reader's zoom, but honor the target coordinates (including rotated pages).
export function destinationTop(page, width, dest) {
  const viewport = page.getViewport({ scale:width / page.getViewport({ scale:1 }).width });
  const [left, bottom, right, top] = page.view;
  switch (dest[1]?.name) {
    case 'XYZ': return viewport.convertToViewportPoint(dest[2] ?? left, dest[3] ?? top)[1];
    case 'FitH': case 'FitBH': return viewport.convertToViewportPoint(left, dest[2] ?? top)[1];
    case 'FitV': case 'FitBV': {
      const rect = viewportRectangle(viewport, [dest[2] ?? left, bottom, right, top]);
      return Math.min(rect[1], rect[3]);
    }
    case 'FitR': {
      const rect = viewportRectangle(viewport, dest.slice(2,6));
      return Math.min(rect[1], rect[3]);
    }
    default: return 0;
  }
}
