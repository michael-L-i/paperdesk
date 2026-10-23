import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { resolveDestination, destinationTop, viewportRectangle } from './pdfLinks.js';
import workerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerURL;

// The word a double-click selected and the PDF text around it, so the server can find the word
// in the source when SyncTeX only knows the end of the enclosing macro argument.
function clickedWord(layer) {
  const selection = window.getSelection();
  if (!layer || !selection?.rangeCount || !layer.contains(selection.anchorNode)) return {};
  const range = selection.getRangeAt(0), walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  let text = '', start = -1, end = -1;
  for (let node; (node = walker.nextNode()); text += ' ') {
    if (node === range.startContainer) start = text.length + range.startOffset;
    if (node === range.endContainer) end = text.length + range.endOffset;
    text += node.data;
  }
  if (start < 0 || end < start) return {};
  return { word:text.slice(start, end), before:text.slice(Math.max(0, start-100), start), after:text.slice(end, end+100) };
}

function PdfPage({ page, width, visible, onReady, onError, onSourceClick, onLinkClick }) {
  const [links, setLinks] = useState([]);
  const canvas = useRef(null), textContainer = useRef(null);
  const number = page.pageNumber;
  useEffect(() => {
    if (!visible || !width) return;
    const viewport = page.getViewport({ scale: width / page.getViewport({ scale: 1 }).width });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const target = canvas.current, textTarget = textContainer.current;
    // Render into a detached canvas so resizing never clears the visible page.
    const buffer = document.createElement('canvas');
    buffer.width = Math.ceil(viewport.width * ratio);
    buffer.height = Math.ceil(viewport.height * ratio);
    const task = page.render({ canvasContext: buffer.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
    const layer = new TextLayerBuilder({ pdfPage: page });
    layer.div.classList.add('pdf-text-layer');
    layer.div.style.setProperty('--total-scale-factor', viewport.scale);
    let cancelled = false;
    Promise.all([task.promise, layer.render({ viewport }), page.getAnnotations({ intent:'display' })]).then(([, , annotations]) => {
      if (cancelled) return;
      target.width = buffer.width; target.height = buffer.height;
      target.getContext('2d').drawImage(buffer, 0, 0);
      target.dataset.rendered = 'true';
      layer.div.dataset.rendered = 'true';
      textTarget.replaceChildren(layer.div);
      setLinks(annotations.filter(a => a.subtype==='Link' && (a.dest || /^https?:|^mailto:|^tel:/i.test(a.url || ''))));
      onReady(number, width);
    }).catch(e => { if (!cancelled && e.name !== 'RenderingCancelledException') onError(e.message); });
    return () => { cancelled = true; task.cancel(); layer.cancel(); };
  }, [page, visible, width, onReady, onError]);
  const viewport = page.getViewport({ scale: 1 });
  return <div className="pdf-page" tabIndex={-1} title="Double-click to jump to LaTeX source" style={{ width, height: width * viewport.height / viewport.width }} onDoubleClick={event => {
    if (!onSourceClick || event.target.closest('a')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const [x,y] = viewport.convertToPdfPoint((event.clientX-bounds.left)*viewport.width/bounds.width, (event.clientY-bounds.top)*viewport.height/bounds.height);
    onSourceClick({ page:number, x, y:page.view[3]-y, ...clickedWord(textContainer.current.querySelector('.pdf-text-layer')) });
  }}>
    <canvas ref={canvas} role="img" aria-label={`PDF page ${number}`}/>
    <div className="pdf-text-host" ref={textContainer}/>
    <div className="pdf-links">
      {links.map(link => {
        const rect = viewportRectangle(viewport, link.rect);
        const label = link.dest ? `Go to reference ${link.overlaidText || link.contentsObj?.str || ''}`.trim() : link.url;
        return <a key={link.id} href={link.dest?'#'+encodeURIComponent(JSON.stringify(link.dest)):link.url}
          aria-label={label} title={label} target={link.dest?undefined:'_blank'} rel={link.dest?undefined:'noopener noreferrer'}
          style={{left:`${Math.min(rect[0],rect[2])/viewport.width*100}%`,top:`${Math.min(rect[1],rect[3])/viewport.height*100}%`,width:`${Math.abs(rect[2]-rect[0])/viewport.width*100}%`,height:`${Math.abs(rect[3]-rect[1])/viewport.height*100}%`}}
          onClick={link.dest?event=>{event.preventDefault();onLinkClick(link.dest);}:undefined}/>;
      })}
    </div>
  </div>;
}

// Each version owns its PDF worker and pages until its replacement is painted.
function PdfDocument({ url, current, width, scrollRoot, onReady, onError, onSourceClick }) {
  const documentRoot = useRef(null), pdfDocument = useRef(null), linkRequest = useRef(0);
  const [linkError, setLinkError] = useState('');
  const [pages, setPages] = useState([]), [painted, setPainted] = useState({});
  const [scroll, setScroll] = useState({ top:0, height:0 });
  useEffect(() => {
    let cancelled = false;
    const loading = getDocument({ url, isEvalSupported:false });
    loading.promise.then(async pdf => {
      const next = await Promise.all(Array.from({ length:pdf.numPages }, (_,i) => pdf.getPage(i+1)));
      if (!cancelled) { pdfDocument.current=pdf; setPages(next); }
    }).catch(e => { if (!cancelled) onError(e.message); });
    return () => { cancelled = true; pdfDocument.current=null; linkRequest.current++; loading.destroy().catch(() => {}); };
  }, [url, onError]);
  useEffect(() => {
    const root = scrollRoot.current;
    const update = () => setScroll({ top:root.scrollTop, height:root.clientHeight });
    update();
    root.addEventListener('scroll', update, { passive:true });
    const observer = new ResizeObserver(update); observer.observe(root);
    return () => { root.removeEventListener('scroll', update); observer.disconnect(); };
  }, [scrollRoot]);
  const followLink = useCallback(async destination => {
    const request = ++linkRequest.current;
    setLinkError('');
    try {
      const { index, dest } = await resolveDestination(pdfDocument.current, destination);
      // A compile or a second click may replace this document while resolving a named target.
      const host = documentRoot.current;
      if (request!==linkRequest.current || !host?.isConnected || host.inert) return;
      const target = host.querySelectorAll('.pdf-page')[index];
      const top = destinationTop(pages[index], target.clientWidth, dest);
      scrollRoot.current.scrollTo({ top:target.offsetTop + Math.max(0,top) - 12, behavior:'instant' });
      target.focus({ preventScroll:true });
    } catch (e) {
      if (request===linkRequest.current && documentRoot.current?.isConnected && !documentRoot.current.inert) setLinkError(e.message);
    }
  }, [pages, scrollRoot]);
  const markReady = useCallback((number, size) => setPainted(p => ({ ...p, [number]:size })), []);
  const heights = pages.map(page => { const v=page.getViewport({ scale:1 }); return width*v.height/v.width; });
  const total = heights.reduce((sum,h) => sum+h+12, 12);
  // When the new PDF is shorter, prepare the pages at its clamped scroll position.
  const top = Math.min(scroll.top, Math.max(0,total-scroll.height));
  let offset = 12;
  const visible = heights.map(height => { const show=offset+height>=top-600 && offset<=top+scroll.height+600; offset+=height+12; return show; });
  const ready = width>0 && pages.length>0 && visible.every((show,i) => !show || painted[i+1]===width);
  useEffect(() => { if (!current && ready) onReady(url); }, [current, ready, url, onReady]);
  return <div ref={documentRoot} className={`pdf-document${current?'':' pdf-pending'}`} aria-hidden={!current} inert={!current}>
    {pages.map((page,i) => <PdfPage key={page.pageNumber} page={page} width={width} visible={visible[i] || painted[i+1]!==undefined} onReady={markReady} onError={onError} onSourceClick={onSourceClick} onLinkClick={followLink}/>)}
    {linkError && <div className="pdf-link-error" role="status">Could not follow PDF link: {linkError}</div>}
  </div>;
}

export default function PdfPreview({ url, onSourceClick }) {
  const root = useRef(null), savedScroll = useRef(null), requested = useRef(url);
  requested.current = url;
  const [displayed, setDisplayed] = useState(null), [width, setWidth] = useState(0), [error, setError] = useState('');
  useEffect(() => {
    const target = root.current;
    const observer = new ResizeObserver(() => setWidth(Math.max(1,target.clientWidth-24)));
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setError(''), [url]);
  const reveal = useCallback(next => {
    if (next !== requested.current) return;
    savedScroll.current = root.current.scrollTop;
    setDisplayed(next);
  }, []);
  useLayoutEffect(() => {
    if (savedScroll.current !== null) { root.current.scrollTop=savedScroll.current; savedScroll.current=null; }
  }, [displayed]);
  const versions = displayed===url ? [url] : [displayed,url].filter(Boolean);
  return <div className="pdf-pages" ref={root} role="region" aria-label="Compiled PDF" data-url={displayed || ''} data-requested-url={url}>
    {versions.map(version => <PdfDocument key={version} url={version} current={version===displayed} width={width} scrollRoot={root} onReady={reveal} onError={setError} onSourceClick={displayed===url?onSourceClick:undefined}/>)}
    {error && <div className="pdf-error">Could not display PDF: {error}</div>}
    {!displayed && !error && <div className="empty">Loading PDF…</div>}
  </div>;
}
