import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { StreamLanguage } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { FolderOpen, RefreshCw, X, ArrowUp, ChevronUp, ChevronDown, FilePlus, Download, MoreHorizontal } from 'lucide-react';
import './style.css';
import PdfPreview from './PdfPreview.jsx';
const extensions = [StreamLanguage.define(stex), EditorView.lineWrapping];
async function api(url, body, method = 'POST') {
  const res = await fetch('/api' + url, body === undefined ? {} : { method, headers: {'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
const fileURL = (path, version='') => '/api/pdf?path='+encodeURIComponent(path)+'&v='+version;
function App() {
  const [dir,setDir]=useState(null);
  const [doc,setDoc]=useState(null), [text,setText]=useState(''), [status,setStatus]=useState('');
  const [pdf,setPdf]=useState(null), [compiling,setCompiling]=useState(false), [error,setError]=useState('');
  const [dialog,setDialog]=useState(null), [newName,setNewName]=useState('main.tex'), [busy,setBusy]=useState(false);
  const [historyOpen,setHistoryOpen]=useState(false), [prompt,setPrompt]=useState(''), [source,setSource]=useState('');
  const [historyHeight,setHistoryHeight]=useState(180);
  const historyDrag=useRef(null);
  const [job,setJob]=useState(null), [starting,setStarting]=useState(false), [messages,setMessages]=useState([]);
  const [menu,setMenu]=useState(false), [style,setStyle]=useState(''), [examples,setExamples]=useState(0), [history,setHistory]=useState([]);
  const editorView=useRef(null), primaryFile=useRef(null);
  const state=useRef({doc:null,text:'',dir:null}), saves=useRef(Promise.resolve()), building=useRef(false), attemptedBuild=useRef('');
  state.current={doc,text,dir};
  const aiBusy=!!job || starting;
  const fail=e=>setError(e.message);
  const draftKey=file=>'paperdesk:draft:'+state.current.dir?.root+':'+file;
  function accept(next, recover=false, makePrimary=true) {
    const draft=recover ? localStorage.getItem(draftKey(next.path)) : null;
    const value=draft ?? next.text;
    state.current.doc=next; state.current.text=value;
    setDoc(next);setText(value);setStatus(value===next.text?'Saved':'Unsaved');
    if(makePrimary){attemptedBuild.current='';primaryFile.current=next.path;localStorage.setItem('paperdesk:primary',next.path);}
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
        const saved=await api('/document',{path:current.doc.path,text:current.text,revision:current.doc.revision,origin},'PUT');
        if(state.current.doc?.path===saved.path) {
          state.current.doc=saved;setDoc(saved);setStatus(state.current.text===saved.text?'Saved':'Unsaved');
          if(state.current.text===saved.text) localStorage.removeItem(draftKey(saved.path));
        }
        return saved;
      } catch(e) {setStatus('Save failed');throw e;}
    });
    saves.current=operation;return operation;
  }
  async function chooseNativeDirectory() {
    if(busy || aiBusy) return;
    setBusy(true); setError('');
    try {
      await save();
      const selected=await api('/choose-directory',{path:dir?.path || ''});
      if(!selected.cancelled) await chooseDirectory(await api('/directory?path='+encodeURIComponent(selected.path)));
    }catch(e){fail(e);}finally{setBusy(false);}
  }
  async function refreshDirectory() {
    const result=await api('/directory?path='+encodeURIComponent(state.current.dir.path));
    setDir(result);state.current.dir=result;return result;
  }
  async function openFile(file, directory=state.current.dir) {
    await save();
    const next=await api('/document?path='+encodeURIComponent(file));
    accept(next,true);
    const output=file.replace(/\.tex$/,'.pdf');
    setPdf(directory.entries.some(e=>e.path===output)?{path:output,version:Date.now(),revision:null}:null);
    setError('');
  }
  async function chooseDirectory(directory) {
    setBusy(true);
    try {
      await save();setDir(directory);state.current.dir=directory;
      setDoc(null);setText('');primaryFile.current=null;state.current.doc=null;state.current.text='';setPdf(null);setSource('');setStatus('');setMessages([]);
      localStorage.setItem('paperdesk:directory',directory.path);
      const files=directory.entries.filter(e=>!e.directory && e.name.endsWith('.tex'));
      const file=files.find(e=>e.path===localStorage.getItem('paperdesk:primary')) || files.find(e=>e.name==='main.tex') || files[0];
      if(file) await openFile(file.path,directory);
      setDialog(null);setError('');
    }catch(e){fail(e);}finally{setBusy(false);}
  }
  useEffect(()=>{
    (async()=>{
      const remembered=localStorage.getItem('paperdesk:directory');
      if(remembered!==null) {
        try {await chooseDirectory(await api('/directory?path='+encodeURIComponent(remembered)));}
        catch {localStorage.removeItem('paperdesk:directory');}
      }
      const pending=sessionStorage.getItem('paperdesk:task');
      if(pending) {try{setJob(JSON.parse(pending));}catch{}}
    })().catch(fail);
  },[]);
  useEffect(()=>{
    if(!doc || text===doc.text || status==='Save failed' || aiBusy) return;
    const timer=setTimeout(()=>save().catch(fail),700);return()=>clearTimeout(timer);
  },[doc,text,status,aiBusy]);
  async function jumpToSource(location) {
    if(!pdf || aiBusy)return;
    const snapshot=state.current;
    if(snapshot.text!==snapshot.doc?.text || pdf.editorPath!==snapshot.doc?.path || pdf.editorRevision!==snapshot.doc?.revision){setError('The preview is out of date. Wait for compilation or click Compile before jumping to source.');return;}
    try {
      const match=await api('/inverse-search',{path:pdf.path.replace(/\.pdf$/,'.tex'),revision:pdf.revision,...location});
      if(state.current.doc!==snapshot.doc || state.current.text!==snapshot.text)return;
      if(match.path!==snapshot.doc.path){
        const next=await api('/document?path='+encodeURIComponent(match.path));
        if(state.current.doc!==snapshot.doc || state.current.text!==snapshot.text)return;
        accept(next,false,false);
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
    if(building.current || !state.current.doc) return;
    attemptedBuild.current=state.current.doc.path+':'+state.current.doc.revision;
    building.current=true;setCompiling(true);
    try {
      const saved=await save();
      const primary=primaryFile.current===saved.path?saved:await api('/document?path='+encodeURIComponent(primaryFile.current));
      const result=await api('/compile',{path:primary.path,revision:primary.revision});
      if(primaryFile.current===primary.path) setPdf({path:result.pdf,version:Date.now(),revision:result.revision,editorPath:saved.path,editorRevision:saved.revision});
    }catch(e){fail(e);}finally{building.current=false;setCompiling(false);}
  }
  useEffect(()=>{
    if(!doc || status!=='Saved' || aiBusy || compiling || (pdf?.editorPath===doc.path&&pdf?.editorRevision===doc.revision)) return;
    if(attemptedBuild.current===doc.path+':'+doc.revision)return;
    const timer=setTimeout(compile,700);return()=>clearTimeout(timer);
  },[doc?.path,doc?.revision,status,aiBusy,compiling]);
  useEffect(()=>{
    const key=e=>{
      if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();save().catch(fail);}
      if((e.metaKey||e.ctrlKey)&&e.key==='Enter' && e.target.tagName!=='TEXTAREA'){e.preventDefault();compile();}
    };
    const leave=e=>{if(state.current.doc && state.current.text!==state.current.doc.text){e.preventDefault();e.returnValue='';}};
    window.addEventListener('keydown',key);window.addEventListener('beforeunload',leave);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('beforeunload',leave);};
  });
  async function send() {
    if(!dir || !prompt.trim() || aiBusy)return;
    setStarting(true);setError('');
    try {
      const saved=await save();
      const primary=saved&&primaryFile.current!==saved.path?await api('/document?path='+encodeURIComponent(primaryFile.current)):saved;
      const request=await api('/task',{directory:dir.path,path:primary?.path,revision:primary?.revision,source,instruction:prompt});
      const pending={id:request.id,directory:dir.path};
      setMessages(m=>[...m,{role:'You',text:prompt}]);setPrompt('');setJob(pending);
      sessionStorage.setItem('paperdesk:task',JSON.stringify(pending));
    }catch(e){fail(e);}finally{setStarting(false);}
  }
  useEffect(()=>{
    if(!job)return;
    let stopped=false,fetching=false;
    const poll=async()=>{
      if(fetching)return;fetching=true;
      try {
        const result=await api('/jobs/'+job.id);
        if(stopped)return;
        if(result.status==='error')throw new Error(result.error);
        if(result.status==='done') {
          if(result.result.latex) {
            const next=await api('/tasks/'+job.id+'/apply',{});
            if(stopped)return;
            if(state.current.dir?.path===job.directory){accept(next);await refreshDirectory();setPdf(null);}
          }
          if(result.result.style){setStyle(result.result.style);setDialog('style');}
          setMessages(m=>[...m,{role:'Codex',text:result.result.message}]);setJob(null);setSource('');sessionStorage.removeItem('paperdesk:task');
        }
      }catch(e){if(!stopped){fail(e);setJob(null);sessionStorage.removeItem('paperdesk:task');}}
      finally{fetching=false;}
    };
    poll();const timer=setInterval(poll,1200);return()=>{stopped=true;clearInterval(timer);};
  },[job]);
  async function createFile() {
    try{await save();const next=await api('/new-document',{directory:dir.path,name:newName});accept(next);setPdf(null);await refreshDirectory();setDialog(null);}catch(e){fail(e);}
  }
  async function suggestStyle(){
    try{const saved=await save();const request=await api('/ai',{path:saved.path,revision:saved.revision,mode:'style',instruction:'Suggest an updated writing profile from my edits.'});const pending={id:request.id,directory:dir.path};setJob(pending);sessionStorage.setItem('paperdesk:task',JSON.stringify(pending));setDialog(null);setHistoryOpen(true);}catch(e){fail(e);}
  }
  async function loadHistory(){setMenu(false);try{setHistory(await api('/history?path='+encodeURIComponent(doc.path)));setDialog('history');}catch(e){fail(e);}}
  async function loadStyle(){setMenu(false);try{const s=await api('/style');setStyle(s.text);setExamples(s.examples);setDialog('style');}catch(e){fail(e);}}
  async function reloadDisk(){try{const latest=await api('/document?path='+encodeURIComponent(doc.path));accept(latest);localStorage.removeItem(draftKey(latest.path));setError('');}catch(e){fail(e);}}
  function downloadDraft(){const url=URL.createObjectURL(new Blob([text],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='draft.tex';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  const texFiles=dir?.entries.filter(e=>!e.directory && e.name.endsWith('.tex'))||[];
  const pdfFiles=dir?.entries.filter(e=>!e.directory && e.name.toLowerCase().endsWith('.pdf'))||[];
  return <div className="app">
    <header>
      <button className="directory" disabled={aiBusy||busy} onClick={chooseNativeDirectory} title={dir ? dir.root+'/'+dir.path : 'Choose directory'}><FolderOpen size={16}/>{busy ? 'Choosing…' : dir ? dir.path||dir.root.split('/').at(-1) : 'Choose directory'}</button>
      <span className="separator"/>
      <select aria-label="Primary TeX file" disabled={!texFiles.length||aiBusy} value={primaryFile.current||''} onChange={e=>openFile(e.target.value).catch(fail)}>{!doc&&<option value="">No .tex file</option>}{texFiles.map(e=><option key={e.path} value={e.path}>{e.name}</option>)}</select>
      <button title="New TeX file" aria-label="New TeX file" disabled={!dir||aiBusy} onClick={()=>{setNewName('main.tex');setDialog('new');}}><FilePlus size={15}/></button>
      <span className="status">{status}</span>
      <div className="spacer"/>
      
      <button disabled={!doc||compiling||aiBusy} onClick={()=>{setError('');compile();}}><RefreshCw size={14} className={compiling?'spin':''}/>{compiling?'Compiling':'Compile'}</button>
      <div className="menu-wrap"><button aria-label="More" onClick={()=>setMenu(!menu)}><MoreHorizontal size={18}/></button>{menu&&<div className="menu"><button disabled={!doc||aiBusy} onClick={loadHistory}>History</button><button onClick={loadStyle}>Writing style</button><button disabled={!dir||aiBusy} onClick={()=>{refreshDirectory().catch(fail);setMenu(false);}}>Refresh files</button></div>}</div>
    </header>
    {error&&<div className="error" role="alert"><details><summary>{error.split('\n')[0].slice(0,180)}</summary><pre>{error}</pre></details>{status==='Save failed'&&<><button onClick={downloadDraft}>Download draft</button><button onClick={reloadDisk}>Use disk version</button></>}<button aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
    <main>
      <section className="left"><div className="panel-title">{doc?.path.split('/').at(-1)||'LaTeX'}</div><div className="editor">{doc?<CodeMirror onCreateEditor={view=>{editorView.current=view;}} className="latex-editor" value={text} height="100%" extensions={extensions} onChange={change} editable={!aiBusy} basicSetup={{foldGutter:true,highlightActiveLine:true}}/>:<div className="empty">{dir?'Select a .tex file or ask Codex to create one.':'Choose a directory.'}</div>}</div>
      <section className="codex">{historyOpen&&<div className="chat-resizer" role="separator" aria-label="Resize chat history" aria-orientation="horizontal" aria-valuemin={48} aria-valuemax={500} aria-valuenow={historyHeight} tabIndex={0} onPointerDown={e=>{historyDrag.current={y:e.clientY,height:historyHeight};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(historyDrag.current)setHistoryHeight(Math.max(48,Math.min(500,historyDrag.current.height+historyDrag.current.y-e.clientY)));}} onPointerUp={()=>{historyDrag.current=null;}} onPointerCancel={()=>{historyDrag.current=null;}} onKeyDown={e=>{if(["ArrowUp","ArrowDown"].includes(e.key)){e.preventDefault();setHistoryHeight(h=>Math.max(48,Math.min(500,h+(e.key==="ArrowUp"?20:-20))));}}}/> }<div className="codex-title"><span>Codex</span><span className="status">{aiBusy?'Working…':''}</span><button aria-label={historyOpen?"Collapse chat history":"Expand chat history"} aria-expanded={historyOpen} onClick={()=>setHistoryOpen(!historyOpen)}>{historyOpen?<ChevronDown size={14}/>:<ChevronUp size={14}/>}</button></div>{historyOpen&&<div className="messages" style={{height:historyHeight}}>{!messages.length&&<span className="muted">No messages yet.</span>}{messages.map((m,i)=><div key={i}><strong>{m.role}</strong><p>{m.text}</p></div>)}</div>}<textarea aria-label="Codex request" placeholder="Ask Codex to edit or create a file, or convert a PDF…" disabled={!dir||aiBusy} value={prompt} onChange={e=>setPrompt(e.target.value)} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();send();}}}/><div className="codex-actions"><select aria-label="Attach PDF" value={source} disabled={aiBusy||!dir} onChange={e=>setSource(e.target.value)}><option value="">Attach PDF…</option>{pdfFiles.map(f=><option key={f.path} value={f.path}>{f.name}</option>)}</select><div className="spacer"/><button className="send" aria-label="Send to Codex" disabled={!prompt.trim()||!dir||aiBusy} onClick={send}><ArrowUp size={16}/></button></div></section>
      </section>
      <section className="right"><div className="panel-title"><span>PDF</span><div className="spacer"/><span className="status">{compiling?'Compiling…':pdf&&(pdf.editorPath!==doc?.path||pdf.editorRevision!==doc?.revision)?'Out of date':''}</span>{pdf&&<a href={fileURL(pdf.path,pdf.version)} download aria-label="Download PDF"><Download size={14}/></a>}</div><div className="preview">{pdf?<PdfPreview url={fileURL(pdf.path,pdf.version)} onSourceClick={jumpToSource}/>:<div className="empty">{compiling?'Compiling…':'No compiled PDF.'}</div>}</div></section>
    </main>
    {dialog&&<div className="backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label={dialog==='new'?'New file':dialog==='style'?'Writing style':'History'}><div className="dialog-title"><strong>{dialog==='new'?'New file':dialog==='style'?'Writing style':'History'}</strong><button aria-label="Close dialog" onClick={()=>setDialog(null)}><X size={16}/></button></div>
    {dialog==='new'&&<form onSubmit={e=>{e.preventDefault();createFile();}}><input autoFocus aria-label="Filename" value={newName} onChange={e=>setNewName(e.target.value)}/><div className="dialog-bottom"><div className="spacer"/><button className="primary" type="submit">Create</button></div></form>}
    {dialog==='style'&&<><textarea aria-label="Writing profile" className="style-editor" value={style} onChange={e=>setStyle(e.target.value)} placeholder="Writing preferences"/><div className="dialog-bottom"><span className="muted">{examples} saved edit examples</span><button disabled={!doc||aiBusy||!examples} onClick={suggestStyle}>Suggest notes</button><button onClick={async()=>{try{await api('/style/examples',{},'DELETE');setExamples(0);}catch(e){fail(e);}}}>Clear examples</button><button className="primary" onClick={async()=>{try{await api('/style',{text:style},'PUT');setDialog(null);}catch(e){fail(e);}}}>Save</button></div></>}
    {dialog==='history'&&<div className="history">{history.length?history.map(v=><button key={v.id} onClick={async()=>{try{await save();change(v.text);await save('restore');setDialog(null);}catch(e){fail(e);}}}>{new Date(v.date).toLocaleString()}<span>Restore</span></button>):<span className="muted">No saved versions.</span>}</div>}
    </section></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
