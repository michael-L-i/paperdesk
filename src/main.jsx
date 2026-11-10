import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import Editor from './Editor.jsx';
import Home from './Home.jsx';
function App() {
  const [route,setRoute]=useState(location.pathname);
  useEffect(()=>{const pop=()=>setRoute(location.pathname);addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop);},[]);
  const go=url=>{history.pushState(null,'',url);setRoute(url);};
  const id=route.match(/^\/p\/([\w-]+)$/)?.[1];
  return id?<Editor key={id} id={id} go={go}/>:<Home go={go}/>;
}
createRoot(document.getElementById('root')).render(<App/>);
