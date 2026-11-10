import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { RefreshCw, X, ArrowUp, ChevronUp, ChevronDown, Download, MoreHorizontal, Paperclip, FileText, Image, House, Trash2, PanelLeft, Square, Pencil } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import PdfPreview from './PdfPreview.jsx';
import FileTree from './FileTree.jsx';
import Settings from './Settings.jsx';
import { LogsButton, Logs } from './Logs.jsx';
import { api, request, textFile, imageFile } from './api.js';
import { normalizeMathMarkdown } from './mathMarkdown.js';
import { latexExtensions, showDiagnostics } from './latexEditor.js';
const extensions = [...latexExtensions, EditorView.lineWrapping];
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
const dialogTitles = { new: 'New file', rename: 'Rename', style: 'Writing style', history: 'History' };
// Other files show in place of the editor, like Overleaf: images and PDFs as previews.
function FilePane({ file, url }) {
  if (imageFile(file)) return <div className="file-pane"><img src={url} alt={file}/></div>;
  if (/\.pdf$/i.test(file)) return <div className="file-pane pdf"><PdfPreview key={url} url={url}/></div>;
  return <div className="file-pane"><span className="muted">No preview for this file type.</span></div>;
}
export default function Editor({ id, go }) {
  const [project,setProject]=useState(null), [files,setFiles]=useState(null), [mainFile,setMainFile]=useState(null), [viewing,setViewing]=useState(null);
  const [treeOpen,setTreeOpen]=useState(()=>localStorage.getItem('paperdesk:tree')!=='false');
  const [doc,setDoc]=useState(null), [text,setText]=useState(''), [status,setStatus]=useState('');
  const [autoCompile,setAutoCompile]=useState(()=>localStorage.getItem('paperdesk:autoCompile')!=='false');
  const [pdf,setPdf]=useState(null), [compiling,setCompiling]=useState(false), [error,setError]=useState('');
  const [logs,setLogs]=useState(null), [logsOpen,setLogsOpen]=useState(false), goodLogs=useRef(null);
  const [dialog,setDialog]=useState(null), [newName,setNewName]=useState('main.tex');
  const [historyOpen,setHistoryOpen]=useState(false), [prompt,setPrompt]=useState(''), [attachments,setAttachments]=useState([]);
  const [historyHeight,setHistoryHeight]=useState(180), [resizing,setResizing]=useState(false);
  const historyDrag=useRef(null), thread=useRef(null), composer=useRef(null);
  const [job,setJob]=useState(null), [starting,setStarting]=useState(false), [messages,setMessages]=useState([]), [activity,setActivity]=useState('');
  const [menu,setMenu]=useState(false), [style,setStyle]=useState(''), [examples,setExamples]=useState(0), [history,setHistory]=useState([]);
  const editorView=useRef(null), primaryFile=useRef(null), fileInput=useRef(null), uploadInput=useRef(null);
  const state=useRef({doc:null,text:'',files:[]}), saves=useRef(Promise.resolve()), building=useRef(false), attemptedBuild=useRef(''), sourceFingerprint=useRef(null);
  const [syncVersion,setSyncVersion]=useState(0), [offline,setOffline]=useState(false), [notice,setNotice]=useState(''), [settings,setSettings]=useState(false), [agentReady,setAgentReady]=useState(true);
  const checkAgent=()=>api('/settings').then(s=>setAgentReady(!!s.agent),()=>{});
  useEffect(()=>{checkAgent();},[]);
  state.current={doc,text,files:files||[]};
  const aiBusy=!!job || starting;
  const syncState=useRef({});syncState.current={pdf,status,aiBusy};
  const fail=e=>setError(e.message);
  const call=(url,body,method)=>api('/projects/'+id+url,body,method);
  const fileURL=(path,version='')=>'/api/projects/'+id+'/file?path='+encodeURIComponent(path)+'&v='+version;
  const draftKey=file=>'paperdesk:draft:'+id+':'+file;
  function accept(next, recover=false) {
    const draft=recover ? localStorage.getItem(draftKey(next.path)) : null;
    const value=draft ?? next.text;
    state.current.doc=next; state.current.text=value;
    setDoc(next);setText(value);setStatus(value===next.text?'Saved':'Unsaved');setViewing(null);
  }
  // The main document is what compiles and shows in the PDF pane, whichever file is open.
  function setMain(file, list=state.current.files) {
    primaryFile.current=file;attemptedBuild.current='';setMainFile(file);setLogs(null);
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
      const match=await call('/inverse-search',{path:pdf.path.replace(/\.pdf$/,'.tex'),revision:pdf.revision,version:pdf.version,...location});
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
  async function revealLog(entry) {
    try {
      if(entry.file!==state.current.doc?.path) await openFile(entry.file);
      requestAnimationFrame(()=>{
        const view=editorView.current;
        if(!view||!entry.line)return;
        const line=view.state.doc.line(Math.min(entry.line,view.state.doc.lines));
        view.dispatch({selection:{anchor:line.from},effects:EditorView.scrollIntoView(line.from,{y:'center'})});
        view.focus();
      });
    }catch(e){fail(e);}
  }
  // A failed build stops applying once the source is back to what the PDF was built from, such as
  // after undoing the edit that broke it; that leaves nothing to recompile, so show the PDF's logs.
  const pdfCurrent=!!pdf && pdf.editorPath===doc?.path && pdf.editorRevision===doc?.revision;
  const failureStale=logs?.failed && (logs.editorPath!==doc?.path || logs.editorRevision!==doc?.revision);
  const shownLogs=useMemo(()=>failureStale && pdfCurrent ? {failed:false,entries:goodLogs.current?.version===pdf.version?goodLogs.current.entries:[]} : logs,[logs,failureStale,pdfCurrent,pdf?.version]);
  useEffect(()=>{
    if(editorView.current) showDiagnostics(editorView.current,(shownLogs?.entries||[]).filter(e=>e.file===doc?.path));
  },[shownLogs,doc?.path]);
  async function compile() {
    if(building.current || !state.current.doc || !primaryFile.current) return;
    attemptedBuild.current=state.current.doc.path+':'+state.current.doc.revision;
    building.current=true;setCompiling(true);
    let primary, saved;
    try {
      saved=await save();
      attemptedBuild.current=saved.path+':'+saved.revision;
      primary=primaryFile.current===saved.path?saved:await call('/document?path='+encodeURIComponent(primaryFile.current));
      const result=await call('/compile',{path:primary.path,revision:primary.revision});
      if(!state.current.files.includes(result.pdf)) refreshFiles().catch(()=>{});
      if(primaryFile.current===primary.path) {setError('');goodLogs.current={version:result.version,entries:result.diagnostics||[]};setLogs({failed:false,entries:goodLogs.current.entries});setPdf({path:result.pdf,revision:result.revision,engine:result.engine,fingerprint:result.fingerprint,version:result.version,editorPath:saved.path,editorRevision:saved.revision});}
    }catch(e){
      // TeX errors go to the gutter and the logs, not the banner. Without a PDF to show, open the logs.
      if(!e.diagnostics)fail(e);
      else if(primaryFile.current===primary?.path){setLogs({failed:true,entries:e.diagnostics,editorPath:saved.path,editorRevision:saved.revision});if(!syncState.current.pdf)setLogsOpen(true);}
    }finally{building.current=false;setCompiling(false);}
  }
  useEffect(()=>{
    if(!autoCompile || !doc || status!=='Saved' || aiBusy || compiling || (pdf?.editorPath===doc.path&&pdf?.editorRevision===doc.revision)) return;
    if(attemptedBuild.current===doc.path+':'+doc.revision)return;
    const timer=setTimeout(compile,1000);return()=>clearTimeout(timer);
  },[doc?.path,doc?.revision,status,aiBusy,compiling,autoCompile,syncVersion,pdf?.editorPath,pdf?.editorRevision]);
  // Reconcile every tab against disk, including changes made by external editors.
  // Never replace a draft or race an in-flight save/build.
  useEffect(()=>{
    let stopped=false,fetching=false;
    const sync=async()=>{
      if(fetching || building.current || syncState.current.aiBusy || syncState.current.status==='Saving…')return;
      const before=state.current, primary=primaryFile.current;
      if(!before.doc || !primary)return;
      fetching=true;
      try {
        const result=await call('/state?main='+encodeURIComponent(primary)+'&open='+encodeURIComponent(before.doc.path));
        setOffline(false);
        if(stopped || building.current || primaryFile.current!==primary || state.current.doc!==before.doc || state.current.text!==before.text || syncState.current.status==='Saving…')return;
        setFiles(result.files);state.current.files=result.files;
        const changed=sourceFingerprint.current!==null && sourceFingerprint.current!==result.fingerprint;
        sourceFingerprint.current=result.fingerprint;
        if(result.doc.revision!==before.doc.revision){
          if(before.text!==before.doc.text){
            setStatus('Save failed');setError('This file changed in another tab or on disk. Your draft is preserved. Download it or choose Use disk version.');
            return;
          }
          accept(result.doc);
        }
        const current=state.current, preview=result.preview;
        if(preview?.current && current.text===current.doc.text){
          const previous=syncState.current.pdf;
          if(previous?.version!==preview.version || previous.editorPath!==current.doc.path || previous.editorRevision!==current.doc.revision){
            setPdf({...preview,fingerprint:result.fingerprint,editorPath:current.doc.path,editorRevision:current.doc.revision});
            setError(e=>/preview is out of date|PDF changed|source file changed/i.test(e)?'':e);
          }
        } else if(changed || syncState.current.pdf?.editorPath){
          setPdf(p=>p&&{...p,editorPath:null});
          attemptedBuild.current='';setSyncVersion(v=>v+1);
        }
      // While the server restarts, wait quietly instead of raising an error.
      }catch(e){if(stopped)return;if(e.offline)setOffline(true);else fail(e);}finally{fetching=false;}
    };
    sync();const timer=setInterval(sync,1500);
    window.addEventListener('focus',sync);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',sync);};
  },[]);
  useEffect(()=>{
    const key=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();save().catch(fail);}
      if((e.metaKey||e.ctrlKey)&&e.key==='Enter' && e.target.tagName!=='TEXTAREA'){e.preventDefault();compile();}
    };
    const leave=e=>{if(state.current.doc && state.current.text!==state.current.doc.text){e.preventDefault();e.returnValue='';}};
    window.addEventListener('keydown',key);window.addEventListener('beforeunload',leave);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('beforeunload',leave);};
  });
  // Attached files are copied into the project right away (image.png, then image-2.png, ...); requests send their paths.
  // Removing one from the message keeps the copy in the project.
  function attach(list) {
    for(const file of list){
      const key=crypto.randomUUID();
      setAttachments(a=>[...a,{key,name:file.name}]);
      request('/api/projects/'+id+'/upload?unique=1&path='+encodeURIComponent(file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file})
        .then(async res=>{const result=await res.json();if(!res.ok)throw new Error(result.error||'Upload failed.');setAttachments(a=>a.map(x=>x.key===key?{...x,name:result.path,path:result.path}:x));refreshFiles().catch(()=>{});})
        .catch(e=>{setAttachments(a=>a.filter(x=>x.key!==key));fail(e);});
    }
  }
  const detach=item=>setAttachments(a=>a.filter(x=>x.key!==item.key));
  const uploading=attachments.some(a=>!a.path);
  async function send() {
    if(!files || !prompt.trim() || aiBusy || uploading)return;
    setStarting(true);setError('');
    try {
      const saved=await save();
      const request=await call('/task',{path:saved?.path,revision:saved?.revision,main:primaryFile.current,attachments:attachments.map(a=>a.path),history:messages.map(({role,text})=>({role,text})),instruction:prompt});
      const pending={id:request.id,project:id};
      setMessages(m=>[...m,{role:'You',text:prompt,files:attachments.map(({name})=>({name}))}]);setPrompt('');setAttachments([]);setJob(pending);setHistoryOpen(true);
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
        if(result.status==='stopped'){setMessages(m=>[...m,{role:'Agent',text:'Stopped.'}]);setJob(null);sessionStorage.removeItem('paperdesk:task');return;}
        setActivity(result.activity||'');
        if(result.status==='done') {
          let changed=[];
          if(result.result.edits.length) {
            changed=await api('/tasks/'+job.id+'/apply',{});
            if(stopped)return;
            // Other files changed too, so the current PDF is out of date even if the open file was not edited.
            setPdf(p=>p&&{...p,editorPath:null});
            await refreshFiles();
            const open=changed.find(d=>d.path===state.current.doc?.path);
            if(open) accept(open); else await openFile(changed[0].path,false);
          }
          if(result.result.style){setStyle(result.result.style);setDialog('style');}
          setMessages(m=>[...m,{role:'Agent',text:result.result.message,changed:changed.map(d=>d.path)}]);setHistoryOpen(true);setJob(null);sessionStorage.removeItem('paperdesk:task');
        }
      }catch(e){if(!stopped){fail(e);setJob(null);sessionStorage.removeItem('paperdesk:task');}}
      finally{fetching=false;}
    };
    poll();const timer=setInterval(poll,1200);return()=>{stopped=true;clearInterval(timer);setActivity('');};
  },[job]);
  async function createFile() {
    try{await save();const next=await call('/new-document',{name:newName.trim()});await refreshFiles();await openFile(next.path,false);setDialog(null);}catch(e){fail(e);}
  }
  async function renameFile() {
    try{const {path:to}=await call('/rename',{from:viewing,to:newName.trim()});setPdf(p=>p?.path===viewing?null:p);await refreshFiles();setViewing(to);setDialog(null);}catch(e){fail(e);}
  }
  async function deleteFile() {
    if(!confirm(`Move ${viewing} to the Trash?`))return;
    try{await call('/file?path='+encodeURIComponent(viewing),{},'DELETE');setPdf(p=>p?.path===viewing?null:p);setViewing(null);await refreshFiles();}catch(e){fail(e);}
  }
  async function upload(list, folder='') {
    try {
      for(const file of list){
        const res=await request('/api/projects/'+id+'/upload?path='+encodeURIComponent(folder+file.name),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
        if(!res.ok)throw new Error((await res.json()).error||'Upload failed.');
      }
    }catch(e){fail(e);}
    await refreshFiles().catch(fail);
  }
  // Build files left by other tools, such as hw.aux beside hw.tex, go to the Trash.
  async function cleanUp(){
    setMenu(false);
    try{const {removed}=await call('/clean',{});setNotice(removed.length?`Moved ${removed.length} build ${removed.length===1?'file':'files'} to the Trash`:'No build files to clean up');setTimeout(()=>setNotice(''),4000);}catch(e){fail(e);}
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
      <span className="status">{notice||(offline?'Reconnecting…':status)}</span>
      <div className="spacer"/>
      
      <button disabled={!doc||compiling||aiBusy} onClick={()=>{setError('');compile();}}><RefreshCw size={14}/>Compile</button>
      <div className="menu-wrap"><button aria-label="More" onClick={()=>setMenu(!menu)}><MoreHorizontal size={18}/></button>{menu&&<div className="menu"><button role="menuitemcheckbox" aria-checked={autoCompile} onClick={()=>{const next=!autoCompile;setAutoCompile(next);localStorage.setItem('paperdesk:autoCompile',String(next));setMenu(false);}}>Auto-compile: {autoCompile?'on':'off'}</button><button disabled={!doc||aiBusy} onClick={loadHistory}>History</button><button onClick={loadStyle}>Writing style</button><button onClick={()=>{setMenu(false);setSettings(true);}}>Settings</button><button disabled={!files||aiBusy} onClick={()=>{refreshFiles().catch(fail);setMenu(false);}}>Refresh files</button><button disabled={!files||aiBusy} onClick={cleanUp}>Clean up build files</button></div>}</div>
    </header>
    {error&&<div className="error" role="alert"><details><summary>{error.split('\n')[0].slice(0,180)}</summary><pre>{error}</pre></details>{status==='Save failed'&&<><button onClick={downloadDraft}>Download draft</button><button onClick={reloadDisk}>Use disk version</button></>}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
    <main className={treeOpen?'with-tree':''}>
      {treeOpen&&<FileTree files={files||[]} open={viewing||doc?.path} main={mainFile} disabled={aiBusy} onOpen={file=>{if(textFile(file))openFile(file).catch(fail);else setViewing(file);}} onMain={file=>{setError('');setMain(file);}} onNew={()=>{setNewName('');setDialog('new');}} onUpload={upload} uploadInput={uploadInput}/>}
      <section className="left"><div className="panel-title"><span>{viewing||doc?.path||'LaTeX'}</span>{viewing&&<>
        <a href={fileURL(viewing)} download={viewing.split('/').at(-1)} aria-label="Download file" title="Download"><Download size={14}/></a>
        <button aria-label="Rename file" title="Rename" disabled={aiBusy} onClick={()=>{setNewName(viewing);setDialog('rename');}}><Pencil size={14}/></button>
        <button aria-label="Delete file" title="Move to Trash" disabled={aiBusy} onClick={deleteFile}><Trash2 size={14}/></button>
        <button aria-label="Close file" title="Back to the editor" onClick={()=>setViewing(null)}><X size={14}/></button>
      </>}</div>{viewing&&<FilePane file={viewing} url={fileURL(viewing)}/>}<div className="editor" hidden={!!viewing}>{doc?<CodeMirror onCreateEditor={view=>{editorView.current=view;}} className="latex-editor" value={text} height="100%" extensions={extensions} onChange={change} editable={!aiBusy} basicSetup={{foldGutter:true,highlightActiveLine:true,bracketMatching:false}}/>:<div className="empty">{files?'Select a .tex file or ask the agent to create one.':''}</div>}</div>
      <section className={'agent'+(resizing?' resizing':'')} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(!e.dataTransfer.files.length||!files)return;e.preventDefault();attach([...e.dataTransfer.files]);}}>
        {historyOpen&&<div className="agent-resizer" role="separator" aria-label="Resize chat history" aria-orientation="horizontal" aria-valuemin={48} aria-valuemax={500} aria-valuenow={historyHeight} tabIndex={0} onPointerDown={e=>{historyDrag.current={y:e.clientY,height:historyHeight};e.currentTarget.setPointerCapture(e.pointerId);setResizing(true);}} onPointerMove={e=>{if(historyDrag.current)setHistoryHeight(Math.max(48,Math.min(500,historyDrag.current.height+historyDrag.current.y-e.clientY)));}} onLostPointerCapture={()=>{historyDrag.current=null;setResizing(false);}} onKeyDown={e=>{if(["ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();setHistoryHeight(h=>Math.max(48,Math.min(500,h+(e.key==="ArrowUp"?20:-20))));}}}/>}
        <div className="agent-title" onClick={()=>setHistoryOpen(!historyOpen)}><span>Agent</span><span className="status">{aiBusy&&!historyOpen?activity||'Working…':''}</span><div className="spacer"/><button aria-label={historyOpen?"Collapse chat history":"Expand chat history"} aria-expanded={historyOpen}>{historyOpen?<ChevronDown size={14}/>:<ChevronUp size={14}/>}</button></div>
        <div className="thread" ref={thread} style={{height:historyOpen?historyHeight:0}} inert={!historyOpen}><div className="thread-inner">
          {!messages.length&&!aiBusy&&<p className="thread-empty">Ask about anything in this folder, request an edit, or attach a file.</p>}
          {messages.map((m,i)=><div key={i} className={m.role==='You'?'message user':'message'}>{m.files?.length>0&&<div className="message-files">{m.files.map((f,j)=><span key={j} className="attachment">{imageFile(f.name)?<Image size={12}/>:<FileText size={12}/>}<span>{f.name}</span></span>)}</div>}{m.role==='You'?<p>{m.text}</p>:<div className="markdown"><Markdown {...markdown}>{normalizeMathMarkdown(m.text)}</Markdown></div>}{m.changed?.length>0&&<div className="message-files" aria-label="Changed files">{m.changed.map(f=><span key={f} className="attachment" title={'Changed '+f}><FileText size={12}/><span>{f}</span></span>)}</div>}</div>)}
          {aiBusy&&<div className="thinking" role="status" aria-label="Agent is working"><span className="dots"><i/><i/><i/></span>{activity}</div>}
        </div></div>
        <div className="composer" onClick={e=>{if(e.target===e.currentTarget)composer.current?.focus();}}>
          {attachments.length>0&&<div className="attachments">{attachments.map(a=><span key={a.key} className={'attachment'+(a.path?'':' uploading')} title={a.path?'Saved in the project as '+a.path:'Adding '+a.name}>{imageFile(a.name)?<Image size={12}/>:<FileText size={12}/>}<span>{a.name}</span><button aria-label={'Remove '+a.name} onClick={()=>detach(a)}><X size={12}/></button></span>)}</div>}
          <textarea ref={composer} rows={1} aria-label="Agent request" placeholder={agentReady?'Ask anything or request an edit…':'Connect Codex or Claude Code to ask questions and request edits'} disabled={!files||!agentReady} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={composerKey} onPaste={e=>{if(e.clipboardData.files.length&&!e.clipboardData.getData('text/plain')){e.preventDefault();attach([...e.clipboardData.files]);}}}/>
          <div className="composer-actions"><button className="attach" aria-label="Attach files" title="Attach files" disabled={!files} onClick={()=>fileInput.current.click()}><Paperclip size={16}/></button><input ref={fileInput} type="file" multiple hidden onChange={e=>{attach([...e.target.files]);e.target.value='';}}/><div className="spacer"/>{!agentReady?<button className="connect" onClick={()=>setSettings(true)}>Connect an agent</button>:job?<button className="send" aria-label="Stop agent" title="Stop" onClick={()=>{setActivity('Stopping…');api('/jobs/'+job.id+'/stop',{}).catch(fail);}}><Square size={11} fill="currentColor"/></button>:<button className="send" aria-label="Send to Agent" title="Send (Enter)" disabled={!prompt.trim()||!files||aiBusy||uploading} onClick={send}><ArrowUp size={16}/></button>}</div>
        </div>
      </section>
      </section>
      <section className="right"><div className="panel-title"><span>PDF{pdf?.engine&&' · '+pdf.engine}</span><div className="spacer"/><span className={'status'+(shownLogs?.failed&&!compiling?' failed':'')}>{compiling?'Compiling…':shownLogs?.failed?'Compile failed':pdf&&(pdf.editorPath!==doc?.path||pdf.editorRevision!==doc?.revision)?'Out of date':''}</span>{shownLogs&&<LogsButton entries={shownLogs.entries} open={logsOpen} onClick={()=>setLogsOpen(!logsOpen)}/>}{pdf&&<a href={fileURL(pdf.path,pdf.version)} download aria-label="Download PDF"><Download size={14}/></a>}</div><div className="preview">{logsOpen&&<Logs logs={shownLogs} hasPdf={!!pdf} onReveal={revealLog} onClose={()=>setLogsOpen(false)}/>}<div className="preview-pdf" hidden={logsOpen}>{pdf?<PdfPreview key={pdf.path} url={fileURL(pdf.path,pdf.version)} onSourceClick={jumpToSource}/>:<div className="empty">{compiling?'Compiling…':'No compiled PDF.'}</div>}</div></div></section>
    </main>
    {settings&&<Settings onClose={saved=>{setSettings(false);if(saved)checkAgent();}}/>}
    {dialog&&<div className="backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label={dialogTitles[dialog]}><div className="dialog-title"><strong>{dialogTitles[dialog]}</strong><button aria-label="Close dialog" onClick={()=>setDialog(null)}><X size={16}/></button></div>
    {dialog==='new'&&<form onSubmit={e=>{e.preventDefault();createFile();}}><input autoFocus aria-label="Filename" placeholder="chapters/intro.tex or refs.bib" value={newName} onChange={e=>setNewName(e.target.value)}/><div className="dialog-bottom"><div className="spacer"/><button className="primary" type="submit" disabled={!newName.trim()}>Create</button></div></form>}
    {dialog==='rename'&&<form onSubmit={e=>{e.preventDefault();renameFile();}}><input autoFocus aria-label="New name" value={newName} onChange={e=>setNewName(e.target.value)}/><div className="dialog-bottom"><div className="spacer"/><button className="primary" type="submit" disabled={!newName.trim()||newName.trim()===viewing}>Rename</button></div></form>}
    {dialog==='style'&&<><textarea aria-label="Writing profile" className="style-editor" value={style} onChange={e=>setStyle(e.target.value)} placeholder="Writing preferences"/><div className="dialog-bottom"><span className="muted">{examples} saved edit examples</span><button disabled={!doc||aiBusy||!examples} onClick={suggestStyle}>Suggest notes</button><button onClick={async()=>{try{await api('/style/examples',{},'DELETE');setExamples(0);}catch(e){fail(e);}}}>Clear examples</button><button className="primary" onClick={async()=>{try{await api('/style',{text:style},'PUT');setDialog(null);}catch(e){fail(e);}}}>Save</button></div></>}
    {dialog==='history'&&<div className="history">{history.length?history.map(v=><button key={v.id} onClick={async()=>{try{await save();change(v.text);await save('restore');setDialog(null);}catch(e){fail(e);}}}>{new Date(v.date).toLocaleString()}<span>Restore</span></button>):<span className="muted">No saved versions.</span>}</div>}
    </section></div>}
  </div>;
}
