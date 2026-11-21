/* Browser adapter only: model, worlds, and tests are separate, no server required. */
(function(){'use strict';
  const $=id=>document.getElementById(id);
  const W=48,H=36,head=new PredictiveSihti.Predictor({width:W,height:H});
  const panels=['current','prediction','surprise','core','collision','residue'];
  const canvases=Object.fromEntries(panels.map(id=>[id,$(id)]));
  const sampler=$('sampler').getContext('2d',{willReadFrequently:true});
  const video=$('video');
  let clock=null,syntheticT=0,direction=1,dream=false,camera=null,videoURL=null;
  let trials=[],lastError=null,lastFrame=null;
  const status=s=>{$('status').textContent=s;};
  function paint(id,arr){
    const canvas=canvases[id],ctx=canvas.getContext('2d');
    const im=ctx.createImageData(W,H);
    let scale=1,base=0;
    if(id==='collision' && arr){
      // Spatial contrast stretch is display-only. Raw B stays in the readout/CSV.
      const sorted=Array.from(arr).sort((a,b)=>a-b);
      base=sorted[Math.floor(sorted.length*.55)];
      scale=Math.max(.00005,(sorted[sorted.length-1]-base)*.72);
    }
    for(let i=0;i<W*H;i++){
      const v=arr?arr[i]:0,j=i*4;
      let r=0,g=0,b=0;
      if(id==='collision'){
        const a=Math.sqrt(Math.min(1,Math.max(0,v-base)/scale));
        r=8+Math.round(246*a);g=14+Math.round(153*a);b=22+Math.round(40*a);
      }else if(id==='surprise'){
        const a=Math.min(1,Math.abs(v)*7);
        r=8+Math.round(240*a);g=16+Math.round(80*a);b=25+Math.round(92*a);
      }else if(id==='residue'){
        const a=Math.min(1,Math.abs(v)*5.5);
        r=11+Math.round((v<0?233:12)*a);g=16+Math.round((v>0?224:29)*a);b=24+Math.round(85*a);
      }else{const a=Math.round(Math.max(0,Math.min(1,v))*255);r=g=b=a;}
      im.data[j]=r;im.data[j+1]=g;im.data[j+2]=b;im.data[j+3]=255;
    }
    ctx.putImageData(im,0,0);
  }
  function repaint(result,isDream=false){
    const forecast=result.forecast;
    const frame=head.previous;
    paint('current',frame);paint('prediction',forecast.predicted);
    paint('core',forecast.parts.core);paint('residue',forecast.parts.fast);
    paint('collision',forecast.variance);
    if(isDream)paint('surprise',null);
    else if(result.completed){lastError=result.completed.error;paint('surprise',lastError);}
    else paint('surprise',null);
    $('frames').textContent=head.t;
    $('memories').textContent=head.memories().toLocaleString();
    const B=forecast.variance.reduce((a,b)=>a+b,0)/forecast.variance.length;
    $('ambiguity').textContent=B.toFixed(5);
    const recent=trials.slice(-80);
    const sm=recent.reduce((s,x)=>s+x.model,0),sb=recent.reduce((s,x)=>s+x.hold,0);
    $('gain').textContent=recent.length&&sb>1e-12?((1-sm/sb)*100).toFixed(1)+'%':'—';
    $('gain').style.color=sm<=sb?'var(--mint)':'var(--rose)';
    $('mode').textContent=dream?'DREAM':'LIVE';
    const C=forecast.confidence;
    const e=result.completed;
    let diagnosis='No evaluated transition yet';
    if(e){
      const rms=Math.sqrt(e.model),trust=(C.core+C.middle+C.fast)/3;
      diagnosis=rms>.025?(e.ambiguity>.00015&&trust>.15?'Competing recalled futures — inspect B':'Novelty, intervention or model mismatch'):
        'Prediction within a small-error regime';
    }
    $('readout').textContent=[
      'Core recall         '+(C.core*100).toFixed(1)+'%',
      'Middle patch recall '+(C.middle*100).toFixed(1)+'%',
      'Fast patch recall   '+(C.fast*100).toFixed(1)+'%',
      'Current B           '+B.toFixed(6),
      'Last surprise RMS   '+(e?Math.sqrt(e.model).toFixed(5):'—'),
      'Interpretation: '+(dream?'No observed future to verify.':diagnosis)
    ].join('\n');
    drawTrend();
  }
  function drawTrend(){
    const c=$('trend'),ctx=c.getContext('2d'),w=c.width,h=c.height;
    ctx.fillStyle='#091820';ctx.fillRect(0,0,w,h);
    ctx.lineWidth=1;ctx.strokeStyle='#233d48';
    for(let i=1;i<5;i++){const y=i*h/5;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    if(trials.length<2)return;
    const data=trials.slice(-210),max=Math.max(1e-8,...data.map(x=>Math.max(x.model,x.hold)))*1.08;
    for (const [k,color] of [['hold','#ffca70'],['model','#83edca']]){
      ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2.5;
      data.forEach((v,i)=>{const x=8+i/(data.length-1)*(w-16),y=h-12-v[k]/max*(h-26);
        if(!i)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      });ctx.stroke();
    }
    ctx.fillStyle='#a0bac2';ctx.font='13px ui-monospace, monospace';ctx.fillText('vertical max: '+max.toFixed(5)+' MSE',14,20);
  }
  function frameFromVideo(){
    if(video.readyState<2||!video.videoWidth)return null;
    if(video.ended){pause();status('Local video ended. Memory remains available.');return null;}
    sampler.drawImage(video,0,0,W,H);
    const rgba=sampler.getImageData(0,0,W,H).data,gray=new Float32Array(W*H);
    for(let i=0;i<gray.length;i++) {const j=i*4;gray[i]=(.2126*rgba[j]+.7152*rgba[j+1]+.0722*rgba[j+2])/255;}
    return gray;
  }
  function tick(){
    if(dream){const r=head.dreamStep();if(r)repaint(r,true);return;}
    const kind=$('source').value;
    const frame=(kind==='camera'||kind==='file')?frameFromVideo():SihtiWorld.render(kind,syntheticT,W,H);
    if(!frame)return;
    if(kind!=='camera'&&kind!=='file')syntheticT+=direction;
    lastFrame=frame;
    const r=head.observe(frame);
    if(r.completed){trials.push(r.completed);if(trials.length>1200)trials.shift();}
    repaint(r,false);
  }
  function pause(){if(clock!==null){clearInterval(clock);clock=null;}$('run').textContent='Start';}
  async function prepareVideo(){
    if($('source').value==='file'){
      if(!videoURL){$('file').click();status('Choose a local video, then Start.');return false;}
      try{if(video.ended)video.currentTime=0;await video.play();}catch(e){status('Cannot play file: '+e.message);return false;}
    }
    if($('source').value==='camera'){
      if(!navigator.mediaDevices?.getUserMedia){status('Camera blocked on this origin. Use localhost / HTTPS, or choose a local video.');return false;}
      try{
        if(!camera)camera=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
        video.srcObject=camera;await video.play();
      }catch(e){status('Camera permission failed: '+e.message);return false;}
    }
    return true;
  }
  async function start(){
    if(clock!==null){pause();status('Paused. Stored transitions and the chart remain.');return;}
    if(!dream && !(await prepareVideo()))return;
    clock=setInterval(tick,1000/Number($('rate').value));$('run').textContent='Pause';
    status(dream?'Free-run: predictions are fed back without any future observation. Click the first panel to perturb it.':
      'Observing causally. Each incoming frame scores the PREVIOUS prediction before a new bridge is written.');
  }
  function stopVideo(){
    video.pause();video.srcObject=null;
    if(camera){camera.getTracks().forEach(t=>t.stop());camera=null;}
    if(videoURL){URL.revokeObjectURL(videoURL);videoURL=null;}
    video.removeAttribute('src');
  }
  $('run').addEventListener('click',start);
  $('step').addEventListener('click',()=>{
    pause();if(!dream && ['file','camera'].includes($('source').value)){
      status('Press Start for a webcam or local video. Step is available for the built-in worlds and free-run.');return;}
    tick();
  });
  $('dream').addEventListener('click',()=>{
    if(!head.previous){status('Observe at least one live frame before starting free-run.');return;}
    pause();dream=!dream;
    $('dream').textContent=dream?'Return to live':'Free-run';
    if(!dream){head.detach();status('Returned to live. The model bank is preserved, but temporal context is reset.');}
    else status('Camera/input disconnected from the predictor. From here, no true next frame exists to score. Click the world to poke it.');
    $('mode').textContent=dream?'DREAM':'LIVE';
  });
  $('reverse').addEventListener('click',()=>{
    if(['camera','file'].includes($('source').value)){status('Reverse is only available for built-in worlds.');return;}
    direction=-direction;status('Intervention: synthetic time reversed. The predictor has not been told; observe the first surprise.');
  });
  $('source').addEventListener('change',()=>{
    pause();dream=false;$('dream').textContent='Free-run';head.detach();trials=[];drawTrend();
    stopVideo();
    if($('source').value==='file'){$('file').click();status('Select a local video file. The memory bank remains intact.');}
    else if($('source').value==='camera')status('Webcam selected. Press Start to grant permission.');
    else status('New signal selected; the previous memories are kept. Freeze learning to test transfer to this world.');
  });
  $('file').addEventListener('change',()=>{
    if(!$('file').files?.length)return;
    stopVideo();videoURL=URL.createObjectURL($('file').files[0]);video.src=videoURL;video.loop=false;video.muted=true;
    $('source').value='file';status('Local video loaded: '+$('file').files[0].name+'. Press Start. No upload.');
  });
  $('address').addEventListener('change',()=>{
    head.useMotion=$('address').value==='temporal';
    status(head.useMotion?'Temporal patch addresses enabled. Compare to Shape only with the same learned memory.':
      'Shape-only addresses enabled. Opposite futures can match one address and raise the B map.');
  });
  $('learning').addEventListener('change',()=>{
    head.learning=$('learning').checked;
    status(head.learning?'Learning on: completed observed transitions enter the memory.':'Learning frozen: new observations are scored but NOT stored.');
  });
  $('rate').addEventListener('change',()=>{if(clock!==null){pause();start();}});
  $('reset').addEventListener('click',()=>{
    pause();dream=false;$('dream').textContent='Free-run';head.reset();syntheticT=0;direction=1;
    trials=[];lastFrame=null;lastError=null;
    for(const name of panels)paint(name,null);drawTrend();
    $('frames').textContent='0';$('memories').textContent='0';$('gain').textContent='—';$('ambiguity').textContent='—';$('mode').textContent='LIVE';
    $('readout').textContent='No signal yet.';status('All memories erased. Restart to record fresh transitions.');
  });
  function pokeAt(e){
    if(!dream){status('Poke requires free-run. Train the head, then click Free-run and draw here.');return;}
    const rect=$('current').getBoundingClientRect(),x=Math.floor((e.clientX-rect.left)/rect.width*W),y=Math.floor((e.clientY-rect.top)/rect.height*H);
    const r=head.poke(x,y,2.2,e.shiftKey?-.75:.75);
    if(r)repaint(r,true);
    status('Perturbation injected into the predicted state. No new memory was written.');
  }
  $('current').addEventListener('pointerdown',e=>{$('current').setPointerCapture(e.pointerId);pokeAt(e);});
  $('current').addEventListener('pointermove',e=>{if(e.buttons&1)pokeAt(e);});
  $('export').addEventListener('click',()=>{
    const lines=['frame,model_mse,hold_last_mse,recall_disagreement'];
    for(const x of trials)lines.push([x.frame,x.model,x.hold,x.ambiguity].join(','));
    const url=URL.createObjectURL(new Blob([lines.join('\n')+'\n'],{type:'text/csv'}));
    const a=document.createElement('a');a.href=url;a.download='predictive_sihti_v2_receipt.csv';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
    status('Downloaded numeric evaluation receipt. No raw camera/video frames are exported.');
  });
  window.addEventListener('beforeunload',stopVideo);
  for(const name of panels)paint(name,null);drawTrend();
})();
