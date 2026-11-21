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
  // 3x3 support, held in a 5x5 descriptor for common bank distances.
  // On the 12x9 core grid this reads 12x12 image pixels, not 20x20.
  function corePatch(field,x,y,w,h,narrow=false) {
    const out=patch(field,x,y,w,h);
    if(narrow)for(let k=0;k<25;k++){
      const [dx,dy]=OFFSETS[k];
      if(Math.abs(dx)>1||Math.abs(dy)>1)out[k]=0;
    }
    return out;
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
  // A learned local transition is a prototype, not a FIFO video frame.
  // Merge near-identical addresses only when the associated deltas agree.
  // Crucially, opposite velocities / outcomes remain separate prototypes, so
  // shape-only retrieval can expose their disagreement as B.
  class PatchBank {
    constructor({capacity=2400,halfLife=2400,temperature=0.0015,
      familiarity=0.008,mergeDistance=0.00018,mergeValue=0.014}={}) {
      Object.assign(this,{capacity,halfLife,temperature,familiarity,mergeDistance,mergeValue});
      this.entries=[];this.writes=0;this.merges=0;this.evictions=0;
    }
    clear(){this.entries=[];this.writes=0;this.merges=0;this.evictions=0;}
    store(p,m,value,t) {
      if(!Number.isFinite(value))return false;
      const desc=descriptors(p,m),incoming={p,m,desc};
      let nearest=null,best=this.mergeDistance;
      for(const entry of this.entries) {
        // Even in Shape-only *read* mode, storage retains motion so that a
        // reversal is not merged into the opposite-future prototype.
        if(Math.abs(entry.value-value)>this.mergeValue)continue;
        if(shortlistDist(desc,entry.desc,true)>best)continue;
        const d=fullDist(incoming,entry,true);
        if(d<best){best=d;nearest=entry;}
      }
      if(nearest) {
        // Bound the averaging rate so a recent repeated state doesn't erase
        // an old, distinct physical transition.
        const rate=1/Math.min(16,nearest.count+1);
        nearest.value+=rate*(value-nearest.value);
        nearest.count++;nearest.t=t;this.merges++;
        return false;
      }
      if(this.entries.length>=this.capacity) {
        // Evict the stalest, least supported prototype rather than FIFO.
        // No position is stored anywhere in the address.
        let index=0,oldest=Infinity;
        for(let i=0;i<this.entries.length;i++){
          const e=this.entries[i];
          const score=e.t+Math.min(80,e.count*6);
          if(score<oldest){oldest=score;index=i;}
        }
        this.entries.splice(index,1);this.evictions++;
      }
      this.entries.push({p,m,desc,value,t,count:1});this.writes++;
      return true;
    }
    query(p,m,t,useMotion=true) {
      if(!this.entries.length)return {mean:0,variance:0,confidence:0,distance:null,matches:0};
      const key={p,m,desc:descriptors(p,m)},shortlist=[];
      for(const entry of this.entries) {
        topInsert(shortlist,{d:shortlistDist(key.desc,entry.desc,useMotion),entry},28);
      }
      const best=[];
      for(const h of shortlist)topInsert(best,{d:fullDist(key,h.entry,useMotion),entry:h.entry},14);
      return blendNeighbors(best,this.temperature,this.halfLife,t,this.familiarity);
    }
  }
  class CoreBank extends PatchBank {
    constructor({capacity=600}={}) {
      super({capacity,halfLife:2400,temperature:0.00038,
        familiarity:0.003,mergeDistance:0.000075,mergeValue:0.006});
    }
  }
  // Upscale one coarse-grid scalar predictor to a full-resolution scalar field.
  function upsampleScalar(low,gw,gh,w,h) {
    const out=new Float32Array(w*h);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const xx=clamp((x+.5)*gw/w-.5,0,gw-1);
      const yy=clamp((y+.5)*gh/h-.5,0,gh-1);
      const x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(gw-1,x0+1),y1=Math.min(gh-1,y0+1);
      const ax=xx-x0,ay=yy-y0;
      out[y*w+x]=(1-ay)*((1-ax)*low[y0*gw+x0]+ax*low[y0*gw+x1])+
        ay*((1-ax)*low[y1*gw+x0]+ax*low[y1*gw+x1]);
    }
    return out;
  }
  class Predictor {
    constructor({width=48,height=36,patchCapacity=2400,coreCapacity=600,step=2,
      adaptive=false,narrowCore=adaptive}={}) {
      this.width=width;this.height=height;this.N=width*height;this.step=step;
      // Adaptive mode starts blind: the mean forecast uses shape-only until
      // competing recalled transitions justify a temporal query locally.
      this.adaptive=adaptive;this.narrowCore=narrowCore;
      this.writePolicy=adaptive?'surprise':'always';
      this.thresholds={core:0.00002,middle:0.00004,fast:0.00002};
      this.backgroundB={core:0,middle:0,fast:0};
      this.writeStats={stored:0,merges:0,skipped:0,novelty:0,surprise:0,bootstrap:0};
      this.core=new CoreBank({capacity:coreCapacity});
      this.mid=new PatchBank({capacity:patchCapacity});
      this.fast=new PatchBank({capacity:patchCapacity});
      this.useMotion=true;this.learning=true;this.reset();
    }
    reset(){
      this.core.clear();this.mid.clear();this.fast.clear();this.t=0;
      this.trials=[];this.last=null;
      this.writeStats={stored:0,merges:0,skipped:0,novelty:0,surprise:0,bootstrap:0};
      this.backgroundB={core:0,middle:0,fast:0};
      this.lastWrite=null;this.detach();
    }
    detach(){this.previous=null;this.previousParts=null;this.beforePreviousParts=null;this.pending=null;}
    memories(){return this.core.entries.length+this.mid.entries.length+this.fast.entries.length;}
    motionField(now,old) {
      const a=new Float32Array(this.N);
      if(old) for (let i=0;i<this.N;i++)a[i]=now[i]-old[i];
      return a;
    }
    updateBackground(name,variances) {
      if(!this.adaptive || !variances.length)return;
      const sorted=variances.slice().sort((a,b)=>a-b);
      const median=sorted[Math.floor(sorted.length*.5)];
      // Estimate background disagreement causally from current addresses,
      // not from the future observation or any ground-truth label.
      this.backgroundB[name]=this.backgroundB[name] ?
        0.75*this.backgroundB[name]+0.25*median : median;
    }
    readRoute(bank,p,m,name) {
      if(!this.adaptive)return {read:bank.query(p,m,this.t,this.useMotion),shapeB:null,shapeConf:null,gate:0};
      // A *pre-repair* shape-only variance is the physical collision witness.
      const a=bank.query(p,m,this.t,false);
      // Only a remembered, genuinely multimodal address can recruit history.
      // A novel address is NOT evidence of two incompatible futures.
      if(a.confidence<0.65 || a.variance<Math.max(this.thresholds[name],3*this.backgroundB[name]))
        return {read:a,shapeB:a.variance,shapeConf:a.confidence,gate:0};
      const b=bank.query(p,m,this.t,true);
      // History must actually separate the alternatives. Otherwise we keep
      // the coarse read and display the unresolved disagreement.
      if(b.confidence<0.45 || b.variance>Math.max(0.85*a.variance,a.variance-1e-9))
        return {read:a,shapeB:a.variance,shapeConf:a.confidence,gate:0};
      return {read:b,shapeB:a.variance,shapeConf:a.confidence,gate:1};
    }
    predict(frame,prevFrame=null) {
      if(frame.length!==this.N) throw Error('Frame length mismatch');
      const parts=decompose(frame,this.width,this.height);
      const old=prevFrame?decompose(prevFrame,this.width,this.height):null;
      // A spatially shared core head on an 12x9 low-resolution field.
      // It has NO whole-frame coordinates or global scene familiarity gate.
      const cw=12,ch=9;
      const key=coarse(parts.core,this.width,this.height,cw,ch);
      const prevKey=old?coarse(old.core,this.width,this.height,cw,ch):null;
      const motion=key.map((v,i)=>v-(prevKey?prevKey[i]:v));
      const cmean=new Float32Array(cw*ch),cb=new Float32Array(cw*ch);
      const cmatches=new Float32Array(cw*ch),cgates=new Float32Array(cw*ch);
      let coreConf=0,coreB=0,coreGates=0;const coreBackground=[];
      for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
        const i=y*cw+x;
        const r0=this.readRoute(this.core,corePatch(key,x,y,cw,ch,this.narrowCore),
          corePatch(motion,x,y,cw,ch,this.narrowCore),'core');
        const r=r0.read;
        cmean[i]=r.mean*r.confidence;
        cb[i]=(r0.shapeB??r.variance)*(r0.shapeConf??r.confidence);
        cmatches[i]=r0.shapeConf??r.confidence;cgates[i]=r0.gate;
        coreGates+=r0.gate;
        coreConf+=r.confidence;coreB+=cb[i];coreBackground.push(r0.shapeB??r.variance);
      }
      this.updateBackground('core',coreBackground);
      const delta=upsampleScalar(cmean,cw,ch,this.width,this.height);
      const variance=upsampleScalar(cb,cw,ch,this.width,this.height);
      const familiarity=upsampleScalar(cmatches,cw,ch,this.width,this.height);
      const recruitment=upsampleScalar(cgates,cw,ch,this.width,this.height);
      // Shared 5x5 patches. Sample every `step` pixels and bilinearly spread the
      // predicted centre delta / disagreement to adjacent pixels.
      const local=[];
      for (const [name,bank] of [['middle',this.mid],['fast',this.fast]]) {
        const field=parts[name],oldField=old?old[name]:null;
        const mf=this.motionField(field,oldField);
        const gw=Math.ceil(this.width/this.step),gh=Math.ceil(this.height/this.step);
        const means=new Float32Array(gw*gh),uncert=new Float32Array(gw*gh);
        const localConf=new Float32Array(gw*gh),localGate=new Float32Array(gw*gh);
        let sumConf=0,sumVar=0,sumGates=0;const bandBackground=[];
        for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++) {
          const x=gx*this.step,y=gy*this.step;
          const p=patch(field,x,y,this.width,this.height),m=patch(mf,x,y,this.width,this.height);
          const r0=this.readRoute(bank,p,m,name),r=r0.read;
          const k=gy*gw+gx;
          means[k]=r.mean*r.confidence;
          uncert[k]=(r0.shapeB??r.variance)*(r0.shapeConf??r.confidence);
          localConf[k]=r0.shapeConf??r.confidence;localGate[k]=r0.gate;
          sumConf+=r.confidence;sumVar+=uncert[k];sumGates+=r0.gate;
          bandBackground.push(r0.shapeB??r.variance);
        }
        this.updateBackground(name,bandBackground);
        local.push({name,bank,confidence:sumConf/(gw*gh),B:sumVar/(gw*gh),gates:sumGates});
        for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) {
          const xx=x/this.step,yy=y/this.step;
          const x0=Math.floor(xx),y0=Math.floor(yy),x1=Math.min(gw-1,x0+1),y1=Math.min(gh-1,y0+1);
          const ax=xx-x0,ay=yy-y0;
          const sample=a=>(1-ay)*((1-ax)*a[y0*gw+x0]+ax*a[y0*gw+x1])+
            ay*((1-ax)*a[y1*gw+x0]+ax*a[y1*gw+x1]);
          const j=y*this.width+x;
          delta[j]+=sample(means);variance[j]+=sample(uncert);
          familiarity[j]+=sample(localConf);recruitment[j]+=sample(localGate);
        }
      }
      const predicted=new Float32Array(this.N);
      for(let i=0;i<this.N;i++){
        predicted[i]=clamp(frame[i]+delta[i],0,1);
        familiarity[i]/=3;recruitment[i]/=3;
      }
      return {predicted,delta,variance,familiarity,recruitment,parts,key,motion,
        gates:{core:coreGates,middle:local[0].gates,fast:local[1].gates},
        confidence:{core:coreConf/(cw*ch),middle:local[0].confidence,fast:local[1].confidence},
        bandB:{middle:local[0].B,fast:local[1].B},coreB:coreB/(cw*ch)};
    }
    sampleLearning(prevParts,nowParts,oldPreviousParts,t,previousForecast=null,error=null) {
      const counts={stored:0,merges:0,skipped:0,novelty:0,surprise:0,bootstrap:0};
      const eligible=(x,y,threshold=.009)=>{
        if(this.writePolicy==='always'||!previousForecast||!error)return 'always';
        // One cycle is a predetermined calibration budget, not an oracle.
        // It sees each direction before selective writing begins.
        if(t<=84)return 'bootstrap';
        const i=y*this.width+x;
        let shock=0;
        for(let yy=Math.max(0,y-2);yy<=Math.min(this.height-1,y+2);yy++)
          for(let xx=Math.max(0,x-2);xx<=Math.min(this.width-1,x+2);xx++)
            shock=Math.max(shock,Math.abs(error[yy*this.width+xx]));
        const conf=previousForecast.familiarity[i];
        // A surprised and unfamiliar patch may add a bridge; a high-B but
        // familiar patch instead asks for more history via readRoute().
        // Unseen motion with familiar shape also causes low temporal confidence.
        const novel=conf<.70;
        if(novel && shock>threshold)return 'novelty';
        // Small fallback for strongly contradicted known predictions, e.g.
        // interventions, with bounded write rate.
        if(shock>threshold*5 && (t%7===0))return 'surprise';
        return null;
      };
      const store=(bank,p,m,value,t,reason)=>{
        if(!reason){counts.skipped++;return;}
        const before=bank.entries.length;
        bank.store(p,m,value,t);
        if(bank.entries.length>before)counts.stored++;else counts.merges++;
        if(reason in counts)counts[reason]++;
      };
      // Choose 16 salient *spatially spaced* patches plus two quiet controls.
      // Similar address+delta observations refresh a prototype rather than
      // consuming a fresh slot. Background is deliberately sampled too.
      for(const [name,bank] of [['middle',this.mid],['fast',this.fast]]) {
        const before=prevParts[name],after=nowParts[name];
        const earlier=oldPreviousParts?oldPreviousParts[name]:null;
        const motion=this.motionField(before,earlier),candidates=[];
        for(let y=2;y<this.height-2;y+=2)for(let x=2;x<this.width-2;x+=2) {
          const i=y*this.width+x,d=after[i]-before[i];
          const sal=Math.abs(d)*2+Math.abs(before[i])*.6+Math.abs(motion[i]);
          const jitter=((x*97+y*131+t*59)%101)/101*0.0005;
          candidates.push({sal:sal+jitter,x,y});
        }
        candidates.sort((a,b)=>b.sal-a.sal);
        const picked=[];
        for(const c of candidates) {
          if(picked.length>=16)break;
          if(picked.every(q=>(q.x-c.x)**2+(q.y-c.y)**2>=16))picked.push(c);
        }
        // Quiet anchors cycle through the bottom quarter rather than being
        // accidentally excluded by top-salience sampling.
        const low=candidates.slice(Math.floor(candidates.length*.75));
        if(low.length) {
          for(let k=0;k<2;k++)picked.push(low[(t*13+k*Math.floor(low.length/2))%low.length]);
        }
        for(const {x,y} of picked) {
          const p=patch(before,x,y,this.width,this.height),m=patch(motion,x,y,this.width,this.height);
          const i=y*this.width+x;
          store(bank,p,m,after[i]-before[i],t,eligible(x,y));
        }
      }
      // Core prototypes live in DOWN-SAMPLED spatial coordinates and therefore
      // transfer to other locations. Retain motion direction at write time.
      const cw=12,ch=9;
      const before=coarse(prevParts.core,this.width,this.height,cw,ch);
      const after=coarse(nowParts.core,this.width,this.height,cw,ch);
      const older=oldPreviousParts?coarse(oldPreviousParts.core,this.width,this.height,cw,ch):null;
      const motion=before.map((v,i)=>v-(older?older[i]:v));
      const candidates=[];
      for(let y=0;y<ch;y++)for(let x=0;x<cw;x++){
        const i=y*cw+x;
        candidates.push({x,y,sal:Math.abs(after[i]-before[i])*3+Math.abs(motion[i])+Math.abs(before[i]-.035)*.2});
      }
      candidates.sort((a,b)=>b.sal-a.sal);
      const picked=[];
      for(const c of candidates){if(picked.length>=14)break;
        if(picked.every(q=>(q.x-c.x)**2+(q.y-c.y)**2>=4))picked.push(c);
      }
      const low=candidates.slice(Math.floor(candidates.length*.75));
      for(let k=0;k<2;k++)picked.push(low[(t*7+k*13)%low.length]);
      for(const {x,y} of picked) {
        const i=y*cw+x;
        store(this.core,corePatch(before,x,y,cw,ch,this.narrowCore),
          corePatch(motion,x,y,cw,ch,this.narrowCore),after[i]-before[i],t,
          eligible(Math.round((x+.5)*this.width/cw-.5),Math.round((y+.5)*this.height/ch-.5),.006));
      }
      this.writeStats.stored+=counts.stored;
      this.writeStats.merges+=counts.merges;
      this.writeStats.skipped+=counts.skipped;
      this.writeStats.novelty+=counts.novelty;
      this.writeStats.surprise+=counts.surprise;
      this.writeStats.bootstrap+=counts.bootstrap;
      this.lastWrite=counts;
      return counts;
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
        let fam=0, gated=0;
        for(let i=0;i<this.N;i++){fam+=this.pending.familiarity[i];gated+=this.pending.recruitment[i];}
        fam/=this.N;gated/=this.N;
        completed={model,hold,error:err,ambiguity,familiarity:fam,recruited:gated,
          gates:this.pending.gates,confidence:this.pending.confidence,
          diagnosis:ambiguity>.00012&&fam>.65?'ambiguous-recall':
            Math.sqrt(model)>.018&&fam<.55?'unfamiliar-surprise':'unresolved',
          gain:hold>1e-12?1-model/hold:0,frame:this.t};
        if(this.trials.length>=1200)this.trials.shift();
        this.trials.push({t:this.t,model,hold,ambiguity,familiarity:fam,recruited:gated});
        if(this.learning) {
          const nowParts=decompose(frame,this.width,this.height);
          completed.writes=this.sampleLearning(this.previousParts,nowParts,this.beforePreviousParts,
            this.t,this.pending,err);
        }else completed.writes={frozen:true,stored:0,merges:0,skipped:0};
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
      this.stamp(frame,x,y,radius,amount);
      return this.observeDream(frame);
    }
    stamp(frame,x,y,radius,amount) {
      for(let yy=0;yy<this.height;yy++)for(let xx=0;xx<this.width;xx++){
        const d=(xx-x)**2+(yy-y)**2,i=yy*this.width+xx;
        frame[i]=clamp(frame[i]+amount*Math.exp(-d/(2*radius*radius)),0,1);
      }
      return frame;
    }
    pokeImpulse(x,y,dx,dy,radius=2.2,amount=.75) {
      if(!this.previous)return null;
      dx=clamp(dx,-9,9);dy=clamp(dy,-9,9);
      if(Math.hypot(dx,dy)<.8)return this.poke(x,y,radius,amount);
      // Two synthetic *observations*, one shifted relative to the other,
      // create a directional leading/trailing difference at the patch head.
      // Neither observation writes memory or counts as a real-world test.
      const base=Float32Array.from(this.previous);
      const before=Float32Array.from(base),after=Float32Array.from(base);
      this.stamp(before,x-dx,y-dy,radius,amount);
      this.stamp(after,x,y,radius,amount);
      this.observeDream(before);
      return this.observeDream(after);
    }

  }
  return {Predictor,PatchBank,CoreBank,decompose,blur,coarse,mse,patch,corePatch};
});

