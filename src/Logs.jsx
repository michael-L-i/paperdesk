import React from 'react';
import { X, CircleX, TriangleAlert, Info } from 'lucide-react';
// Compile results, like Overleaf's logs: errors, then warnings, then bad boxes.
const severities = [['error','errors',CircleX],['warning','warnings',TriangleAlert],['typesetting','typesetting',Info]];
export function LogsButton({ entries, open, onClick }) {
  const count = severity => entries.filter(e => e.severity === severity).length;
  const label = severities.map(([s,name]) => `${count(s)} ${name}`).join(', ');
  return <button className="logs-button" aria-label={'Logs: '+label} title={label} aria-pressed={open} onClick={onClick}>
    {severities.slice(0,2).map(([s,,Icon]) => count(s)>0&&<span key={s} className={'log-count is-'+s}><Icon size={13}/>{count(s)}</span>)}
    Logs
  </button>;
}
export function Logs({ logs, hasPdf, onReveal, onClose }) {
  const entries = logs ? severities.flatMap(([s]) => logs.entries.filter(e => e.severity === s)) : [];
  const Entry = ({ entry }) => { const Icon = severities.find(([s]) => s === entry.severity)[2]; return <div className={'log-entry is-'+entry.severity}>
    <div className="log-head"><Icon size={14}/><span className="log-message">{entry.message}</span>
      {entry.file?<button className="log-location" onClick={()=>onReveal(entry)}>{entry.file}{entry.line?', line '+entry.line:''}</button>:entry.origin&&<span className="log-location">{entry.origin}{entry.line?', line '+entry.line:''}</span>}</div>
    {entry.detail&&<pre>{entry.detail}</pre>}
  </div>; };
  const boxes = entries.filter(e => e.severity === 'typesetting');
  return <div className="logs" role="region" aria-label="Compile logs">
    <div className="logs-title"><strong>{logs?.failed?'Compile failed':'Compiled'}</strong><span className="muted">{logs?.failed&&hasPdf?'Showing the last PDF that compiled.':''}</span><div className="spacer"/><button aria-label="Close logs" title="Back to the PDF" onClick={onClose}><X size={14}/></button></div>
    {!entries.length&&<p className="muted logs-empty">{logs?'No errors or warnings.':'Compile to see the logs.'}</p>}
    {entries.filter(e => e.severity !== 'typesetting').map((entry,i) => <Entry key={i} entry={entry}/>)}
    {boxes.length>0&&<details className="log-boxes"><summary>{boxes.length} typesetting {boxes.length===1?'warning':'warnings'} (overfull or underfull boxes)</summary>{boxes.map((entry,i) => <Entry key={i} entry={entry}/>)}</details>}
  </div>;
}
