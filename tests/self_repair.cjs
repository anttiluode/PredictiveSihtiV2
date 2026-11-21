'use strict';
// V2.2 causal self-repair ablation. Zero npm packages and no browser required.
// Train on completed transitions ONLY. Freeze or write AFTER scoring each next observation.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {Predictor,PatchBank,mse,decompose}=require('../engine.js'),World=require('../world.js');
const T=168,N=84;
function round(v,n=6){return +v.toFixed(n);}
function testSelfOpening(){
 const h=new Predictor({adaptive:true});h.thresholds.fast=0.00001;
 const b=new PatchBank({familiarity:1,temperature:.001});
 const p=new Float32Array(25).fill(.25),m1=new Float32Array(25).fill(.1),m2=new Float32Array(25).fill(-.1);
 b.store(p,m1,.2,0);b.store(p,m2,-.2,0);
 let r=h.readRoute(b,p,m1,'fast');
 assert.equal(r.gate,1,'ambiguity must recruit temporal history');
 assert.ok(r.shapeB>.0399&&r.read.mean>.19);
 const unknown=new Float32Array(25).fill(10);
 r=h.readRoute(b,unknown,m1,'fast');assert.equal(r.gate,0,'unfamiliar shape must not recruit history from B alone');
 b.clear();b.store(p,m1,.2,0);r=h.readRoute(b,p,m1,'fast');
 assert.equal(r.gate,0,'unique known future must not open extra temporal read');
 return 'high B + familiar matched alternative opens motion; novel and unambiguous addresses do not';
}
function train(){const h=new Predictor({adaptive:true});
 for(let t=0;t<T;t++)h.observe(World.render('bounce',t));
 assert.ok(h.writeStats.skipped>1000,'adaptive writer must actually skip redundant patch writes');
 assert.ok(h.writeStats.bootstrap>100,'calibration should build a useful initial bank');
 return h;
}
function copyFrozen(base,mode){
 const h=new Predictor({adaptive:mode==='auto',narrowCore:true});
 h.core.entries=base.core.entries;h.mid.entries=base.mid.entries;h.fast.entries=base.fast.entries;
 h.backgroundB={...base.backgroundB};h.t=base.t;h.learning=false;
 h.useMotion=mode==='temporal';return h;
}
function evalCycle(h,source='bounce',start=0,len=N){
 let model=0,hold=0,B=0,gates=0,familiar=0,n=0;
 for(let t=start;t<start+len;t++){
  const r=h.observe(World.render(source,t));
  if(!r.completed)continue;
  model+=r.completed.model;hold+=r.completed.hold;B+=r.completed.ambiguity;
  gates+=r.completed.recruited;familiar+=r.completed.familiarity;n++;
 }
 return {scored:n,predictionMSE:model/n,holdMSE:hold/n,improvement:hold?1-model/hold:null,
   B:B/n,recruitedFraction:gates/n,meanFamiliarity:familiar/n,prototypes:h.memories()};
}
function scoreSameBank(base){const out=[];
 for(const source of ['bounce','five'])for(const mode of ['shape','temporal','auto']){
   const h=copyFrozen(base,mode);out.push({source,mode,...evalCycle(h,source)});
 }
 return out;
}
function evalAdaptation(base,source,freeze){
 const h=copyFrozen(base,'auto');h.learning=!freeze;h.writePolicy='surprise';
 const pre=h.memories(),results=[];
 for(let k=0;k<3;k++){
   const r=evalCycle(h,source,k*N,N);
   results.push({cycle:k+1,...r,newPrototypes:h.memories()-pre,...{writeStats:{...h.writeStats}}});
 }
 assert.equal(h.memories(),freeze?pre:h.memories());
 return {source,freeze,initialPrototypes:pre,cycles:results};
}
function testDreamFrozen(base){
 const h=copyFrozen(base,'auto');h.observe(World.render('bounce',0));
 const mem=h.memories(),before=h.writeStats.stored;
 for(let i=0;i<6;i++)h.dreamStep();
 h.pokeImpulse(24,18,1,0);
 assert.equal(h.memories(),mem,'dream + flick may not learn from imaginary observations');
 assert.equal(h.writeStats.stored,before);
 assert.ok(h.previous.every(Number.isFinite));
 return 'dream prediction and flick never write memories';
}
function testLossless(){const frame=World.render('five',23),p=decompose(frame,48,36);
 for(let i=0;i<frame.length;i++)assert.ok(Math.abs(frame[i]-(p.core[i]+p.middle[i]+p.fast[i]))<1e-6);
 return 'frame = core + middle + fast for all pixels';
}
function main(){
 const evidence={version:'2.2',protocol:{train:'168 observed bounce frames, first 84 bootstrap, then selective writes',
 test:'same frozen trained bank for shape-only, always-temporal, and automatic routing; 84 target frames with detached context',
 adaptation:'three sequential 84-frame target blocks, frozen control versus selectively writable head; same initial bank',
 metadata:'No future observations enter retrieval. Extra target frames ARE training data only in writable condition.'},
 unit:{lossless:testLossless(),selfOpening:testSelfOpening()}};
 const h=train();evidence.train={prototypes:h.memories(),writeStats:{...h.writeStats},
 banks:{core:h.core.entries.length,middle:h.mid.entries.length,fast:h.fast.entries.length}};
 evidence.frozen=scoreSameBank(h);
 const bounceAuto=evidence.frozen.find(x=>x.mode==='auto'&&x.source==='bounce');
 const bounceShape=evidence.frozen.find(x=>x.mode==='shape'&&x.source==='bounce');
 const bounceTemporal=evidence.frozen.find(x=>x.mode==='temporal'&&x.source==='bounce');
 assert.ok(bounceAuto.improvement>bounceShape.improvement+.2,'automatic closure should improve significantly over blind shape-only');
 assert.ok(bounceAuto.recruitedFraction>.01&&bounceAuto.recruitedFraction<.5,'gates should actually be sparse');
 assert.ok(bounceTemporal.improvement>bounceShape.improvement,'motion baseline should carry distinction');
 evidence.adaptation=[];
 for(const source of ['five','wave'])for(const freeze of [true,false]){
   evidence.adaptation.push(evalAdaptation(h,source,freeze));
 }
 for(const source of ['five','wave']){
  const frozen=evidence.adaptation.find(x=>x.source===source&&x.freeze);
  const learn=evidence.adaptation.find(x=>x.source===source&&!x.freeze);
  assert.equal(frozen.cycles[2].newPrototypes,0);
  assert.ok(learn.cycles[2].newPrototypes>0,'new target should produce online writes');
  assert.ok(learn.cycles[2].improvement>frozen.cycles[2].improvement+.05,
    'online learner should exceed frozen control on '+source);
 }
 evidence.unit.dream=testDreamFrozen(h);
 evidence.pass=true;
 if(process.argv.includes('--bench')){
  const out=path.join(__dirname,'../results/self_repair.json');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(evidence,null,2)+'\n');
  console.log('Wrote '+out);
 }
 console.log('Self-repair control:',evidence.unit.selfOpening);
 console.log('Training writes:',JSON.stringify(evidence.train));
 console.table(evidence.frozen.map(x=>({source:x.source,mode:x.mode,
   improvement:(100*x.improvement).toFixed(1)+'%',route:(100*x.recruitedFraction).toFixed(1)+'%',
   B:round(x.B,7)})));
 console.table(evidence.adaptation.map(x=>({source:x.source,freeze:x.freeze,cycle1:(100*x.cycles[0].improvement).toFixed(1)+'%',
   cycle3:(100*x.cycles[2].improvement).toFixed(1)+'%',newPrototypes:x.cycles[2].newPrototypes})));
 console.log('PASS: causal automatic routing, selective observed writes, frozen controls, lossless Sihti, dream isolation');
}
main();
