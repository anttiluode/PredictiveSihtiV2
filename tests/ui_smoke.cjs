'use strict';
// Minimal DOM/Canvas shim to test event wiring when graphical Chromium is restricted.
// Not a replacement for real Edge/Chrome screenshot/DevTools audit.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'..');const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]),elements={};
function ctx(){return {createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
 putImageData(){},fillRect(){},clearRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fillText(){},
 drawImage(){},getImageData(){return{data:new Uint8ClampedArray(48*36*4)}}};}
for(const id of ids){const listeners={},el={id,textContent:'',style:{},width:id==='trend'?850:48,height:id==='trend'?200:36,
 value:id==='rate'?'12':id==='source'?'bounce':id==='address'?'adaptive':'',
 checked:id==='learning',addEventListener(type,fn){(listeners[type]??=[]).push(fn);},
 dispatchEvent(event){for(const cb of listeners[event.type]||[])cb.call(el,event);},
 click(){el.dispatchEvent({type:'click'});},getContext(){return ctx();},
 getBoundingClientRect(){return {left:0,top:0,width:480,height:360};},
 setPointerCapture(){},pause(){},play(){return Promise.resolve();},
 removeAttribute(){},files:null};elements[id]=el;}
const blobs=[];
const context=vm.createContext({Float32Array,Uint8ClampedArray,Math,Array,Number,Promise,Blob,
 setTimeout(cb){cb();return 1;},clearTimeout(){},setInterval(){return 1;},clearInterval(){},
 URL:{createObjectURL(b){blobs.push(b);return 'blob:unit';},revokeObjectURL(){}},
 document:{getElementById(id){if(!elements[id])throw Error('Missing ID '+id);return elements[id];},
 createElement(tag){return {href:'',download:'',click(){}};}},
 window:{addEventListener(){}},console, navigator:{mediaDevices:null}});
context.globalThis=context;
for(const source of ['engine.js','world.js','app.js'])vm.runInContext(fs.readFileSync(path.join(dir,source),'utf8'),context,{filename:source});
function click(id){elements[id].click();}
function select(id,value){elements[id].value=value;elements[id].dispatchEvent({type:'change'});}
function check(pred,why){assert.ok(pred,why);}
for(let i=0;i<168;i++)click('step');
check(Number(elements.memories.textContent.replace(/,/g,''))>100,'memory populated from UI steps');
check(elements.mode.textContent==='AUTO','adaptive mode shown');
check(!String(elements.readout.textContent).includes('undefined'),'readout valid');
elements.learning.checked=false;elements.learning.dispatchEvent({type:'change'});
for(let i=0;i<84;i++)click('step');
check(elements.routes.textContent!=='0','motion routes shown in frozen auto');
select('address','shape');for(let i=0;i<3;i++)click('step');
select('address','temporal');for(let i=0;i<3;i++)click('step');
select('address','adaptive');
click('dream');check(elements.mode.textContent==='DREAM','dream mode starts');
for(let i=0;i<3;i++)click('step');click('dream');
check(elements.mode.textContent==='AUTO','return to live correctly resets display');
select('source','five');for(let i=0;i<3;i++)click('step');
click('export');check(blobs.length===1,'CSV created');
console.log('PASS: UI DOM boot, 168 steps, automatic routing, freeze, mode controls, free-run, return, source transfer and CSV');
