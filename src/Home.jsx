import React, { useEffect, useState } from 'react';
import { FolderOpen, X, Plus, Trash2 } from 'lucide-react';
import { api } from './api.js';
const since=new Intl.RelativeTimeFormat(undefined,{numeric:'auto'});
function ago(date) {
  const seconds=(new Date(date)-Date.now())/1000;
  for(const [unit,size] of [['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60]])
    if(Math.abs(seconds)>=size) return since.format(Math.round(seconds/size),unit);
  return 'just now';
}
// Recent projects first, like Overleaf's dashboard.
export default function Home({ go }) {
  const [projects,setProjects]=useState(null), [query,setQuery]=useState(''), [error,setError]=useState('');
  const [menu,setMenu]=useState(false), [naming,setNaming]=useState(false), [name,setName]=useState('');
  const fail=e=>setError(e.message);
  const load=()=>api('/projects').then(setProjects,fail);
  useEffect(()=>{document.title='Paperdesk';load();},[]);
  async function openFolder() {
    setMenu(false);setError('');
    try{const picked=await api('/choose-directory',{});if(!picked.cancelled)go('/p/'+(await api('/projects',{path:picked.path})).id);}catch(e){fail(e);}
  }
  async function locate(p) {
    setError('');
    try{const picked=await api('/choose-directory',{});if(!picked.cancelled){await api('/projects/'+p.id+'/locate',{path:picked.path});await load();}}catch(e){fail(e);}
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
          <td className="location" title={p.path}>{p.missing?<button className="locate" title={'Was at '+p.path} onClick={()=>locate(p)}>Folder missing · Locate…</button>:p.kind==='library'?'Library':p.path.replace(/^\/Users\/[^/]+/,'~')}</td>
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
