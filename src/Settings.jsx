import React, { useEffect, useState } from 'react';
import { X, CircleCheck, CircleX } from 'lucide-react';
import { api } from './api.js';
// Setup checks, the agent to use, and where new projects go. Closes with true after saving.
export default function Settings({ onClose }) {
  const [s,setS]=useState(null), [error,setError]=useState('');
  const fail=e=>setError(e.message), set=patch=>setS(v=>({...v,...patch}));
  useEffect(()=>{api('/settings').then(setS,fail);},[]);
  const Status=({ok})=>ok?<CircleCheck size={14} className="ok" role="img" aria-label="Ready"/>:<CircleX size={14} className="missing" role="img" aria-label="Missing"/>;
  async function chooseLibrary(){try{const picked=await api('/choose-directory',{});if(!picked.cancelled)set({library:picked.path});}catch(e){fail(e);}}
  async function save(e){
    e.preventDefault();
    try{await api('/settings',{agent:s.agent,model:s.model,library:s.library},'PUT');onClose(true);}catch(e){fail(e);}
  }
  return <div className="backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-label="Settings">
    <div className="dialog-title"><strong>Settings</strong><button aria-label="Close dialog" onClick={()=>onClose(false)}><X size={16}/></button></div>
    {error&&<p className="settings-error" role="alert">{error}</p>}
    {s&&<form className="settings" onSubmit={save}>
      <h3>Setup</h3>
      {s.tools.map(t=><div key={t.name} className="check"><Status ok={t.ok}/><span>{t.name}</span><span className="muted">{t.purpose}.{!t.ok&&<> Install with <code>{t.fix}</code></>}</span></div>)}
      <h3>Agent</h3>
      {s.agents.map(a=><label key={a.id} className="check"><input type="radio" name="agent" checked={s.agent===a.id} disabled={!a.ok} onChange={()=>set({agent:a.id})}/><span>{a.name}</span><span className="muted">{a.ok?'Installed':<>Not found. Install with <code>{a.fix}</code></>}</span></label>)}
      <p className="muted">The agent uses the account you are signed in to in that tool, so run it once in a terminal first. The editor works without one.</p>
      <label className="field">Model<input aria-label="Model" placeholder="The tool's default" value={s.model} onChange={e=>set({model:e.target.value})}/></label>
      <h3>Library</h3>
      <div className="field"><input aria-label="Library folder" value={s.library} onChange={e=>set({library:e.target.value})}/><button type="button" onClick={chooseLibrary}>Choose…</button></div>
      <p className="muted">New blank projects are created here.</p>
      <div className="dialog-bottom"><button type="button" onClick={()=>api('/settings').then(({tools,agents})=>set({tools,agents}),fail)}>Check again</button><button className="primary" type="submit">Save</button></div>
    </form>}
  </section></div>;
}
