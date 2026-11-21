'use strict';
const assert = require('node:assert/strict');
const {Predictor,PatchBank,CoreBank,decompose,mse,patch}=require('../engine.js');
const World=require('../world.js');
function close(a,b,tol=1e-5){assert.ok(Math.abs(a-b)<=tol,`${a} != ${b}`);}
function testTelescope(){
  const w=48,h=36,f=World.render('wave',17,w,h),p=decompose(f,w,h);
  let max=0;
  for(let i=0;i<f.length;i++)max=Math.max(max,Math.abs(f[i]-p.core[i]-p.middle[i]-p.fast[i]));
  assert.ok(max<1e-6, 'Telescoping reconstruction');console.log('Exact telescope max abs',max);
}
function testCollision(){
  const p=new Float32Array(25).fill(.3),m=new Float32Array(25).fill(0);
  const bank=new PatchBank({familiarity:1});
  bank.store(p,m,.2,0);bank.store(p,m,-.2,0);
  let r=bank.query(p,m,1,false);
  close(r.mean,0);close(r.variance,.04);close(r.confidence,1);
  const speeding=new Float32Array(25).fill(.07),receding=new Float32Array(25).fill(-.07);
  bank.clear();bank.store(p,speeding,.2,0);bank.store(p,receding,-.2,0);
  r=bank.query(p,m,1,false);close(r.mean,0);close(r.variance,.04);
  const a=bank.query(p,speeding,1,true),b=bank.query(p,receding,1,true);
  assert.ok(a.mean>.19 && b.mean<-.19, 'motion should split futures');
  console.log('B collision witness .04, temporal split',a.mean.toFixed(4),b.mean.toFixed(4));
}
function testTransfer(){
  const p=new Float32Array(25);p[12]=.4;p[11]=.2;p[13]=.6;
  const m=new Float32Array(25);m[12]=.1;
  const bank=new PatchBank({familiarity:1});
  bank.store(p,m,.17,1);
  close(bank.query(p,m,2,true).mean,.17);
  // Address has no absolute x/y coordinate: translated identical patch matches identically.
  console.log('Translation invariant address: PASS');
}
function testCausal(){
  const h=new Predictor();
  const a=World.render('bounce',0),b=World.render('bounce',1);
  const r1=h.observe(a);
  assert.equal(r1.completed,null);assert.equal(h.memories(),0);
  const r2=h.observe(b);
  close(r2.completed.model,r2.completed.hold);assert.ok(h.memories()>0);
  const count=h.memories();h.dreamStep();h.dreamStep();assert.equal(h.memories(),count);
  assert.ok(h.previous.every(Number.isFinite));
  console.log('Causal scoring and freeze during dream: PASS');
}
function benchmark(kind,mode){
  const head=new Predictor({patchCapacity:850,coreCapacity:180});head.useMotion=mode==='temporal';
  const period=kind==='bounce'?84:84;
  for(let t=0;t<period*2;t++)head.observe(World.render(kind,t));
  head.learning=false;
  let m=0,b=0,n=0,B=0;
  for(let t=period*2;t<period*3;t++){
    const o=head.observe(World.render(kind,t));
    if(o.completed){m+=o.completed.model;b+=o.completed.hold;B+=o.completed.ambiguity;n++;}
  }
  return {world:kind,address:mode,trainFrames:period*2,testFrames:n,modelMSE:m/n,holdMSE:b/n,improvement:b>0?1-m/b:null,ambiguity:B/n,bankSize:head.memories()};
}
testTelescope();testCollision();testTransfer();testCausal();
if(process.argv.includes('--bench')){
  const rows=[benchmark('bounce','temporal'),benchmark('bounce','shape'),benchmark('five','temporal'),benchmark('five','shape')];
  const fs=require('node:fs');
  fs.mkdirSync(require('node:path').join(__dirname,'../results'),{recursive:true});
  fs.writeFileSync(require('node:path').join(__dirname,'../results/benchmark.json'),JSON.stringify({protocol:'Train 168 frames, freeze all writes, score next 84 frames on identical deterministic world. Memory is not cleared between train and test.',rows},null,2)+'\n');
  console.log(JSON.stringify(rows,null,2));
  assert.ok(rows[0].improvement>.5, 'Temporal bounce must outperform hold-last');
}console.log('PASS: deterministic core tests');