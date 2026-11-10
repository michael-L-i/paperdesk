import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus, FileText, Image, File, Star, Upload } from 'lucide-react';
import { textFile, imageFile, documentFile } from './api.js';
// Folders start collapsed, except those leading to the open file. Dropped files upload into the folder under them.
export default function FileTree({ files, open, main, disabled, onOpen, onMain, onNew, onUpload, uploadInput }) {
  const [expanded,setExpanded]=useState(()=>new Set()), [all,setAll]=useState(()=>localStorage.getItem('paperdesk:allFiles')==='true');
  const shown=all?files:files.filter(f=>documentFile(f)||f===open||f===main), others=files.length-shown.length;
  useEffect(()=>{
    const parts=open?.split('/').slice(0,-1)||[];
    if(parts.length) setExpanded(set=>new Set([...set,...parts.map((_,i)=>parts.slice(0,i+1).join('/')+'/')]));
  },[open]);
  const tree={};
  for(const file of shown){
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
      <button style={indent} disabled={disabled} title={file} onClick={()=>onOpen(file)}>{textFile(file)?<FileText size={13}/>:imageFile(file)?<Image size={13}/>:<File size={13}/>}<span>{name}</span></button>
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
    {(all||others>0)&&<button className="tree-more" onClick={()=>{setAll(!all);localStorage.setItem('paperdesk:allFiles',String(!all));}}>{all?'Show documents only':`Show ${others} other ${others===1?'file':'files'}`}</button>}
  </nav>;
}
