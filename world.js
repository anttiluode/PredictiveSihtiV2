/* Reproducible synthetic streams. All generation occurs before observation, never inside the learner. */
(function(root,factory){const x=factory();if(typeof module!=='undefined'&&module.exports)module.exports=x;if(root)root.SihtiWorld=x;})(typeof globalThis==='undefined'?this:globalThis,function(){
  function ping(t,period){const u=((t%period)+period)%period/period;return 1-Math.abs(2*u-1);}
  function render(kind,t,w=48,h=36){
    const f=new Float32Array(w*h);f.fill(.035);
    const blobs=[];
    if(kind==='bounce')blobs.push({x:6+(w-12)*ping(t,84),y:h*.49,r:2.5,a:.94});
    else if(kind==='five'){
      for(let i=0;i<5;i++)blobs.push({x:6+(w-12)*ping(t+i*13,84),
        y:h*(.14+i*.18),r:2.5,a:.94});
    }else if(kind==='wave'){
      for(let y=0;y<h;y++)for(let x=0;x<w;x++){
        const r=Math.hypot((x-w*.48)/w,(y-h*.51)/h);
        f[y*w+x]=.34+.24*Math.sin(38*r-t*.29)*Math.exp(-r*2.0)+.09*Math.sin(x*.3+t*.08);
      }
      return f;
    }else throw Error('Unknown source '+kind);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      let v=f[y*w+x];
      for (const b of blobs) {const d=(x-b.x)**2+(y-b.y)**2;v+=b.a*Math.exp(-d/(2*b.r*b.r));}
      f[y*w+x]=Math.min(1,v);
    }
    return f;
  }
  return {render,ping};
});
