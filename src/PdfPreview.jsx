import React, { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerURL;

function PdfPage({ document, number, width, scrollRoot, onSourceClick }) {
  const container = useRef(null), canvas = useRef(null), textContainer = useRef(null);
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
  useEffect(() => {
    if (!page || !width) return;
    const target = textContainer.current;
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    target.style.setProperty('--total-scale-factor', viewport.scale);
    const layer = new TextLayer({ textContentSource: page.streamTextContent(), container: target, viewport });
    let cancelled = false;
    layer.render().then(() => { if (!cancelled) target.dataset.rendered = 'true'; }).catch(e => {
      if (!cancelled) setError(e.message);
    });
    return () => { cancelled = true; layer.cancel(); target.replaceChildren(); delete target.dataset.rendered; };
  }, [page, width]);
  const viewport = page?.getViewport({ scale: 1 });
  return <div className="pdf-page" ref={container} title="Double-click to jump to LaTeX source" style={{ width, height: width * (viewport ? viewport.height / viewport.width : 1.294) }} onDoubleClick={event=>{
      if(!page || !onSourceClick)return;
      const bounds=event.currentTarget.getBoundingClientRect();
      const view=page.getViewport({scale:1});
      const [x,y]=view.convertToPdfPoint((event.clientX-bounds.left)*view.width/bounds.width,(event.clientY-bounds.top)*view.height/bounds.height);
      onSourceClick({page:number,x,y:page.view[3]-y});
    }}>
    <canvas ref={canvas} role="img" aria-label={`PDF page ${number}`}/>
    <div className="pdf-text-layer" ref={textContainer}/>
    {error && <div className="pdf-error">{error}</div>}
  </div>;
}

export default function PdfPreview({ url, onSourceClick }) {
  const root = useRef(null);
  const [document, setDocument] = useState(null), [width, setWidth] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const target = root.current;
    let active = true;
    const observer = new ResizeObserver(() => { if (active) setWidth(Math.max(1, target.clientWidth - 24)); });
    observer.observe(target);
    return () => { active = false; observer.disconnect(); };
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
