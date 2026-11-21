/* Predictive Sihti V2 — causal, dependency-free, multiscale associative predictor.
 * Plain script for file:// and CommonJS for deterministic Node tests.
 * Every memory item is a completed (address_t, observation_(t+1)-observation_t).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.PredictiveSihti = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  function mse(a, b) {
    let total = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; total += d * d; }
    return total / a.length;
  }
  function blur(frame, w, h, r) {
    if (!r) return Float32Array.from(frame);
    const tmp = new Float32Array(frame.length), out = new Float32Array(frame.length);
    const k = 2 * r + 1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dx = -r; dx <= r; dx++) s += frame[y * w + clamp(x + dx, 0, w - 1)];
      tmp[y * w + x] = s / k;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = -r; dy <= r; dy++) s += tmp[clamp(y + dy, 0, h - 1) * w + x];
      out[y * w + x] = s / k;
    }
    return out;
  }
  function decompose(frame, w, h) {
    const small = blur(frame, w, h, 2), core = blur(frame, w, h, 6);
    const middle = new Float32Array(frame.length), fast = new Float32Array(frame.length);
    for (let i = 0; i < frame.length; i++) {
      middle[i] = small[i] - core[i];
      fast[i] = frame[i] - small[i];
    }
    return {core, middle, fast};
  }
  function coarse(frame, w, h, gw = 8, gh = 6) {
    const out = new Float32Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor(gx * w / gw), x1 = Math.floor((gx + 1) * w / gw);
      const y0 = Math.floor(gy * h / gh), y1 = Math.floor((gy + 1) * h / gh);
      let sum = 0, count = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += frame[y * w + x]; count++; }
      out[gy * gw + gx] = sum / count;
    }
    return out;
  }
  const OFFSETS = [
    [-2,-2],[-1,-2],[0,-2],[1,-2],[2,-2],
    [-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],
    [-2,0],[-1,0],[0,0],[1,0],[2,0],
    [-2,1],[-1,1],[0,1],[1,1],[2,1],
    [-2,2],[-1,2],[0,2],[1,2],[2,2]
  ];
  function patch(field, x, y, w, h) {
    const a = new Float32Array(25);
    for (let j = 0; j < 25; j++) {
      const [dx, dy] = OFFSETS[j];
      a[j] = field[clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)];
    }
    return a;
  }
  function descriptors(p, m) {
    // An inexpensive shortlist, then exact 5x5 distance on finalists.
    return [p[12],p[10],p[14],p[2],p[22],m[12],m[10]-m[14],m[2]-m[22]];
  }
  function shortlistDist(a,b,useMotion) {
    let s = 0;
    for (let k = 0; k < (useMotion ? 8 : 5); k++) {
      const d = a[k] - b[k];
      s += d * d * (k >= 5 ? 2.8 : 1);
    }
    return s / (useMotion ? 8 : 5);
  }
  function fullDist(a,b,useMotion) {
    let s = 0;
    for (let i = 0; i < 25; i++) {
      const d = a.p[i]-b.p[i]; s += d*d;
      if (useMotion) { const m = a.m[i]-b.m[i]; s += 3*m*m; }
    }
    return s/25;
  }
  function topInsert(list, hit, n) {
    if (list.length === n && hit.d >= list[list.length-1].d) return;
    let i = 0;
    while(i < list.length && list[i].d <= hit.d) i++;
    list.splice(i, 0, hit);
    if (list.length > n) list.pop();
  }
  function blendNeighbors(hits, temperature, halfLife, now, familiarScale) {
    if (!hits.length) return {mean:0, variance:0, confidence:0, matches:0, distance:null};
    const first = hits[0].d;
    let z=0, firstMoment=0, secondMoment=0;
    for (const h of hits) {
      const weight = Math.exp(-(h.d-first)/temperature) * Math.pow(0.5, Math.max(0, now-h.entry.t)/halfLife);
      z+=weight;
      firstMoment+=weight*h.entry.value;
      secondMoment+=weight*h.entry.value*h.entry.value;
    }
    const mean = firstMoment/(z||1);
    const variance = Math.max(0, secondMoment/(z||1)-mean*mean);
    return {mean, variance, confidence:Math.exp(-first/familiarScale),matches:hits.length,distance:first};
  }
  class PatchBank {
    constructor({capacity=640,halfLife=380,temperature=0.0015,familiarity=0.008}={}) {
      this.capacity=capacity;this.halfLife=halfLife;this.temperature=temperature;this.familiarity=familiarity;
      this.entries=[];this.writes=0;
    }
    clear(){this.entries=[];this.writes=0;}
    store(p,m,value,t) {
      if (!Number.isFinite(value)) return;
      this.entries.push({p,m,desc:descriptors(p,m),value,t});this.writes++;
      if (this.entries.length>this.capacity) this.entries.shift();
    }
    query(p,m,t,useMotion=true) {
      if (!this.entries.length) return {mean:0,variance:0,confidence:0,distance:null,matches:0};
      const key={p,m,desc:descriptors(p,m)};
      const shortlist=[];
      for (let i=0;i<this.entries.length;i++) {
        const entry=this.entries[i];
        topInsert(shortlist,{d:shortlistDist(key.desc,entry.desc,useMotion),entry},12);
      }
      const best=[];
      for (const h of shortlist) topInsert(best,{d:fullDist(key,h.entry,useMotion),entry:h.entry},5);
      return blendNeighbors(best,this.temperature,this.halfLife,t,this.familiarity);
    }
  }
  class CoreBank {
    constructor({capacity=180,halfLife=400,temperature=0.0008,familiarity=0.005}={}) {
      Object.assign(this,{capacity,halfLife,temperature,familiarity});this.entries=[];
    }
    clear(){this.entries=[];}
    store(key,motion,delta,t) {
      this.entries.push({key,motion,delta,t});if(this.entries.length>this.capacity)this.entries.shift();
    }
    retrieve(key,motion,t,useMotion,N) {
      const mean = new Float32Array(N), b = new Float32Array(N);
      if (!this.entries.length) return {mean,b,confidence:0,distance:null};
      const hits=[];
      for (const entry of this.entries) {
        let d=0;
        for(let j=0;j<key.length;j++) {
          const a=key[j]-entry.key[j];d+=a*a;
          if(useMotion) {const m=motion[j]-entry.motion[j];d+=14*m*m;}
        }
        topInsert(hits,{d:d/key.length,entry},6);
      }
      const first=hits[0].d;
      let z=0;
      for (const hit of hits) {
        hit.weight=Math.exp(-(hit.d-first)/this.temperature)*Math.pow(0.5,Math.max(0,t-hit.entry.t)/this.halfLife);
        z+=hit.weight;
      }
      for (const hit of hits) {
        const a=hit.weight/(z||1),delta=hit.entry.delta;
        for (let j=0;j<N;j++){mean[j]+=a*delta[j];b[j]+=a*delta[j]*delta[j];}
      }
      for(let j=0;j<N;j++) b[j]=Math.max(0,b[j]-mean[j]*mean[j]);
      return {mean,b,confidence:Math.exp(-first/this.familiarity),distance:first};
    }
  }
  class Predictor {
    constructor({width=48,height=36,patchCapacity=650,coreCapacity=180,step=2}={}) {
      this.width=width;this.height=height;this.N=width*height;this.step=step;
      this.core=new CoreBank({capacity:coreCapacity});
      this.mid=new PatchBank({capacity:patchCapacity});
      this.fast=new PatchBank({capacity:patchCapacity});
      this.useMotion=true;this.learning=true;this.reset();
    }
    reset(){
      this.core.clear();this.mid.clear();this.fast.clear();this.t=0;
      this.trials=[];this.last=null;this.detach();
    }
    detach(){this.previous=null;this.previousParts=null;this.beforePreviousParts=null;this.pending=null;}
    memories(){return this.core.entries.length+this.mid.entries.length+this.fast.entries.length;}
    motionField(now,old) {
      const a=new Float32Array(this.N);
      if(old) for (let i=0;i<this.N;i++)a[i]=now[i]-old[i];
      return a;
    }
    predict(frame,prevFrame=null) {
      if(frame.length!==this.N) throw Error('Frame length mismatch');
      const parts=decompose(frame,this.width,this.height);
      const old=prevFrame?decompose(prevFrame,this.width,this.height):null;
      const key=coarse(parts.core,this.width,this.height);
      const prevKey=old?coarse(old.core,this.width,this.height):null;
      const motion=key.map((v,i)=>v-(prevKey?prevKey[i]:v));
      const core=this.core.retrieve(key,motion,this.t,this.useMotion,this.N);
      const delta=new Float32Array(this.N), variance=new Float32Array(this.N);
      for(let i=0;i<this.N;i++) {
        delta[i]=core.mean[i]*core.confidence;
        variance[i]=core.b[i]*core.confidence;
      }
      // Shared 5x5 patches. Sample every `step` pixels and bilinearly spread the
      // predicted centre delta / disagreement to adjacent pixels.
      const local=[];
      for (const [name,bank] of [['middle',this.mid],['fast',this.fast]]) {
        const field=parts[name],oldField=old?old[name]:null;
        const mf=this.motionField(field,oldField);
        const gw=Math.ceil(this.width/this.step),gh=Math.ceil(this.height/this.step);
        const means=new Float32Array(gw*gh),uncert=new Float32Array(gw*gh);
        let sumConf=0,sumVar=0;
        for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++) {
          const x=gx*this.step,y=gy*this.step;
          const p=patch(field,x,y,this.width,this.height),m=patch(mf,x,y,this.width,this.height);
          const r=bank.query(p,m,this.t,this.useMotion);
          const k=gy*gw+gx;
          means[k]=r.mean*r.confidence;
          uncert[k]=r.variance*r.confidence;
          sumConf+=r.confidence;sumVar+=r.variance*r.confidence;
        }
        local.push({name,bank,confidence:sumConf/(gw*gh),B:sumVar/(gw*gh)});
        for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) {
          const xx=x/this.step,yy=y/this.step;
          const x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(gw-1,x0+1),y1=Math.min(gh-1,y0+1);
          const ax=xx-x0,ay=yy-y0;
          const sample=a=>(1-ay)*((1-ax)*a[y0*gw+x0]+ax*a[y0*gw+x1])+
            ay*((1-ax)*a[y1*gw+x0]+ax*a[y1*gw+x1]);
          const j=y*this.width+x;delta[j]+=sample(means);variance[j]+=sample(uncert);
        }
      }
      const predicted=new Float32Array(this.N);
      for(let i=0;i<this.N;i++)predicted[i]=clamp(frame[i]+delta[i],0,1);
      return {predicted,delta,variance,parts,key,motion,
        confidence:{core:core.confidence,middle:local[0].confidence,fast:local[1].confidence},
        bandB:{middle:local[0].B,fast:local[1].B},coreB:core.b.reduce((a,b)=>a+b,0)/this.N};
    }
    sampleLearning(prevParts,nowParts,oldPreviousParts,t) {
      // Stratified salience sampling: prioritize signal transitions and retain a few quiet patches.
      // The bank is spatially shared and has no absolute (x,y) in its address.
      for(const [name,bank] of [['middle',this.mid],['fast',this.fast]]) {
        const before=prevParts[name],after=nowParts[name];
        const earlier=oldPreviousParts?oldPreviousParts[name]:null;
        const motion=this.motionField(before,earlier);
        const candidates=[];
        for(let y=2;y<this.height-2;y+=2)for(let x=2;x<this.width-2;x+=2) {
          const i=y*this.width+x,delta=after[i]-before[i];
          const sal=Math.abs(delta)*2+Math.abs(before[i])*0.6+Math.abs(motion[i]);
          // Deterministic pseudo-jitter to cover locations with similar salience.
          const jitter=((x*97+y*131+t*59)%101)/101*0.006;
          topInsert(candidates,{d:-(sal+jitter),x,y},18);
        }
        for(const {x,y} of candidates) {
          const p=patch(before,x,y,this.width,this.height),m=patch(motion,x,y,this.width,this.height);
          const i=y*this.width+x;
          bank.store(p,m,after[i]-before[i],t);
        }
      }
    }
    /** Observe a new frame; score the previous forecast BEFORE writing this transition. */
    observe(input) {
      const frame=Float32Array.from(input);
      if(frame.length!==this.N)throw Error('Frame length mismatch');
      let completed=null;
      if(this.previous) {
        const err=new Float32Array(this.N);
        for(let i=0;i<this.N;i++)err[i]=frame[i]-this.pending.predicted[i];
        const model=mse(frame,this.pending.predicted),hold=mse(frame,this.previous);
        const ambiguity=this.pending.variance.reduce((a,v)=>a+v,0)/this.N;
        completed={model,hold,error:err,ambiguity,confidence:this.pending.confidence,
          gain:hold>1e-12?1-model/hold:0,frame:this.t};
        if(this.trials.length>=1200)this.trials.shift();
        this.trials.push({t:this.t,model,hold,ambiguity});
        if(this.learning) {
          const previousKey=coarse(this.previousParts.core,this.width,this.height);
          const earlier=this.beforePreviousParts?coarse(this.beforePreviousParts.core,this.width,this.height):null;
          const cm=previousKey.map((v,i)=>v-(earlier?earlier[i]:v));
          const coreDelta=new Float32Array(this.N);
          const nowParts=decompose(frame,this.width,this.height);
          const nowCore=nowParts.core;
          for(let i=0;i<this.N;i++)coreDelta[i]=nowCore[i]-this.previousParts.core[i];
          this.core.store(previousKey,cm,coreDelta,this.t);
          this.sampleLearning(this.previousParts,nowParts,this.beforePreviousParts,this.t);
        }
      }
      const forecast=this.predict(frame,this.previous);
      this.beforePreviousParts=this.previousParts;
      this.previousParts=forecast.parts;
      this.previous=frame;
      this.pending=forecast;this.t++;this.last=completed;
      return {forecast,completed,frames:this.t,memories:this.memories()};
    }
    /** No memory writes, no observation: iterative prediction may drift. */
    dreamStep() {
      if(!this.previous) return null;
      const next=this.pending.predicted;
      const out=this.observeDream(next);
      return out;
    }
    observeDream(frame) {
      const old=this.previous;
      const forecast=this.predict(frame,old);
      this.beforePreviousParts=this.previousParts;
      this.previousParts=forecast.parts;
      this.previous=Float32Array.from(frame);
      this.pending=forecast;this.t++;
      return {forecast,frames:this.t,memories:this.memories()};
    }
    poke(x,y,radius=3,amount=0.7) {
      if(!this.previous)return null;
      const frame=Float32Array.from(this.previous);
      for(let yy=0;yy<this.height;yy++)for(let xx=0;xx<this.width;xx++) {
        const dist2=(xx-x)**2+(yy-y)**2;
        const i=yy*this.width+xx;
        frame[i]=clamp(frame[i]+amount*Math.exp(-dist2/(2*radius*radius)),0,1);
      }
      return this.observeDream(frame);
    }
  }
  return {Predictor,PatchBank,CoreBank,decompose,blur,coarse,mse,patch};
});
