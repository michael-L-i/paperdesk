import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerURL;

function PdfPage({ document, number, width, scrollRoot, onSourceClick }) {
  const container = useRef(null), canvas = useRef(null);
  const [page, setPage] = useState(null), [visible, setVisible] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    document.getPage(number).then(p => { if (!cancelled) setPage(p); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [document, number]);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setVisible(entries[0].isIntersecting), { root: scrollRoot.current, rootMargin: '600px' });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [scrollRoot]);
  useEffect(() => {
    if (!page || !visible || !width) return;
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const target = canvas.current;
    target.width = Math.ceil(viewport.width * ratio);
    target.height = Math.ceil(viewport.height * ratio);
    const task = page.render({ canvasContext: target.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    let cancelled = false;
    task.promise.then(() => { if (!cancelled) target.dataset.rendered = 'true'; }).catch(e => {
      if (!cancelled && e.name !== 'RenderingCancelledException') setError(e.message);
    });
    return () => { cancelled = true; task.cancel(); delete target.dataset.rendered; target.width = 0; target.height = 0; };
  }, [page, visible, width]);
  const viewport = page?.getViewport({ scale: 1 });
  return <div className="pdf-page" ref={container} style={{ width, height: width * (viewport ? viewport.height / viewport.width : 1.294) }}>
    <canvas ref={canvas} title="Click to jump to LaTeX source" onClick={event=>{
      if(!page || !onSourceClick)return;
      const bounds=event.currentTarget.getBoundingClientRect();
      const view=page.getViewport({scale:1});
      const [x,y]=view.convertToPdfPoint((event.clientX-bounds.left)*view.width/bounds.width,(event.clientY-bounds.top)*view.height/bounds.height);
      onSourceClick({page:number,x,y:page.view[3]-y});
    }} role="img" aria-label={`PDF page ${number}`}/>
    {error && <div className="pdf-error">{error}</div>}
  </div>;
}

export default function PdfPreview({ url, onSourceClick }) {
  const root = useRef(null);
  const [document, setDocument] = useState(null), [width, setWidth] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const observer = new ResizeObserver(() => setWidth(Math.max(1, root.current.clientWidth - 24)));
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setError(''); setDocument(null);
    const loading = getDocument({ url, isEvalSupported: false });
    loading.promise.then(pdf => { if (!cancelled) setDocument(pdf); }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; loading.destroy().catch(() => {}); };
  }, [url]);
  return <div className="pdf-pages" ref={root} role="region" aria-label="Compiled PDF" data-url={url}>
    {error ? <div className="pdf-error">Could not display PDF: {error}</div> : document ?
      Array.from({ length: document.numPages }, (_, i) => <PdfPage key={i} document={document} number={i + 1} width={width} scrollRoot={root} onSourceClick={onSourceClick}/>) : <div className="empty">Loading PDF…</div>}
  </div>;
}
