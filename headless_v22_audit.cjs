#!/usr/bin/env node
/*
 * Predictive Sihti V2.2: active routing Chromium UI audit v2.2, detached-state-safe.
 * Node.js >=22 required (built-in WebSocket and fetch). Run in folder containing
 * index.html, app.js, engine.js, world.js. Never edits those application files.
 *
 * node headless_sihti_audit.cjs
 * node headless_sihti_audit.cjs --browser "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
 * node headless_sihti_audit.cjs --dir "E:\\my\\PredictiveSihtiV2"
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),http=require('node:http');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const zlib=require('node:zlib'),crypto=require('node:crypto');
const args=process.argv.slice(2);
const opt=(key,fallback)=>{const i=args.indexOf(key);return i>=0?args[i+1]:fallback;};
const folder=path.resolve(opt('--dir',__dirname));
const root=path.resolve(opt('--out',path.join(folder,'headless_receipt')));
const required=['index.html','engine.js','world.js','app.js'];
const timestamp=new Date().toISOString().replace(/[:.]/g,'-');
const out=path.join(root,timestamp);
let browser=null,cdp=null,server=null,activeReport=null;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function log(s){console.log(`[audit] ${s}`);}
function findBrowser(){
  const c=[];if(opt('--browser',null))c.push(opt('--browser',null));
  for(const base of [process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES,process.env.LOCALAPPDATA]){
    if(base)for(const p of ['Microsoft/Edge/Application/msedge.exe','Google/Chrome/Application/chrome.exe','Chromium/Application/chrome.exe'])c.push(path.join(base,p));
  }
  for(const p of ['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'])c.push(p);
  return c.find(p=>fs.existsSync(p));
}
async function freePort(){return new Promise((resolve,reject)=>{
  const srv=net.createServer();srv.once('error',reject);srv.listen(0,'127.0.0.1',()=>{const p=srv.address().port;srv.close(()=>resolve(p));});
});}
class CDP {
  constructor(url){this.socket=new WebSocket(url);this.pending=new Map();this.next=1;this.listeners=new Map();}
  async connect(){await new Promise((resolve,reject)=>{
    this.socket.addEventListener('open',resolve,{once:true});this.socket.addEventListener('error',reject,{once:true});
  });this.socket.addEventListener('message',event=>{
    let msg;try{msg=JSON.parse(event.data);}catch{return;}
    if(msg.id){const p=this.pending.get(msg.id);if(!p)return;this.pending.delete(msg.id);
      clearTimeout(p.timer);if(msg.error)p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result||{});
    } else if(msg.method){for(const f of (this.listeners.get(msg.method)||[])){try{f(msg.params||{});}catch{}}}
  });this.socket.addEventListener('close',()=>{
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Chromium DevTools connection closed'));}
    this.pending.clear();
  });}
  on(name,fn){if(!this.listeners.has(name))this.listeners.set(name,[]);this.listeners.get(name).push(fn);}
  send(method,params={},timeout=240000){return new Promise((resolve,reject)=>{
    const id=this.next++,timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Timed out: ${method} after ${timeout}ms`));},timeout);
    this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));
  });}
  close(){try{this.socket.close();}catch{}}
}
async function evaluate(source){
  const r=await cdp.send('Runtime.evaluate',{expression:source,awaitPromise:true,returnByValue:true,userGesture:true});
  if(r.exceptionDetails)throw Error('Browser evaluation failed: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text||JSON.stringify(r.exceptionDetails)));
  return r.result?.value;
}
// JSON-friendly DOM snapshots and raw numerical arrays (no screenshots disguised as evidence).
const injection=`(()=>{
  const P=window.PredictiveSihti?.Predictor;
  if(!P) throw Error('PredictiveSihti.Predictor did not load');
  const A=window.__sihtiAudit={stage:'boot',events:[],rawSnapshots:{},appLoaded:!!document.getElementById('step'),exportCsv:null};
  const mean=a=>a?.length?a.reduce((s,v)=>s+v,0)/a.length:0;
  const peak=a=>{let mx=-Infinity,idx=-1;for(let i=0;i<a.length;i++)if(a[i]>mx){mx=a[i];idx=i;}return {value:mx,index:idx,x:idx%48,y:Math.floor(idx/48)};};
  const centroid=a=>{let s=0,x=0,y=0;for(let i=0;i<a.length;i++){
    const v=Math.max(0,a[i]-.035);s+=v;x+=(i%48)*v;y+=Math.floor(i/48)*v;
  }return {mass:s,x:s>0?x/s:null,y:s>0?y/s:null};};
  function record(h,r,isDream){const f=r.forecast,c=r.completed;const data={
    stage:A.stage,dream:!!isDream,frame:h.t,memories:h.memories(),
    bank:{core:h.core.entries.length,middle:h.mid.entries.length,fast:h.fast.entries.length,
      merges:[h.core.merges,h.mid.merges,h.fast.merges],evictions:[h.core.evictions,h.mid.evictions,h.fast.evictions]},
    address:h.adaptive?'auto':h.useMotion?'temporal':'shape',learning:h.learning,
    recruitedFraction:c?.recruited??null,writeDecision:c?.writes??null,
    writeStats:h.writeStats,auto:h.adaptive,gateCounts:f.gates,
    modelMSE:c?c.model:null,holdMSE:c?c.hold:null,completedB:c?c.ambiguity:null,
    rawB:mean(f.variance),maxB:peak(f.variance),confidence:f.confidence,
    bandB:f.bandB,coreB:f.coreB,observedCentroid:centroid(h.previous),
    predictionCentroid:centroid(f.predicted),predictionMSEfromCurrent:window.PredictiveSihti.mse(h.previous,f.predicted)
  };A.events.push(data);A.lastHead=h;return data;}
  const orig=P.prototype.observe;
  P.prototype.observe=function(frame){const r=orig.call(this,frame);record(this,r,false);return r;};
  const origDream=P.prototype.observeDream;
  P.prototype.observeDream=function(frame){const r=origDream.call(this,frame);record(this,r,true);return r;};
  A.snapshot=label=>{
    const h=A.lastHead;
    // A retained head reference may be detached: leaving Dream deliberately
    // clears h.previous and h.pending. Never apply Array.from to null.
    const hasFrame=!!(h?.previous && h?.pending?.predicted && h?.pending?.variance &&
      h?.pending?.parts?.core && h?.pending?.parts?.middle && h?.pending?.parts?.fast);
    const fields=hasFrame?{observed:Array.from(h.previous),predicted:Array.from(h.pending.predicted),
      collisionB:Array.from(h.pending.variance),recruitment:Array.from(h.pending.recruitment),
      familiarity:Array.from(h.pending.familiarity),core:Array.from(h.pending.parts.core),
      middle:Array.from(h.pending.parts.middle),fast:Array.from(h.pending.parts.fast)}:null;
    A.rawSnapshots[label]=fields;
    return {label,stage:A.stage,hasActiveFrame:hasFrame,
      rawFieldStatus:hasFrame?'captured':'no active temporal context (detached)',
      mode:document.getElementById('mode')?.textContent,
      frames:document.getElementById('frames')?.textContent,memories:document.getElementById('memories')?.textContent,
      gain:document.getElementById('gain')?.textContent,ambiguity:document.getElementById('ambiguity')?.textContent,
      address:document.getElementById('address')?.value,source:document.getElementById('source')?.value,
      status:document.getElementById('status')?.textContent,readout:document.getElementById('readout')?.textContent,
      bank:h?{core:h.core.entries.length,middle:h.mid.entries.length,fast:h.fast.entries.length,
        merges:[h.core.merges,h.mid.merges,h.fast.merges],evictions:[h.core.evictions,h.mid.evictions,h.fast.evictions]}:null,
      canvasStats:Object.fromEntries([...document.querySelectorAll('canvas.field')].map(c=>{
        const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let min=255,max=0,sum=0;const u=new Set();for(let i=0;i<a.length;i+=4){
          const v=a[i]+a[i+1]+a[i+2];min=Math.min(min,v);max=Math.max(max,v);sum+=v;u.add(v);
        }return[c.id,{range:max-min,meanRGB:sum/(a.length/4)/3,distinctRGBSums:u.size}];
      })),last:A.events.at(-1)||null};
  };
  const nativeURL=URL.createObjectURL.bind(URL);
  URL.createObjectURL=blob=>{if(blob?.type?.includes('csv'))blob.text().then(t=>{A.exportCsv=t;});return nativeURL(blob);};
  return true;
})()`;
async function stage(name){await evaluate(`window.__sihtiAudit.stage=${JSON.stringify(name)}`);}
async function click(id){return evaluate(`document.getElementById(${JSON.stringify(id)}).click();true`);}
async function steps(n){
  return evaluate(`(async()=>{let i=0;for(;i<${n};i++){
    document.getElementById('step').click();if((i%14)===13)await new Promise(r=>setTimeout(r,0));
  }return {stepped:i,frame:document.getElementById('frames').textContent,
    memories:document.getElementById('memories').textContent,mode:document.getElementById('mode').textContent};})()`);
}
async function changeSelect(id,value){return evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});
  e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`);}
async function setLearning(on){return evaluate(`(()=>{const e=document.getElementById('learning');e.checked=${!!on};
  e.dispatchEvent(new Event('change',{bubbles:true}));return e.checked;})()`);}
async function snap(name,report){
  const d=await evaluate(`window.__sihtiAudit.snapshot(${JSON.stringify(name)})`);
  report.snapshots[name]=d;
  try{const r=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,fromSurface:true},30000);
    fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
  catch(e){report.screenshotErrors.push({name,error:String(e)});}
  return d;
}
function stats(events,stageName){
  const rows=events.filter(x=>x.stage===stageName),scores=rows.filter(x=>x.modelMSE!==null);
  const m=scores.reduce((s,r)=>s+r.modelMSE,0),b=scores.reduce((s,r)=>s+r.holdMSE,0);
  const avg=(key,which=rows)=>which.length?which.reduce((s,r)=>s+(r[key]||0),0)/which.length:null;
  return {stage:stageName,frames:rows.length,scoredFrames:scores.length,
    modelMSE:avg('modelMSE',scores),holdMSE:avg('holdMSE',scores),
    improvement:b>0?1-m/b:null,meanCompletedB:avg('completedB',scores),
    meanForecastB:avg('rawB'),peakForecastB:Math.max(0,...rows.map(x=>x.maxB?.value||0)),
    endMemories:rows.at(-1)?.memories||0,
    meanRecruitedFraction:avg('recruitedFraction',scores),
    createdPrototypes:scores.reduce((acc,e)=>acc+(e.writeDecision?.stored||0),0),
    startBank:rows[0]?.bank||null,endBank:rows.at(-1)?.bank||null,
    meanConfidence:{core:rows.length?rows.reduce((s,r)=>s+r.confidence.core,0)/rows.length:0,
      middle:rows.length?rows.reduce((s,r)=>s+r.confidence.middle,0)/rows.length:0,
      fast:rows.length?rows.reduce((s,r)=>s+r.confidence.fast,0)/rows.length:0}};
}
function check(report,name,pass,details){report.checks.push({name,pass:!!pass,details:details||''});}
// Write a recovery receipt before the fragile input/export/reporting phase.
// Even if a later browser step fails, the failure ZIP contains full traces.
async function checkpoint(label,report){
  const data=await evaluate(`({stage:window.__sihtiAudit.stage,
    events:window.__sihtiAudit.events,rawSnapshots:window.__sihtiAudit.rawSnapshots,
    exportCsv:window.__sihtiAudit.exportCsv})`);
  const filename=path.join(out,'checkpoint_'+label+'.json');
  fs.writeFileSync(filename,JSON.stringify({label,at:new Date().toISOString(),
    snapshotSummary:report.snapshots,checks:report.checks,data},null,2));
  log('Saved '+label+' checkpoint: '+data.events.length+' captured UI steps');
}
// No zip dependencies: write a simple valid ZIP (DEFLATE, CRC32, central directory).
const CRC_TABLE=(()=>{const a=[];for(let n=0;n<256;n++){let c=n;for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);a.push(c>>>0);}return a;})();
function crc32(b){let c=0xffffffff;for(const v of b)c=CRC_TABLE[(c^v)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zipFiles(destination,entries){const chunks=[],cd=[];let at=0;
  for(const [name,data] of entries){const original=Buffer.isBuffer(data)?data:Buffer.from(data),packed=zlib.deflateRawSync(original,{level:6}),fname=Buffer.from(name.replace(/\\/g,'/'),'utf8');
    const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);
    local.writeUInt32LE(crc32(original),14);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(original.length,22);local.writeUInt16LE(fname.length,26);
    chunks.push(local,fname,packed);
    const center=Buffer.alloc(46);center.writeUInt32LE(0x02014b50,0);center.writeUInt16LE(20,4);center.writeUInt16LE(20,6);center.writeUInt16LE(0x800,8);center.writeUInt16LE(8,10);
    center.writeUInt32LE(crc32(original),16);center.writeUInt32LE(packed.length,20);center.writeUInt32LE(original.length,24);center.writeUInt16LE(fname.length,28);center.writeUInt32LE(at,42);
    cd.push(center,fname);at+=local.length+fname.length+packed.length;
  }
  const central=Buffer.concat(cd),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(central.length,12);end.writeUInt32LE(at,16);
  fs.writeFileSync(destination,Buffer.concat([...chunks,central,end]));
}
async function main(){
  for(const filename of required)if(!fs.existsSync(path.join(folder,filename)))throw Error('Missing '+filename+' in '+folder);
  if(typeof WebSocket==='undefined')throw Error('Node.js 22+ is required for built-in WebSocket. `node -v` shows current version.');
  const exe=findBrowser();if(!exe)throw Error('Could not find Edge/Chrome/Chromium. Pass --browser "C:\\...\\msedge.exe"');
  fs.mkdirSync(out,{recursive:true});const report={tool:'PredictiveSihtiV2 headless UI audit',timestamp,folder,
    files:Object.fromEntries(required.map(p=>[p,{bytes:fs.statSync(path.join(folder,p)).size,mtime:fs.statSync(path.join(folder,p)).mtime.toISOString(),sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,p))).digest('hex')}])),
    node:process.version,browserExecutable:exe,snapshots:{},metrics:{},checks:[],browserErrors:[],network:[],screenshotErrors:[],
    protocol:'Clicks actual V2.2 UI; train 168 bounce in auto; freeze 84 bounce auto, 84 temporal, 84 shape; freeze 84 one-to-five transfer auto; then allow 84 online five frames; dream and flick. No camera requested.'};activeReport=report;
  const port=await freePort(),userData=fs.mkdtempSync(path.join(os.tmpdir(),'sihti-headless-'));
  const flags=['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-extensions','--no-proxy-server','--disable-dev-shm-usage','--disable-sync','--disable-component-update','--disable-popup-blocking','--disable-features=MediaRouter',
    '--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,'--remote-allow-origins=*',
    `--user-data-dir=${userData}`,'--window-size=1440,1550','--hide-scrollbars','--no-sandbox','about:blank'];
  browser=spawn(exe,flags,{stdio:'ignore'});log('Launched '+path.basename(exe));
  let ready=false;for(let k=0;k<100;k++){if(browser.exitCode!==null)throw Error('Browser exited prematurely: '+browser.exitCode);
    try{const r=await fetch(`http://127.0.0.1:${port}/json/version`);if(r.ok){ready=true;break;}}catch{}await wait(125);
  }if(!ready)throw Error('No DevTools endpoint from Chromium after 12.5 seconds.');
  const localPort=await freePort();server=http.createServer((req,res)=>{
    const file=req.url==='/'?'index.html':decodeURIComponent((req.url||'').split('?')[0]).replace(/^\//,'');
    if(file==='favicon.ico'){res.writeHead(204);res.end();return;}
    if(!required.includes(file)){res.writeHead(404);res.end('Not found');return;}
    res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store'});
    fs.createReadStream(path.join(folder,file)).pipe(res);
  });await new Promise(resolve=>server.listen(localPort,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${localPort}/index.html`;log('Serving app locally at '+url);
  const targetResponse=await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,{method:'PUT'});
  if(!targetResponse.ok)throw Error('Could not create Chromium tab: '+await targetResponse.text());
  const tab=await targetResponse.json();cdp=new CDP(tab.webSocketDebuggerUrl);await cdp.connect();
  cdp.on('Runtime.exceptionThrown',e=>report.browserErrors.push({kind:'exception',details:e.exceptionDetails?.text||JSON.stringify(e)}));
  cdp.on('Runtime.consoleAPICalled',e=>{if(e.type==='error'||e.type==='warning')report.browserErrors.push({kind:'console-'+e.type,text:(e.args||[]).map(x=>x.value||x.description).join(' ')});});
  cdp.on('Network.requestWillBeSent',e=>report.network.push({url:e.request.url,method:e.request.method,type:e.type}));
  try{report.browserVersion=await cdp.send('Browser.getVersion');}catch{}
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1550,deviceScaleFactor:1,mobile:false});
  try{await cdp.send('Page.setDownloadBehavior',{behavior:'allow',downloadPath:out});}catch{}
  const loaded=new Promise(resolve=>cdp.on('Page.loadEventFired',resolve));
  report.navigation=await cdp.send('Page.navigate',{url});await Promise.race([loaded,wait(15000).then(()=>{throw Error('Timed out loading index.html');})]);
  let appReady=false;for(let j=0;j<60;j++){try{appReady=await evaluate("!!window.PredictiveSihti?.Predictor&&!!window.SihtiWorld?.render&&!!document.getElementById('step')");if(appReady)break;}catch{}await wait(100);}
  if(!appReady)throw Error('Browser scripts did not load at '+url+'; '+JSON.stringify(await evaluate('({url:location.href,ready:document.readyState,title:document.title})')));
  await evaluate(injection);
  const boot=await evaluate(`({title:document.title,loaded:!!window.PredictiveSihti?.Predictor&&!!window.SihtiWorld?.render,
    canvases:[...document.querySelectorAll('canvas.field')].map(x=>x.id),
    complete:document.readyState,libs:[!!window.PredictiveSihti,!!window.SihtiWorld]})`);
  report.boot=boot;check(report,'Real app loaded, all six canvases present',boot.loaded&&boot.canvases.length===6,boot);
  log('App loaded. Capturing boot panel.');await snap('01_boot',report);
  await stage('train_bounce_168');log('Learning bounce 168 UI steps...');await steps(168);
  const tr=await snap('02_after_training',report);log('Trained: '+tr.memories+' retained prototypes.');
  const learned=Number(tr.memories.replace(/,/g,''));check(report,'Trained bank nonempty after 168 steps',learned>0,tr.bank);
  check(report,'Observed and predicted canvases were painted',
    tr.canvasStats.current.distinctRGBSums>3&&tr.canvasStats.prediction.distinctRGBSums>3,
    {observed:tr.canvasStats.current,predicted:tr.canvasStats.prediction});
  await setLearning(false);const frozen=Number((await evaluate(`document.getElementById('memories').textContent`)).replace(/,/g,''));
  await stage('frozen_bounce_auto_84');log('Frozen self-repair bounce, 84 UI steps...');await steps(84);await snap('03_frozen_auto',report);
  await changeSelect('address','temporal');await stage('frozen_bounce_temporal_84');
  log('Frozen fixed-temporal bounce, 84 UI steps...');await steps(84);await snap('04_frozen_temporal',report);
  await changeSelect('address','shape');await stage('frozen_bounce_shape_84');
  log('Frozen shape-only bounce, 84 UI steps...');await steps(84);await snap('05_frozen_shape',report);
  await changeSelect('source','five');await changeSelect('address','adaptive');
  await stage('frozen_transfer_five_84');log('Frozen one-to-five transfer, 84 UI steps...');await steps(84);await snap('06_transfer_five',report);await checkpoint('after_transfer',report);
  const postTransfer=Number((await evaluate(`document.getElementById('memories').textContent`)).replace(/,/g,''));
  check(report,'Frozen writes never changed memory count',frozen===postTransfer,{frozen,postTransfer});
  await setLearning(true);await stage('online_five_84');
  log('Online self-repair on five pulses, 84 UI steps...');await steps(84);await snap('07_online_five',report);
  const learnedCount=Number((await evaluate(`document.getElementById('memories').textContent`)).replace(/,/g,''));
  check(report,'New five-pulse observations permitted new prototypes',learnedCount>frozen,{frozen,learnedCount});
  await setLearning(false);
  log('Free-run warmup and flick test...');
  await changeSelect('source','bounce');await changeSelect('address','adaptive');await stage('dream_warmup');await steps(3);
  await click('dream');await stage('dream_before_flick');await steps(8);await snap('08_dream_before_flick',report);
  const beforeFlick=await evaluate(`({frame:window.__sihtiAudit.events.at(-1).frame,
    count:window.__sihtiAudit.events.length,memory:window.__sihtiAudit.events.at(-1).memories})`);
  const rect=await evaluate(`(()=>{const r=document.getElementById('current').getBoundingClientRect();
    return{x:r.left,y:r.top,w:r.width,h:r.height};})()`);
  const startX=rect.x+rect.w*.36,startY=rect.y+rect.h*.53;
  const endX=rect.x+rect.w*.48,endY=rect.y+rect.h*.53;
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:startX,y:startY});
  await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',x:startX,y:startY,button:'left',clickCount:1});
  for(let i=1;i<=7;i++)await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:startX+(endX-startX)*i/7,y:startY+(endY-startY)*i/7,button:'left',buttons:1});
  const midway=await evaluate(`({frame:window.__sihtiAudit.events.at(-1).frame,count:window.__sihtiAudit.events.length})`);
  await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:endX,y:endY,button:'left',clickCount:1});
  const afterFlick=await evaluate(`({frame:window.__sihtiAudit.events.at(-1).frame,
    count:window.__sihtiAudit.events.length,memory:window.__sihtiAudit.events.at(-1).memories,
    status:document.getElementById('status').textContent})`);
  report.flick={beforeFlick,midway,afterFlick};
  check(report,'Pointer move does not tick the dream',midway.frame===beforeFlick.frame,report.flick);
  check(report,'Releasing a directional flick injects exactly 2 dream frames',afterFlick.frame===beforeFlick.frame+2&&afterFlick.status.includes('Directional flick'),report.flick);
  await snap('09_after_flick',report);
  await stage('dream_after_flick_12');await steps(12);await snap('10_dream_after_12',report);
  check(report,'Free-run leaves memory frozen',afterFlick.memory===learnedCount&&Number((await evaluate(`window.__sihtiAudit.events.at(-1).memories`)))===learnedCount,{learnedCount,afterFlick});
  // The final raw dream tensors must be captured BEFORE returning to LIVE,
  // because that action correctly calls head.detach().
  await snap('11_final_dream',report);
  await checkpoint('after_dream',report);
  log('Returning to LIVE and testing detached-state export...');
  await click('dream');await stage('return_to_live');
  const afterReturn=await snap('12_return_to_live',report);
  check(report,'Returning to live detaches the temporal context safely',
    afterReturn.mode==='AUTO'&&!afterReturn.hasActiveFrame,
    {mode:afterReturn.mode,hasActiveFrame:afterReturn.hasActiveFrame});
  await click('export');await wait(350);
  const final=await evaluate(`({events:window.__sihtiAudit.events,rawSnapshots:window.__sihtiAudit.rawSnapshots,
    exportCsv:window.__sihtiAudit.exportCsv,finalState:window.__sihtiAudit.snapshot('final')})`);
  report.metrics={
    train:stats(final.events,'train_bounce_168'),
    auto:stats(final.events,'frozen_bounce_auto_84'),
    temporal:stats(final.events,'frozen_bounce_temporal_84'),
    shape:stats(final.events,'frozen_bounce_shape_84'),
    transfer:stats(final.events,'frozen_transfer_five_84'),
    online:stats(final.events,'online_five_84'),
    dreamBeforeFlick:stats(final.events,'dream_before_flick'),
    dreamAfterFlick:stats(final.events,'dream_after_flick_12')};
  report.rawSnapshots=final.rawSnapshots;report.events=final.events;report.finalState=final.finalState;
  const t=report.metrics.temporal,s=report.metrics.shape,f=report.metrics.transfer,a=report.metrics.auto;
  check(report,'Shape-only has higher disagreement B than temporal',s.meanCompletedB>t.meanCompletedB,
    {temporal:t.meanCompletedB,shape:s.meanCompletedB});
  check(report,'Frozen temporal bounce beats hold-last',t.improvement>0,{improvement:t.improvement});
  check(report,'Automatic routing beats fixed shape-only',a.improvement>s.improvement+.1,{auto:a.improvement,shape:s.improvement});
  check(report,'Automatic routing is spatially selective',a.meanRecruitedFraction>.01&&a.meanRecruitedFraction<.5,a.meanRecruitedFraction);
  check(report,'One-to-five transfer beats hold-last',f.improvement>0,{improvement:f.improvement});
  check(report,'Export CSV captured',!!final.exportCsv&&final.exportCsv.startsWith('frame,source,address,'),
    {bytes:final.exportCsv?.length||0});
  if(final.exportCsv)fs.writeFileSync(path.join(out,'ui_export.csv'),final.exportCsv);
  // This audit CSV retains stage labels across source switches for reproducible comparison.
  const header=['stage','frame','dream','address','learning','memories','modelMSE',
    'holdMSE','completedB','rawB','maxB','recruitedFraction','writesNew','writesSkipped','coreConfidence','middleConfidence',
    'fastConfidence','coreEntries','middleEntries','fastEntries'];
  const cell=v=>v==null?'':String(v);
  const completeCsv=[header.join(','),...final.events.map(e=>[
    e.stage,e.frame,e.dream?1:0,e.address,e.learning?1:0,e.memories,
    e.modelMSE,e.holdMSE,e.completedB,e.rawB,e.maxB?.value,
    e.recruitedFraction,e.writeDecision?.stored,e.writeDecision?.skipped,
    e.confidence?.core,e.confidence?.middle,e.confidence?.fast,
    e.bank?.core,e.bank?.middle,e.bank?.fast].map(cell).join(','))].join('\n')+'\n';
  fs.writeFileSync(path.join(out,'all_stage_metrics.csv'),completeCsv);
  const unexpected=report.network.filter(e=>/^https?:/.test(e.url)&&!e.url.startsWith('http://127.0.0.1:'));
  check(report,'No unexpected network requests',unexpected.length===0,unexpected);
  check(report,'No browser JS exceptions or console errors',report.browserErrors.length===0,report.browserErrors);
  report.summary={result:'V2.2 AUDIT COMPLETED',checksPassed:report.checks.filter(x=>x.pass).length,
    checksTotal:report.checks.length,scoredFrameCount:final.events.filter(x=>x.modelMSE!=null).length,
    screenshotCount:Object.keys(report.snapshots).length,
    warnings:['The 84-frame test cycles repeat training dynamics: they do not demonstrate real physical generalization.',
      'B is memory disagreement, not proven hidden physics; examine confidence and raw B.',
      'Dream mode has no true future to score; its motion may stall or drift.']};
  const regression=path.join(folder,'results','self_repair.json');
  if(fs.existsSync(regression))fs.copyFileSync(regression,path.join(out,'self_repair_node_results.json'));
  const json=path.join(out,'headless_audit.json');fs.writeFileSync(json,JSON.stringify(report,null,2));
  const content=fs.readdirSync(out).filter(n=>fs.statSync(path.join(out,n)).isFile()).map(n=>[n,fs.readFileSync(path.join(out,n))]);
  const zip=path.join(root,'predictive_sihti_headless_receipt.zip');zipFiles(zip,content);
  log(`COMPLETE: ${report.summary.checksPassed}/${report.summary.checksTotal} checks passed; ${final.events.length} browser steps`);
  for(const [k,v] of Object.entries(report.metrics))log(`${k}: ${v.scoredFrames} scored, gain ${v.improvement===null?'n/a':(v.improvement*100).toFixed(2)+'%'}; B ${v.meanForecastB?.toExponential(3)}`);
  log('RESULT FILE: '+json);log('SEND BACK THIS ZIP: '+zip);
}
(async()=>{try{await main();}catch(e){console.error('AUDIT FAILED:',e.stack||String(e));
  if(fs.existsSync(out)){
    const message=String(e.stack||e),failure={result:'AUDIT FAILED',message,reportSoFar:activeReport};
    try{if(cdp){const r=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},4000);fs.writeFileSync(path.join(out,'failure_page.png'),Buffer.from(r.data,'base64'));}}catch{}
    fs.writeFileSync(path.join(out,'audit_failure.json'),JSON.stringify(failure,null,2));
    const files=fs.readdirSync(out).filter(n=>fs.statSync(path.join(out,n)).isFile()).map(n=>[n,fs.readFileSync(path.join(out,n))]);
    try{const zip=path.join(root,'predictive_sihti_headless_receipt.zip');zipFiles(zip,files);console.log('SEND FAILURE ZIP:',zip);}catch{}
  }process.exitCode=1;
}finally{try{cdp?.close();}catch{}if(browser){try{browser.kill();}catch{}}if(server){try{server.close();}catch{}}}})();
