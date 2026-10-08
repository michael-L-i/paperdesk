import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDestination, destinationTop } from '../src/pdfLinks.js';

test('resolve named references and explicit zero-based destinations', async () => {
  const reference={num:17,gen:0}, dest=[reference,{name:'XYZ'},20,500,null];
  const pdf={numPages:3,getDestination:async name=>name==='section.2'?dest:null,getPageIndex:async ref=>{assert.equal(ref,reference);return 1;}};
  assert.deepEqual(await resolveDestination(pdf,'section.2'),{index:1,dest});
  const explicit=[0,{name:'Fit'}];
  assert.deepEqual(await resolveDestination(pdf,explicit),{index:0,dest:explicit});
  await assert.rejects(resolveDestination(pdf,'missing'),/no destination/);
  for (const ref of [-1,3,null,'bad']) await assert.rejects(resolveDestination(pdf,[ref,{name:'Fit'}]),/missing page/);
});

test('keep zoom while positioning point, fit-width, rectangle and page destinations', () => {
  const page={view:[0,0,600,800],getViewport:({scale})=>({
    width:600*scale,
    convertToViewportPoint:(x,y)=>[x*scale,(800-y)*scale],
  })};
  const top=(type,...coords)=>destinationTop(page,300,[0,{name:type},...coords]);
  assert.equal(top('XYZ',20,500,4),150);
  assert.equal(top('XYZ',null,null,null),0);
  assert.equal(top('FitH',600),100);
  assert.equal(top('FitBH',null),0);
  assert.equal(top('FitR',10,100,100,300),250);
  assert.equal(top('FitV',20),0);
  assert.equal(top('Fit'),0);
});
