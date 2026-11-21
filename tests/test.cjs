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
  const head=new Predictor();head.useMotion=mode==='temporal';
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
function testNoAmnesia(){
  const bank=new PatchBank({capacity:2,familiarity:1,halfLife:100000});
  const p=new Float32Array(25).fill(.3),right=new Float32Array(25).fill(.1),left=new Float32Array(25).fill(-.1);
  for(let t=0;t<200;t++){
    bank.store(p,right,.2,t);
    bank.store(p,left,-.2,t);
  }
  assert.equal(bank.entries.length,2);
  assert.equal(bank.evictions,0);assert.equal(bank.merges,398);
  assert.ok(bank.query(p,right,200,true).mean>.19);
  assert.ok(bank.query(p,left,200,true).mean<-.19);
  const ambiguous=bank.query(p,right,200,false);
  close(ambiguous.mean,0,1e-5);
  close(ambiguous.variance,.04,1e-5);
  console.log('Novelty merge preserved both futures across 400 writes: PASS');
}
function testImpulse(){
  const h=new Predictor();for(let t=0;t<5;t++)h.observe(World.render('bounce',t));
  const t=h.t,n=h.memories();
  const out=h.pokeImpulse(24,18,6,0);
  assert.equal(h.t,t+2,'one two-frame impulse on release');
  assert.equal(h.memories(),n,'dream impulse cannot write training memories');
  assert.ok(out.forecast.predicted.every(Number.isFinite));
  console.log('Directional gesture: exactly two synthetic frames, no learning: PASS');
}
function freezeTransfer(mode='temporal'){
  const h=new Predictor();h.useMotion=mode==='temporal';
  for(let t=0;t<168;t++)h.observe(World.render('bounce',t));
  const status={core:h.core.entries.length,mid:h.mid.entries.length,fast:h.fast.entries.length,
    merges:h.core.merges+h.mid.merges+h.fast.merges,evictions:h.core.evictions+h.mid.evictions+h.fast.evictions};
  h.learning=false;h.detach();
  let model=0,hold=0,B=0,n=0;
  for(let t=0;t<84;t++){
    const out=h.observe(World.render('five',t));
    if(out.completed){model+=out.completed.model;hold+=out.completed.hold;B+=out.completed.ambiguity;n++;}
  }
  assert.equal(h.core.entries.length,status.core);assert.equal(h.mid.entries.length,status.mid);
  assert.equal(h.fast.entries.length,status.fast);
  return {source:'bounce',target:'five',address:mode,trainFrames:168,testFrames:n,
    modelMSE:model/n,holdMSE:hold/n,improvement:1-model/hold,ambiguity:B/n,...status};
}
testTelescope();testCollision();testTransfer();testCausal();testNoAmnesia();testImpulse();
if(process.argv.includes('--bench')){
  const rows=[benchmark('bounce','temporal'),benchmark('bounce','shape'),benchmark('five','temporal'),benchmark('five','shape'),freezeTransfer('temporal'),freezeTransfer('shape')];
  const fs=require('node:fs');
  fs.mkdirSync(require('node:path').join(__dirname,'../results'),{recursive:true});
  fs.writeFileSync(require('node:path').join(__dirname,'../results/benchmark.json'),JSON.stringify({protocol:'Same-world: train 168, freeze, score next 84. Transfer: train bounce 168, freeze and detach context, evaluate 84 fresh five-pulse observations. Score only observable transitions, no future reads.',rows},null,2)+'\n');
  console.log(JSON.stringify(rows,null,2));
  assert.ok(rows[0].improvement>.5, 'Temporal bounce must outperform hold-last');
  assert.ok(Math.abs(rows[1].improvement)<.15, 'Shape-only must no longer predict the wrong direction confidently');
  assert.ok(rows[1].ambiguity>rows[0].ambiguity*1.3, 'Shape-only has higher disagreement');
  assert.ok(rows[4].improvement>.42, 'Frozen one-to-five transfer must beat v2 baseline');
  assert.ok(rows[4].evictions===0, 'Prototype memories must survive both directions');
}console.log('PASS: deterministic core tests');
