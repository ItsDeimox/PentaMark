import { EnergyNetwork, type EnergyMesh } from './energy-mesh';

/** A bounded high-DPI tile, not a window-sized raster uploaded every frame. */
export function attachEnergyHover(root:HTMLElement,canvas:HTMLCanvasElement,mesh:EnergyMesh,zoom:number,enabled:boolean) {
  const ctx=canvas.getContext('2d');if(!ctx)return()=>{};
  const size=512,density=Math.min(2,devicePixelRatio||1);
  canvas.width=canvas.height=Math.round(size*density);
  canvas.style.width=canvas.style.height=`${size/zoom}px`;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const energy=new EnergyNetwork(mesh),bounds=root.getBoundingClientRect();
  const color=getComputedStyle(root).color;
  let frame=0,last=0,painted=0,originX=0,originY=0;
  let focused=document.hasFocus();
  let pending:{x:number;y:number}|null=null,previous:{x:number;y:number}|null=null;
  const clear=()=>{
    cancelAnimationFrame(frame);frame=0;pending=null;previous=null;energy.clear();
    ctx.resetTransform();ctx.clearRect(0,0,canvas.width,canvas.height);
  };
  const render=(now:number)=>{
    frame=0;
    if(!enabled||!focused||document.hidden||reduced.matches){clear();return;}
    // 30 Hz is enough for a background trail, even on a 144/240 Hz monitor.
    if(now-painted<1000/30){frame=requestAnimationFrame(render);return;}
    painted=now;
    if(pending){
      if(!previous||Math.hypot(pending.x-previous.x,pending.y-previous.y)>8){
        energy.inject(pending.x,pending.y);previous=pending;
        originX=pending.x-size/2;originY=pending.y-size/2;
        canvas.style.transform=`translate(${originX/zoom}px,${originY/zoom}px)`;
      }
      pending=null;
    }
    energy.step((now-last)/1000);last=now;
    ctx.resetTransform();ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!energy.active)return;
    ctx.setTransform(density,0,0,density,-originX*density,-originY*density);
    const buckets=Array.from({length:12},()=>new Path2D());
    let segments=0;
    for(const [a,b] of mesh.edges){
      const va=energy.values[a],vb=energy.values[b];
      if(Math.max(va,vb)<.012)continue;
      const p=mesh.points[a],q=mesh.points[b];
      if(Math.max(p.x,q.x)<originX||Math.min(p.x,q.x)>originX+size||
        Math.max(p.y,q.y)<originY||Math.min(p.y,q.y)>originY+size)continue;
      for(let s=0;s<8;s++){
        const t=(s+.5)/8,e=va*(1-t)+vb*t;
        const x=p.x+(q.x-p.x)*t-originX-size/2,y=p.y+(q.y-p.y)*t-originY-size/2;
        const fade=Math.max(0,Math.min(1,(size/2-Math.max(Math.abs(x),Math.abs(y)))/64));
        const level=Math.min(11,Math.floor(Math.sqrt(e)*11*fade));
        if(level<1)continue;
        segments++;
        buckets[level].moveTo(p.x+(q.x-p.x)*s/8,p.y+(q.y-p.y)*s/8);
        buckets[level].lineTo(p.x+(q.x-p.x)*(s+1)/8,p.y+(q.y-p.y)*(s+1)/8);
      }
    }
    if(!segments){energy.clear();return;}
    ctx.strokeStyle=color;ctx.lineCap='round';
    for(let i=1;i<12;i++)for(const [width,alpha] of [[9,.018],[4,.07],[.8,.9]]){
      ctx.lineWidth=width;ctx.globalAlpha=i/11*alpha;ctx.stroke(buckets[i]);
    }
    ctx.globalAlpha=1;frame=requestAnimationFrame(render);
  };
  const pointer=(e:PointerEvent)=>{
    if(!enabled||!focused||document.hidden||reduced.matches||e.pointerType==='touch'||e.buttons)return;
    pending={x:e.clientX-bounds.left,y:e.clientY-bounds.top};
    if(!frame){last=performance.now();painted=0;frame=requestAnimationFrame(render);}
  };
  const leave=(e:PointerEvent)=>{if(!e.relatedTarget)clear();};
  const blur=()=>{focused=false;clear();},focus=()=>{focused=true;};
  clear();
  if(enabled)document.addEventListener('pointermove',pointer,{passive:true});
  document.addEventListener('pointerout',leave);
  document.addEventListener('visibilitychange',clear);
  window.addEventListener('blur',blur);window.addEventListener('focus',focus);reduced.addEventListener('change',clear);
  return()=>{
    clear();document.removeEventListener('pointermove',pointer);document.removeEventListener('pointerout',leave);
    document.removeEventListener('visibilitychange',clear);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);
    reduced.removeEventListener('change',clear);
  };
}

/** Small prepainted light sprites; only transform/opacity animate on the compositor. */
export function attachAmbientSignals(host:HTMLElement,mesh:EnergyMesh,enabled:boolean) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const neighbors=Array.from({length:mesh.points.length},()=>[] as number[]);
  mesh.edges.forEach(([a,b])=>{neighbors[a].push(b);neighbors[b].push(a);});
  const animations:Animation[]=[],sprites:HTMLElement[]=[];
  for(let i=0;i<8;i++){
    const sprite=document.createElement('i');sprite.className='pm-signal-packet';
    host.append(sprite);sprites.push(sprite);
    const route=[Math.floor(mesh.points.length*(i+.5)/8)];
    for(let step=0;step<5;step++){
      const available=neighbors[route.at(-1)!].filter(n=>!route.includes(n));
      if(!available.length)break;
      route.push(available[(i+step)%available.length]);
    }
    const frames:Keyframe[]=[];let total=0;
    const lengths=route.slice(1).map((id,j)=>{
      const a=mesh.points[route[j]],b=mesh.points[id],length=Math.hypot(b.x-a.x,b.y-a.y);total+=length;return length;
    });
    let distance=0;
    for(let j=0;j<lengths.length;j++){
      const a=mesh.points[route[j]],b=mesh.points[route[j+1]],angle=Math.atan2(b.y-a.y,b.x-a.x);
      const transform=(x:number,y:number)=>`translate(${x}px,${y}px) rotate(${angle}rad)`;
      const from=distance/total*.68;distance+=lengths[j];const to=distance/total*.68;
      frames.push({transform:transform(a.x,a.y),offset:from,opacity:j===0?0:.58});
      frames.push({transform:transform(b.x,b.y),offset:to,opacity:j===lengths.length-1?0:.58});
    }
    if(!frames.length)continue;
    frames.push({...frames.at(-1),offset:1,opacity:0});
    const animation=sprite.animate(frames,{duration:4600+i*310,delay:-i*971,iterations:Infinity});
    animations.push(animation);
  }
  let focused=document.hasFocus();
  const sync=()=>{
    const running=enabled&&!document.hidden&&!reduced.matches&&focused;
    host.style.visibility=running?'visible':'hidden';
    animations.forEach(animation=>running?animation.play():animation.pause());
  };
  const blur=()=>{focused=false;sync();},focus=()=>{focused=true;sync();};
  sync();document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
  window.addEventListener('blur',blur);window.addEventListener('focus',focus);
  return()=>{
    animations.forEach(a=>a.cancel());sprites.forEach(s=>s.remove());
    document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);
    window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);
  };
}
