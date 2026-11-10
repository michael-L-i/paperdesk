import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Workspace, hash } from '../server/workspace.js';
import { sourceState, projectState } from '../server/project-state.js';

test('shared preview detects external edits, dependencies and replacement PDFs without build-output loops', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'paperdesk-state-'));
  const ws=new Workspace(root,'/unused');
  try {
    await fs.writeFile(path.join(root,'main.tex'),'main source');
    await fs.writeFile(path.join(root,'chapter.tex'),'chapter source');
    await fs.writeFile(path.join(root,'refs.bib'),'references');
    await fs.writeFile(path.join(root,'figure.png'),'image');
    const initial=await sourceState(ws);
    assert.equal((await projectState(ws,'main.tex','main.tex')).preview,null);
    const doc=await ws.read('main.tex');
    await fs.mkdir(path.join(root,'.paperdesk/sync'),{recursive:true});
    await fs.writeFile(path.join(root,'main.pdf'),'compiled pdf');
    await fs.writeFile(path.join(root,'.paperdesk/sync/main.tex.json'),JSON.stringify({fingerprint:initial.fingerprint,revision:doc.revision,pdfHash:hash('compiled pdf'),engine:'pdflatex'}));
    const state=await projectState(ws,'main.tex','chapter.tex');
    assert.equal(state.preview.current,true);
    assert.equal(state.doc.text,'chapter source');
    await fs.writeFile(path.join(root,'main.aux'),'build output');
    assert.equal((await sourceState(ws)).fingerprint,initial.fingerprint);
    for(const name of ['chapter.tex','refs.bib','figure.png']){
      const original=await fs.readFile(path.join(root,name));
      await fs.writeFile(path.join(root,name),'external edit');
      assert.equal((await projectState(ws,'main.tex','main.tex')).preview.current,false,name);
      await fs.writeFile(path.join(root,name),original);
    }
    await fs.writeFile(path.join(root,'main.pdf'),'external pdf');
    const replaced=await projectState(ws,'main.tex','main.tex');
    assert.equal(replaced.fingerprint,initial.fingerprint);
    assert.equal(replaced.preview.current,false);
    assert.notEqual(replaced.preview.version,state.preview.version);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});
