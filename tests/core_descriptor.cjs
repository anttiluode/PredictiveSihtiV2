'use strict';
// Regression: all 40 candidates share a center pixel and ZERO outer ring.
// Only their inner 3x3 shape distinguishes them; the old wide descriptor
// shortlists 28 of the first 40 and misses a late exact match.
const assert=require('node:assert/strict');
const {CoreBank,PatchBank}=require('../engine.js');
const zero=()=>new Float32Array(25);
const m=zero();
const core=new CoreBank({narrow:true});
const shape=i=>{const p=zero();p[12]=.5;p[11]=.11+i*.018;return p;};
for(let i=0;i<40;i++)core.store(shape(i),m,i*.02,i);
assert.equal(core.entries.length,40);
assert.equal(core.descriptor,'inner');
const q=core.query(shape(39),m,41,false);
assert.ok(q.confidence>.999999,`Exact inner-3x3 match must survive shortlist; got ${q.confidence}`);
assert.ok(q.mean>.65,`Late-stage prototype should control recall, got ${q.mean}`);
const local=new PatchBank(); assert.equal(local.descriptor,'wide');
const wide=new CoreBank({narrow:false});assert.equal(wide.descriptor,'wide');
const a=shape(0),b=shape(39);
assert.notEqual(a[11],b[11]);assert.equal(a[10],b[10]);
console.log('PASS: narrow-core shortlist uses inner-neighbor gradients; outer-only banks unchanged.');
