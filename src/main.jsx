import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { FolderOpen, RefreshCw, X, ArrowUp, ChevronUp, ChevronDown, ChevronRight, FilePlus, Download, MoreHorizontal, Paperclip, FileText, Image, House, Plus, Trash2, Star, Upload, PanelLeft, File, Folder } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import './style.css';
import PdfPreview from './PdfPreview.jsx';
const extensions = [StreamLanguage.define(stex), EditorView.lineWrapping];
const textFile = name => /\.(tex|bib|sty|cls|bst|txt|md)$/i.test(name);
// The document a file belongs to: its `% !TEX root`, itself if it has \documentclass, else null.
function documentRoot(file, text) {
  const magic = text.match(/^\s*%\s*!\s*TEX\s+root\s*=\s*(.+?)\s*$/im)?.[1];
  if (magic) return decodeURIComponent(new URL(magic, 'file:///' + file).pathname.slice(1));
  return /^\s*\\documentclass\b/m.test(text) ? file : null;
}
// Agent replies render like ChatGPT: GitHub Markdown with KaTeX math.
const markdown = { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [rehypeKatex], components: {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noreferrer"/>,
  table: ({ node, ...props }) => <div className="table-wrap"><table {...props}/></div>,
} };
async function api(url, body, method = 'POST') {
  const res = await fetch('/api' + url, body === undefined ? {} : { method, headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
// Folders start collapsed, except those leading to the open file. Dropped files upload into the folder under them.
function FileTree({ files, open, main, disabled, onOpen, onMain, onNew, onUpload, uploadInput }) {
  const [expanded,setExpanded]=useState(()=>new Set());
  useEffect(()=>{
    const parts=open?.split('/').slice(0,-1)||[];
    if(parts.length) setExpanded(set=>new Set([...set,...parts.map((_,i)=>parts.slice(0,i+1).join('/')+'/')]));
  },[open]);
  const tree={};
  for(const file of files){
    let node=tree;const parts=file.split('/');
    for(const part of parts.slice(0,-1)) node=node[part+'/']??={};
    node[parts.at(-1)]=file;
  }
  const drop=(e,folder)=>{if(!e.dataTransfer.files.length||disabled)return;e.preventDefault();e.stopPropagation();onUpload([...e.dataTransfer.files],folder);};
  const rows=(node,folder,depth)=>Object.keys(node).sort((a,b)=>Number(b.endsWith('/'))-Number(a.endsWith('/'))||a.localeCompare(b)).map(name=>{
    const indent={paddingLeft:8+depth*14};
    if(name.endsWith('/')){
      const key=folder+name, shown=expanded.has(key);
      return <React.Fragment key={key}>
        <button className="tree-row" style={indent} aria-expanded={shown} onClick={()=>setExpanded(set=>{const next=new Set(set);if(shown)next.delete(key);else next.add(key);return next;})} onDrop={e=>drop(e,key)}>{shown?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<span>{name.slice(0,-1)}</span></button>
        {shown&&rows(node[name],key,depth+1)}
      </React.Fragment>;
    }
    const file=node[name];
    return <div key={file} className={'tree-row'+(file===open?' active':'')+(file===main?' main':'')} data-path={file}>
      <button style={indent} disabled={disabled||!textFile(file)} title={file} onClick={()=>onOpen(file)}>{textFile(file)?<FileText size={13}/>:<File size={13}/>}<span>{name}</span></button>
      {file===main?<Star size={12} className="main-star" role="img" aria-label="Main document"/>:file.endsWith('.tex')&&<button className="set-main" aria-label={'Set '+file+' as main document'} title="Set as main document" disabled={disabled} onClick={()=>onMain(file)}><Star size={12}/></button>}
    </div>;
  });
  return <nav className="tree" aria-label="Project files" onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>drop(e,'')}>
    <div className="panel-title"><span>Files</span><div className="spacer"/>
      <button aria-label="New file" title="New file" disabled={disabled} onClick={onNew}><FilePlus size={14}/></button>
      <button aria-label="Upload files" title="Upload files" disabled={disabled} onClick={()=>uploadInput.current.click()}><Upload size={14}/></button>
      <input ref={uploadInput} type="file" multiple hidden onChange={e=>{onUpload([...e.target.files]);e.target.value='';}}/>
    </div>
    <div className="tree-rows">{rows(tree,'',0)}</div>
  </nav>;
}
function Editor({ id, go }) {
  const [project,setProject]=useState(null), [files,setFiles]=useState(null), [mainFile,setMainFile]=useState(null);
  const [treeOpen,setTreeOpen]=useState(()=>localStorage.getItem('paperdesk:tree')!=='false');
  const [doc,setDoc]=useState(null), [text,setText]=useState(''), [status,setStatus]=useState('');
  const [autoCompile,setAutoCompile]=useState(()=>localStorage.getItem('paperdesk:autoCompile')!=='false');
  const [pdf,setPdf]=useState(null), [compiling,setCompiling]=useState(false), [error,setError]=useState('');
  const [dialog,setDialog]=useState(null), [newName,setNewName]=useState('main.tex');
  const [historyOpen,setHistoryOpen]=useState(false), [prompt,setPrompt]=useState(''), [attachments,setAttachments]=useState([]);
  const [historyHeight,setHistoryHeight]=useState(180), [resizing,setResizing]=useState(false);
  const historyDrag=useRef(null), thread=useRef(null), composer=useRef(null);
  const [job,setJob]=useState(null), [starting,setStarting]=useState(false), [messages,setMessages]=useState([]), [activity,setActivity]=useState('');
  const [menu,setMenu]=useState(false), [style,setStyle]=useState(''), [examples,setExamples]=useState(0), [history,setHistory]=useState([]);
  const editorView=useRef(null), primaryFile=useRef(null), fileInput=useRef(null), uploadInput=useRef(null);
  const state=useRef({doc:null,text:'',files:[]}), saves=useRef(Promise.resolve()), building=useRef(false), attemptedBuild=useRef('');
  state.current={doc,text,files:files||[]};
  const aiBusy=!!job || starting;
  const fail=e=>setError(e.message);
  const call=(url,body,method)=>api('/projects/'+id+url,body,method);
  const fileURL=(path,version='')=>'/api/projects/'+id+'/pdf?path='+encodeURIComponent(path)+'&v='+version;
  const draftKey=file=>'paperdesk:draft:'+id+':'+file;
  function accept(next, recover=false) {
    const draft=recover ? localStorage.getItem(draftKey(next.path)) : null;
    const value=draft ?? next.text;
    state.current.doc=next; state.current.text=value;
    setDoc(next);setText(value);setStatus(value===next.text?'Saved':'Unsaved');
  }
  // The main document is what compiles and shows in the PDF pane, whichever file is open.
  function setMain(file, list=state.current.files) {
    primaryFile.current=file;attemptedBuild.current='';setMainFile(file);
    call('',{mainFile:file},'PATCH').catch(()=>{});
    const output=file.replace(/\.tex$/,'.pdf');
    setPdf(list.includes(output)?{path:output,version:Date.now(),revision:null}:null);
  }
  function change(value) {
    state.current.text=value;setText(value);setStatus('Unsaved');
    if(state.current.doc) localStorage.setItem(draftKey(state.current.doc.path),value);
  }
  async function save(origin='human') {
    const operation=saves.current.catch(()=>{}).then(async()=>{
      const current=state.current;
      if(!current.doc || current.doc.text===current.text) return current.doc;
      setStatus('Saving…');
      try {
        const saved=await call('/document',{path:current.doc.path,text:current.text,revision:current.doc.revision,origin},'PUT');
        if(state.current.doc?.path===saved.path) {
          state.current.doc=saved;setDoc(saved);setStatus(state.current.text===saved.text?'Saved':'Unsaved');
          if(state.current.text===saved.text) localStorage.removeItem(draftKey(saved.path));
        }
        return saved;
      } catch(e) {setStatus('Save failed');throw e;}
    });
    saves.current=operation;return operation;
  }
  async function refreshFiles() {
    const list=await call('/files');
    setFiles(list);state.current.files=list;return list;
  }
  // Opening a document makes it the main one; opening a fragment such as a chapter or .bib keeps it.
  async function openFile(file, recover=true) {
    const saved=await save();
    const next=await call('/document?path='+encodeURIComponent(file));
    accept(next,recover);
    const root=documentRoot(next.path,next.text);
    if(root && root!==primaryFile.current) setMain(root);
    // A PDF built after the last save is still current for the newly opened file.
    else setPdf(p=>p&&saved&&p.editorPath===saved.path&&p.editorRevision===saved.revision?{...p,editorPath:next.path,editorRevision:next.revision}:p);
    setError('');
  }
  useEffect(()=>{
    (async()=>{
      const opened=await call('',{},'PATCH');setProject(opened);
      const list=await refreshFiles(), tex=list.filter(f=>f.endsWith('.tex'));
      const main=[opened.mainFile,'main.tex'].find(f=>tex.includes(f)) || tex.find(f=>!f.includes('/'));
      if(main){setMain(main,list);await openFile(main);}
      try{const pending=JSON.parse(sessionStorage.getItem('paperdesk:task'));if(pending?.project===id)setJob(pending);}catch{}
    })().catch(fail);
  },[]);
  useEffect(()=>{document.title=project?project.name+' · Paperdesk':'Paperdesk';},[project]);
  async function home(){try{await save();go('/');}catch(e){fail(e);}}
  useEffect(()=>{
    if(!doc || text===doc.text || status==='Save failed' || aiBusy) return;
    const timer=setTimeout(()=>save().catch(fail),700);return()=>clearTimeout(timer);
  },[doc,text,status,aiBusy]);
  async function jumpToSource(location) {
    if(!pdf || aiBusy)return;
    const snapshot=state.current;
    if(snapshot.text!==snapshot.doc?.text || pdf.editorPath!==snapshot.doc?.path || pdf.editorRevision!==snapshot.doc?.revision){setError('The preview is out of date. Wait for compilation or click Compile before jumping to source.');return;}
    try {
      const match=await call('/inverse-search',{path:pdf.path.replace(/\.pdf$/,'.tex'),revision:pdf.revision,...location});
      if(state.current.doc!==snapshot.doc || state.current.text!==snapshot.text)return;
      if(match.path!==snapshot.doc.path){
        const next=await call('/document?path='+encodeURIComponent(match.path));
        if(state.current.doc!==snapshot.doc || state.current.text!==snapshot.text)return;
        accept(next);
        setPdf(p=>({...p,editorPath:next.path,editorRevision:next.revision}));
      }
      requestAnimationFrame(()=>{
        const view=editorView.current;
        if(!view)return;
        const line=view.state.doc.line(Math.max(1,Math.min(match.line,view.state.doc.lines)));
        view.dispatch({selection:{anchor:line.from,head:line.to},effects:EditorView.scrollIntoView(line.from,{y:'center'})});
        view.focus();setError('');
      });
    }catch(e){fail(e);}
  }
  async function compile() {
    if(building.current || !state.current.doc || !primaryFile.current) return;
    attemptedBuild.current=state.current.doc.path+':'+state.current.doc.revision;
    building.current=true;setCompiling(true);
    try {
      const saved=await save();
      attemptedBuild.current=saved.path+':'+saved.revision;
      const primary=primaryFile.current===saved.path?saved:await call('/document?path='+encodeURIComponent(primaryFile.current));
      const result=await call('/compile',{path:primary.path,revision:primary.revision});
      if(!state.current.files.includes(result.pdf)) refreshFiles().catch(()=>{});
      if(primaryFile.current===primary.path) {setError('');setPdf({path:result.pdf,version:Date.now(),revision:result.revision,engine:result.engine,editorPath:saved.path,editorRevision:saved.revision});}
    }catch(e){fail(e);}finally{building.current=false;setCompiling(false);}
  }
  useEffect(()=>{
    if(!autoCompile || !doc || status!=='Saved' || aiBusy || compiling || (pdf?.editorPath===doc.path&&pdf?.editorRevision===doc.revision)) return;
    if(attemptedBuild.current===doc.path+':'+doc.revision)return;
    const timer=setTimeout(compile,1000);return()=>clearTimeout(timer);
  },[doc?.path,doc?.revision,status,aiBusy,compiling,autoCompile]);
  useEffect(()=>{
    const key=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();save().catch(fail);}
      if((e.metaKey||e.ctrlKey)&&e.key==='Enter' && e.target.tagName!=='TEXTAREA'){e.preventDefault();compile();}
    };
    const leave=e=>{if(state.current.doc && state.current.text!==state.current.doc.text){e.preventDefault();e.returnValue='';}};
    window.addEventListener('keydown',key);window.addEventListener('beforeunload',leave);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('beforeunload',leave);};
  });
  // Files upload as soon as they are attached; each request sends their IDs.
  function attach(files) {
    for(const file of files){
      const key=crypto.randomUUID();
      setAttachments(a=>[...a,{key,name:file.name}]);
      fetch('/api/uploads?name='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file})
        .then(async res=>{const result=await res.json();if(!res.ok)throw new Error(result.error||'Upload failed.');setAttachments(a=>a.map(x=>x.key===key?{...x,...result}:x));})
        .catch(e=>{setAttachments(a=>a.filter(x=>x.key!==key));fail(e);});
    }
  }
  function detach(item) {
    setAttachments(a=>a.filter(x=>x.key!==item.key));
    if(item.id) api('/uploads/'+item.id,{},'DELETE').catch(()=>{});
  }
  const uploading=attachments.some(a=>!a.id);
  async function send() {
    if(!files || !prompt.trim() || aiBusy || uploading)return;
    setStarting(true);setError('');
    try {
      const saved=await save();
      const primary=primaryFile.current&&primaryFile.current!==saved?.path?await call('/document?path='+encodeURIComponent(primaryFile.current)):saved;
      const request=await call('/task',{path:primary?.path,revision:primary?.revision,attachments:attachments.map(a=>a.id),history:messages.map(({role,text})=>({role,text})),instruction:prompt});
      const pending={id:request.id,project:id};
      setMessages(m=>[...m,{role:'You',text:prompt,files:attachments.map(({name,kind})=>({name,kind}))}]);setPrompt('');setAttachments([]);setJob(pending);setHistoryOpen(true);
      sessionStorage.setItem('paperdesk:task',JSON.stringify(pending));
    }catch(e){fail(e);}finally{setStarting(false);}
  }
  // Enter sends; Shift, ⌘, or Ctrl with Enter adds a line.
  function composerKey(e) {
    if(e.key!=='Enter' || e.shiftKey || e.nativeEvent.isComposing)return;
    e.preventDefault();
    if(e.metaKey||e.ctrlKey){const t=e.currentTarget;t.setRangeText('\n',t.selectionStart,t.selectionEnd,'end');setPrompt(t.value);}
    else send();
  }
  // The composer grows with its text; the thread follows the latest message.
  useLayoutEffect(()=>{
    const t=composer.current;if(!t)return;
    t.style.height='auto';t.style.height=Math.min(t.scrollHeight,160)+'px';
  },[prompt]);
  useEffect(()=>{thread.current?.scrollTo({top:thread.current.scrollHeight});},[messages,aiBusy,historyOpen]);
  useEffect(()=>{
    if(!job)return;
    let stopped=false,fetching=false;
    const poll=async()=>{
      if(fetching)return;fetching=true;
      try {
        const result=await api('/jobs/'+job.id);
        if(stopped)return;
        if(result.status==='error')throw new Error(result.error);
        setActivity(result.activity||'');
        if(result.status==='done') {
          if(result.result.latex) {
            const next=await api('/tasks/'+job.id+'/apply',{});
            if(stopped)return;
            await refreshFiles();await openFile(next.path,false);
          }
          if(result.result.style){setStyle(result.result.style);setDialog('style');}
          setMessages(m=>[...m,{role:'Agent',text:result.result.message}]);setHistoryOpen(true);setJob(null);sessionStorage.removeItem('paperdesk:task');
        }
      }catch(e){if(!stopped){fail(e);setJob(null);sessionStorage.removeItem('paperdesk:task');}}
      finally{fetching=false;}
    };
    poll();const timer=setInterval(poll,1200);return()=>{stopped=true;clearInterval(timer);setActivity('');};
  },[job]);
  async function createFile() {
    try{await save();const next=await call('/new-document',{name:newName.trim()});await refreshFiles();await openFile(next.path,false);setDialog(null);}catch(e){fail(e);}
  }
  async function upload(list, folder='') {
    try {
      for(const file of list){
        const res=await fetch('/api/projects/'+id+'/upload?path='+encodeURIComponent(folder+file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
        if(!res.ok)throw new Error((await res.json()).error||'Upload failed.');
      }
    }catch(e){fail(e);}
    await refreshFiles().catch(fail);
  }
  async function suggestStyle(){
    try{const saved=await save();const request=await call('/style/suggest',{path:saved.path,revision:saved.revision,instruction:'Suggest an updated writing profile from my edits.'});const pending={id:request.id,project:id};setJob(pending);sessionStorage.setItem('paperdesk:task',JSON.stringify(pending));setDialog(null);setHistoryOpen(true);}catch(e){fail(e);}
  }
  async function loadHistory(){setMenu(false);try{setHistory(await call('/history?path='+encodeURIComponent(doc.path)));setDialog('history');}catch(e){fail(e);}}
  async function loadStyle(){setMenu(false);try{const s=await api('/style');setStyle(s.text);setExamples(s.examples);setDialog('style');}catch(e){fail(e);}}
  async function reloadDisk(){try{const latest=await call('/document?path='+encodeURIComponent(doc.path));accept(latest);localStorage.removeItem(draftKey(latest.path));setError('');}catch(e){fail(e);}}
  function downloadDraft(){const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='draft.tex';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  return <div className="app">
    <header>
      <button aria-label="All projects" title="All projects" disabled={aiBusy} onClick={home}><House size={16}/></button>
      <span className="project-name" title={project?.path}>{project?.name}</span>
      <span className="separator"/>
      <button aria-label={treeOpen?'Hide files':'Show files'} title={treeOpen?'Hide files':'Show files'} aria-pressed={treeOpen} onClick={()=>{setTreeOpen(!treeOpen);localStorage.setItem('paperdesk:tree',String(!treeOpen));}}><PanelLeft size={15}/></button>
      <span className="status">{status}</span>
      <div className="spacer"/>
      
      <button disabled={!doc||compiling||aiBusy} onClick={()=>{setError('');compile();}}><RefreshCw size={14}/>Compile</button>
      <div className="menu-wrap"><button aria-label="More" onClick={()=>setMenu(!menu)}><MoreHorizontal size={18}/></button>{menu&&<div className="menu"><button role="menuitemcheckbox" aria-checked={autoCompile} onClick={()=>{const next=!autoCompile;setAutoCompile(next);localStorage.setItem('paperdesk:autoCompile',String(next));setMenu(false);}}>Auto-compile: {autoCompile?'on':'off'}</button><button disabled={!doc||aiBusy} onClick={loadHistory}>History</button><button onClick={loadStyle}>Writing style</button><button disabled={!files||aiBusy} onClick={()=>{refreshFiles().catch(fail);setMenu(false);}}>Refresh files</button></div>}</div>
    </header>
    {error&&<div className="error" role="alert"><details><summary>{error.split('\n')[0].slice(0,180)}</summary><pre>{error}</pre></details>{status==='Save failed'&&<><button onClick={downloadDraft}>Download draft</button><button onClick={reloadDisk}>Use disk version</button></>}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
    <main className={treeOpen?'with-tree':''}>
      {treeOpen&&<FileTree files={files||[]} open={doc?.path} main={mainFile} disabled={aiBusy} onOpen={file=>openFile(file).catch(fail)} onMain={file=>{setError('');setMain(file);}} onNew={()=>{setNewName('');setDialog('new');}} onUpload={upload} uploadInput={uploadInput}/>}
      <section className="left"><div className="panel-title">{doc?.path||'LaTeX'}</div><div className="editor">{doc?<CodeMirror onCreateEditor={view=>{editorView.current=view;}} className="latex-editor" value={text} height="100%" extensions={extensions} onChange={change} editable={!aiBusy} basicSetup={{foldGutter:true,highlightActiveLine:true}}/>:<div className="empty">{files?'Select a .tex file or ask the agent to create one.':''}</div>}</div>
      <section className={'agent'+(resizing?' resizing':'')} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(!e.dataTransfer.files.length||!files)return;e.preventDefault();attach([...e.dataTransfer.files]);}}>
        {historyOpen&&<div className="agent-resizer" role="separator" aria-label="Resize chat history" aria-orientation="horizontal" aria-valuemin={48} aria-valuemax={500} aria-valuenow={historyHeight} tabIndex={0} onPointerDown={e=>{historyDrag.current={y:e.clientY,height:historyHeight};e.currentTarget.setPointerCapture(e.pointerId);setResizing(true);}} onPointerMove={e=>{if(historyDrag.current)setHistoryHeight(Math.max(48,Math.min(500,historyDrag.current.height+historyDrag.current.y-e.clientY)));}} onLostPointerCapture={()=>{historyDrag.current=null;setResizing(false);}} onKeyDown={e=>{if(["ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();setHistoryHeight(h=>Math.max(48,Math.min(500,h+(e.key==="ArrowUp"?20:-20))));}}}/>}
        <div className="agent-title" onClick={()=>setHistoryOpen(!historyOpen)}><span>Agent</span><span className="status">{aiBusy&&!historyOpen?activity||'Working…':''}</span><div className="spacer"/><button aria-label={historyOpen?"Collapse chat history":"Expand chat history"} aria-expanded={historyOpen}>{historyOpen?<ChevronDown size={14}/>:<ChevronUp size={14}/>}</button></div>
        <div className="thread" ref={thread} style={{height:historyOpen?historyHeight:0}} inert={!historyOpen}><div className="thread-inner">
          {!messages.length&&!aiBusy&&<p className="thread-empty">Ask about anything in this folder, request an edit, or attach a file.</p>}
          {messages.map((m,i)=><div key={i} className={m.role==='You'?'message user':'message'}>{m.files?.length>0&&<div className="message-files">{m.files.map((f,j)=><span key={j} className="attachment">{f.kind==='image'?<Image size={12}/>:<FileText size={12}/>}<span>{f.name}</span></span>)}</div>}{m.role==='You'?<p>{m.text}</p>:<div className="markdown"><Markdown {...markdown}>{m.text}</Markdown></div>}</div>)}
          {aiBusy&&<div className="thinking" role="status" aria-label="Agent is working"><span className="dots"><i/><i/><i/></span>{activity}</div>}
        </div></div>
        <div className="composer" onClick={e=>{if(e.target===e.currentTarget)composer.current?.focus();}}>
          {attachments.length>0&&<div className="attachments">{attachments.map(a=><span key={a.key} className={'attachment'+(a.id?'':' uploading')} title={a.id?a.name:'Uploading '+a.name}>{a.kind==='image'?<Image size={12}/>:<FileText size={12}/>}<span>{a.name}</span><button aria-label={'Remove '+a.name} onClick={()=>detach(a)}><X size={12}/></button></span>)}</div>}
          <textarea ref={composer} rows={1} aria-label="Agent request" placeholder="Ask anything or request an edit…" disabled={!files} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={composerKey} onPaste={e=>{if(e.clipboardData.files.length&&!e.clipboardData.getData('text/plain')){e.preventDefault();attach([...e.clipboardData.files]);}}}/>
          <div className="composer-actions"><button className="attach" aria-label="Attach files" title="Attach files" disabled={!files} onClick={()=>fileInput.current.click()}><Paperclip size={16}/></button><input ref={fileInput} type="file" multiple hidden onChange={e=>{attach([...e.target.files]);e.target.value='';}}/><div className="spacer"/><button className="send" aria-label="Send to Agent" title="Send (Enter)" disabled={!prompt.trim()||!files||aiBusy||uploading} onClick={send}><ArrowUp size={16}/></button></div>
        </div>
      </section>
      </section>
      <section className="right"><div className="panel-title"><span>PDF{pdf?.engine&&' · '+pdf.engine}</span><div className="spacer"/><span className="status">{compiling?'Compiling…':pdf&&(pdf.editorPath!==doc?.path||pdf.editorRevision!==doc?.revision)?'Out of date':''}</span>{pdf&&<a href={fileURL(pdf.path,pdf.version)} download aria-label="Download PDF"><Download size={14}/></a>}</div><div className="preview">{pdf?<PdfPreview key={pdf.path} url={fileURL(pdf.path,pdf.version)} onSourceClick={jumpToSource}/>:<div className="empty">{compiling?'Compiling…':'No compiled PDF.'}</div>}</div></section>
    </main>
    {dialog&&<div className="backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label={dialog==='new'?'New file':dialog==='style'?'Writing style':'History'}><div className="dialog-title"><strong>{dialog==='new'?'New file':dialog==='style'?'Writing style':'History'}</strong><button aria-label="Close dialog" onClick={()=>setDialog(null)}><X size={16}/></button></div>
    {dialog==='new'&&<form onSubmit={e=>{e.preventDefault();createFile();}}><input autoFocus aria-label="Filename" placeholder="chapters/intro.tex or refs.bib" value={newName} onChange={e=>setNewName(e.target.value)}/><div className="dialog-bottom"><div className="spacer"/><button className="primary" type="submit" disabled={!newName.trim()}>Create</button></div></form>}
    {dialog==='style'&&<><textarea aria-label="Writing profile" className="style-editor" value={style} onChange={e=>setStyle(e.target.value)} placeholder="Writing preferences"/><div className="dialog-bottom"><span className="muted">{examples} saved edit examples</span><button disabled={!doc||aiBusy||!examples} onClick={suggestStyle}>Suggest notes</button><button onClick={async()=>{try{await api('/style/examples',{},'DELETE');setExamples(0);}catch(e){fail(e);}}}>Clear examples</button><button className="primary" onClick={async()=>{try{await api('/style',{text:style},'PUT');setDialog(null);}catch(e){fail(e);}}}>Save</button></div></>}
    {dialog==='history'&&<div className="history">{history.length?history.map(v=><button key={v.id} onClick={async()=>{try{await save();change(v.text);await save('restore');setDialog(null);}catch(e){fail(e);}}}>{new Date(v.date).toLocaleString()}<span>Restore</span></button>):<span className="muted">No saved versions.</span>}</div>}
    </section></div>}
  </div>;
}
const since=new Intl.RelativeTimeFormat(undefined,{numeric:'auto'});
function ago(date) {
  const seconds=(new Date(date)-Date.now())/1000;
  for(const [unit,size] of [['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60]])
    if(Math.abs(seconds)>=size) return since.format(Math.round(seconds/size),unit);
  return 'just now';
}
// Recent projects first, like Overleaf's dashboard.
function Home({ go }) {
  const [projects,setProjects]=useState(null), [query,setQuery]=useState(''), [error,setError]=useState('');
  const [menu,setMenu]=useState(false), [naming,setNaming]=useState(false), [name,setName]=useState('');
  const fail=e=>setError(e.message);
  const load=()=>api('/projects').then(setProjects,fail);
  useEffect(()=>{document.title='Paperdesk';load();},[]);
  async function openFolder() {
    setMenu(false);setError('');
    try{const picked=await api('/choose-directory',{});if(!picked.cancelled)go('/p/'+(await api('/projects',{path:picked.path})).id);}catch(e){fail(e);}
  }
  async function create(e) {
    e.preventDefault();
    try{go('/p/'+(await api('/projects',{name})).id);}catch(e){fail(e);}
  }
  async function remove(p) {
    if(p.kind==='library' && !confirm(`Move “${p.name}” to the Trash?`))return;
    try{await api('/projects/'+p.id,{},'DELETE');await load();}catch(e){fail(e);}
  }
  const shown=projects?.filter(p=>p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="app">
    <header>
      <img src="/favicon.svg" alt="" width={18} height={18}/><strong className="brand">Paperdesk</strong>
      <div className="spacer"/>
      <div className="menu-wrap"><button className="primary" onClick={()=>setMenu(!menu)}><Plus size={14}/>New project</button>{menu&&<div className="menu">
        <button onClick={()=>{setMenu(false);setName('');setNaming(true);}}>Blank project</button>
        <button onClick={openFolder}>Open folder…</button>
      </div>}</div>
    </header>
    {error&&<div className="error" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
    <main className="projects"><div className="projects-inner">
      <div className="projects-top"><h1>Projects</h1><input type="search" aria-label="Search projects" placeholder="Search projects" value={query} onChange={e=>setQuery(e.target.value)}/></div>
      {shown&&(shown.length?<table>
        <thead><tr><th>Name</th><th className="location">Location</th><th>Last opened</th><th/></tr></thead>
        <tbody>{shown.map(p=><tr key={p.id}>
          <td><a href={'/p/'+p.id} onClick={e=>{if(e.metaKey||e.ctrlKey)return;e.preventDefault();go('/p/'+p.id);}}>{p.name}</a></td>
          <td className="location" title={p.path}>{p.missing?'Folder missing':p.kind==='library'?'Library':p.path.replace(/^\/Users\/[^/]+/,'~')}</td>
          <td className="muted">{ago(p.opened)}</td>
          <td className="row-actions">
            <button aria-label={'Show '+p.name+' in Finder'} title="Show in Finder" disabled={p.missing} onClick={()=>api('/projects/'+p.id+'/reveal',{}).catch(fail)}><FolderOpen size={14}/></button>
            <button aria-label={(p.kind==='library'?'Delete ':'Remove ')+p.name} title={p.kind==='library'?'Move to Trash':'Remove from list'} onClick={()=>remove(p)}>{p.kind==='library'?<Trash2 size={14}/>:<X size={14}/>}</button>
          </td>
        </tr>)}</tbody>
      </table>:<p className="muted projects-empty">{projects.length?'No matching projects.':'No projects yet. Create one, or open a folder you already have.'}</p>)}
    </div></main>
    {naming&&<div className="backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label="New project"><div className="dialog-title"><strong>New project</strong><button aria-label="Close dialog" onClick={()=>setNaming(false)}><X size={16}/></button></div>
      <form onSubmit={create}><input autoFocus aria-label="Project name" placeholder="Project name" value={name} onChange={e=>setName(e.target.value)}/><div className="dialog-bottom"><span className="muted">Saved in your Paperdesk library</span><button className="primary" type="submit" disabled={!name.trim()}>Create</button></div></form>
    </section></div>}
  </div>;
}
function App() {
  const [route,setRoute]=useState(location.pathname);
  useEffect(()=>{const pop=()=>setRoute(location.pathname);addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);
  const go=url=>{history.pushState(null,'',url);setRoute(url);};
  const id=route.match(/^\/p\/([\w-]+)$/)?.[1];
  return id?<Editor key={id} id={id} go={go}/>:<Home go={go}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
