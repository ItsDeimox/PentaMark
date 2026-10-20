import { EnergyNetwork, type EnergyMesh } from './energy-mesh';
import { circuitRoutes } from './signal-routes';
import { createEnergyPainter } from './energy-painter';

/** Accelerated analytic wires, with fixed-density Canvas tiles as fallback. */
export function attachEnergyHover(root:HTMLElement,canvas:HTMLCanvasElement,mesh:EnergyMesh,zoom:number,enabled:boolean,acrylic=false) {
  if(!enabled){canvas.width=canvas.height=1;return()=>{};}
  const size=512,density=Math.min(2,devicePixelRatio||1);
  const bounds=root.getBoundingClientRect(),color=getComputedStyle(root).color;
  let gpu=createEnergyPainter(canvas,mesh,bounds.width,bounds.height,zoom,color,acrylic);
  // Fixed world-space tiles retain the trail without a full-window raster.
  // Allocate only visible tiles. Never stretch backing pixels when a wave grows.
  const createLayer=(i:number)=>{
    let layer=i===0?canvas:document.createElement('canvas');
    let ctx=layer.getContext('2d');
    // An acquired WebGL context cannot become a 2D context after shader failure.
    if(!ctx){
      canvas.hidden=true;canvas.classList.remove('pm-energy-layer');
      canvas.width=canvas.height=1;
      layer=document.createElement('canvas');ctx=layer.getContext('2d');
    }
    layer.className='pm-energy-layer';
    layer.width=layer.height=Math.round(size*density);
    layer.style.width=layer.style.height=`${size/zoom}px`;
    if(layer!==canvas)root.append(layer);
    return {canvas:layer,ctx,dirty:null as number[]|null};
  };
  const layers=gpu?[]:[createLayer(0)];
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const energy=new EnergyNetwork(mesh);
  let frame=0,last=0,painted=0;
  let graphicsLost=false;
  let focused=document.hasFocus();
  let pending:{x:number;y:number}|null=null,previous:{x:number;y:number}|null=null;
  const clearPaint=()=>{
    gpu?.clear();
    for(const layer of layers){
      if(!layer.dirty||!layer.ctx)continue;
      layer.ctx.resetTransform();
      const [x,y,w,h]=layer.dirty;layer.ctx.clearRect(x,y,w,h);layer.dirty=null;
    }
  };
  const clear=()=>{
    cancelAnimationFrame(frame);frame=0;pending=null;previous=null;energy.clear();
    clearPaint();
    while(layers.length>1)layers.pop()!.canvas.remove();
  };
  const lost=(event:Event)=>{event.preventDefault();graphicsLost=true;clear();};
  const restored=()=>{
    gpu?.dispose();layers.forEach(layer=>{if(layer.canvas!==canvas)layer.canvas.remove();});layers.length=0;
    canvas.hidden=false;canvas.classList.add('pm-energy-layer');
    gpu=createEnergyPainter(canvas,mesh,bounds.width,bounds.height,zoom,color,acrylic);
    if(!gpu)layers.push(createLayer(0));
    graphicsLost=false;
  };
  canvas.addEventListener('webglcontextlost',lost);canvas.addEventListener('webglcontextrestored',restored);
  const render=(now:number)=>{
    frame=0;
    if(!enabled||graphicsLost||document.hidden||reduced.matches){clear();return;}
    // Limit only the decorative raster, never scrolling or compositor motion.
    if(now-painted<1000/(gpu?60:30)-1){frame=requestAnimationFrame(render);return;}
    painted=now;
    if(pending){
      if(!previous||Math.hypot(pending.x-previous.x,pending.y-previous.y)>8){
        // Interpolate fast moves so the trail is continuous, with bounded work.
        const distance=previous?Math.hypot(pending.x-previous.x,pending.y-previous.y):0;
        const steps=Math.min(16,Math.max(1,Math.ceil(distance/32)));
        for(let i=1;i<=steps;i++){
          const t=i/steps;
          energy.inject(previous?previous.x+(pending.x-previous.x)*t:pending.x,
            previous?previous.y+(pending.y-previous.y)*t:pending.y);
        }
        previous=pending;
      }
      pending=null;
    }
    energy.step((now-last)/1000);last=now;
    if(!energy.active){clear();return;}
    if(gpu){gpu.draw(energy.values);frame=requestAnimationFrame(render);return;}
    clearPaint();
    const positions=energy.samplePositions(now/1000);
    const segments:{ax:number;ay:number;bx:number;by:number;level:number}[]=[];
    for(const [a,b] of mesh.edges){
      const va=energy.values[a],vb=energy.values[b];
      if(Math.max(va,vb)<.008)continue;
      const p=positions[a],q=positions[b];
      for(let s=0;s<4;s++){
        const t=(s+.5)/4,e=va*(1-t)+vb*t;
        // Checkpoint's nonlinear radiance: dark background, bright wave front.
        const tLight=Math.max(0,Math.min(1,(e-.18)/(.92)));
        const radiance=Math.pow(Math.max(e-.02,0),.92)*(1+3.7*tLight*tLight*(3-2*tLight));
        const level=Math.min(11,Math.floor(radiance*11));
        if(level<1)continue;
        const ax=p.x+(q.x-p.x)*s/4,ay=p.y+(q.y-p.y)*s/4;
        const bx=p.x+(q.x-p.x)*(s+1)/4,by=p.y+(q.y-p.y)*(s+1)/4;
        segments.push({ax,ay,bx,by,level});
      }
    }
    const tiles=new Map<string,{x:number;y:number;minX:number;minY:number;maxX:number;maxY:number;buckets:Path2D[]}>();
    const tileSize=size;
    {
      for(const {ax,ay,bx,by,level} of segments){
        for(let ty=Math.floor((Math.min(ay,by)-12)/tileSize);ty<=Math.floor((Math.max(ay,by)+12)/tileSize);ty++)
          for(let tx=Math.floor((Math.min(ax,bx)-12)/tileSize);tx<=Math.floor((Math.max(ax,bx)+12)/tileSize);tx++){
            if(tx*tileSize>=bounds.width||ty*tileSize>=bounds.height||tx<0||ty<0)continue;
            const key=`${tx}:${ty}`;
            let tile=tiles.get(key);
            if(!tile){tile={x:tx*tileSize,y:ty*tileSize,minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity,buckets:Array.from({length:12},()=>new Path2D())};tiles.set(key,tile);}
            tile.minX=Math.min(tile.minX,ax,bx);tile.minY=Math.min(tile.minY,ay,by);
            tile.maxX=Math.max(tile.maxX,ax,bx);tile.maxY=Math.max(tile.maxY,ay,by);
            tile.buckets[level].moveTo(ax,ay);tile.buckets[level].lineTo(bx,by);
          }
      }
    }
    if(!tiles.size){clear();return;}
    const visible=[...tiles.values()];
    while(layers.length<visible.length)layers.push(createLayer(layers.length));
    // Free spare backing stores after the front contracts.
    while(layers.length>Math.max(1,visible.length))layers.pop()!.canvas.remove();
    const renderDensity=density*size/tileSize;
    for(let j=0;j<visible.length;j++){
      const tile=visible[j],{canvas,ctx}=layers[j];if(!ctx)continue;
      canvas.style.width=canvas.style.height=`${tileSize/zoom}px`;
      canvas.style.transform=`translate(${tile.x/zoom}px,${tile.y/zoom}px)`;
      ctx.setTransform(renderDensity,0,0,renderDensity,-tile.x*renderDensity,-tile.y*renderDensity);
      // Include complete neighboring faces and glows; only invalidate painted pixels.
      const left=Math.max(0,Math.floor((tile.minX-tile.x-80)*renderDensity));
      const top=Math.max(0,Math.floor((tile.minY-tile.y-80)*renderDensity));
      const right=Math.min(canvas.width,Math.ceil((tile.maxX-tile.x+80)*renderDensity));
      const bottom=Math.min(canvas.height,Math.ceil((tile.maxY-tile.y+80)*renderDensity));
      layers[j].dirty=[left,top,right-left,bottom-top];
      ctx.save();
      ctx.beginPath();ctx.rect(tile.x+left/renderDensity,tile.y+top/renderDensity,(right-left)/renderDensity,(bottom-top)/renderDensity);ctx.clip();
      ctx.strokeStyle=color;ctx.lineCap='round';
      for(let i=1;i<12;i++)for(const [width,alpha] of [[22,.008],[12,.02],[4,.045],[.4,.18]]){
        ctx.strokeStyle=width<1?`color-mix(in srgb, ${color} 90%, white)`:color;
        ctx.lineWidth=width;ctx.globalAlpha=i/11*alpha;ctx.stroke(tile.buckets[i]);
      }
      ctx.restore();
      ctx.globalAlpha=1;
    }
    frame=requestAnimationFrame(render);
  };
  const pointer=(e:PointerEvent)=>{
    if(e.pointerType==='touch'||e.buttons){pending=null;previous=null;return;}
    if(!enabled||!focused||graphicsLost||document.hidden||reduced.matches)return;
    if(e.clientX<bounds.left||e.clientX>=bounds.right||e.clientY<bounds.top||e.clientY>=bounds.bottom)return;
    pending={x:e.clientX-bounds.left,y:e.clientY-bounds.top};
    if(!frame){last=performance.now();painted=0;frame=requestAnimationFrame(render);}
  };
  // Stop injection, not propagation. Existing energy finishes its finite decay.
  const stopInput=()=>{pending=null;previous=null;};
  const leave=(e:PointerEvent)=>{if(!e.relatedTarget)stopInput();};
  const blur=()=>{focused=false;stopInput();},focus=()=>{focused=true;};
  clear();
  if(enabled)document.addEventListener('pointermove',pointer,{passive:true});
  document.addEventListener('pointerout',leave);
  document.addEventListener('visibilitychange',clear);
  window.addEventListener('blur',blur);window.addEventListener('focus',focus);reduced.addEventListener('change',clear);
  return()=>{
    clear();document.removeEventListener('pointermove',pointer);document.removeEventListener('pointerout',leave);
    document.removeEventListener('visibilitychange',clear);window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);
    reduced.removeEventListener('change',clear);
    layers.forEach(layer=>{if(layer.canvas!==canvas)layer.canvas.remove();});
    gpu?.dispose();
    canvas.removeEventListener('webglcontextlost',lost);canvas.removeEventListener('webglcontextrestored',restored);
    canvas.width=canvas.height=1;
    canvas.hidden=false;canvas.classList.add('pm-energy-layer');
  };
}

/** Original SVG dash travel: the luminous stroke bends with the circuit itself. */
export function attachAmbientSignals(host:HTMLElement,width:number,height:number,enabled:boolean) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const routes=circuitRoutes(width,height);
  const animations:Animation[]=[];
  const ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg');
  svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  svg.setAttribute('width',String(width));svg.setAttribute('height',String(height));
  svg.setAttribute('aria-hidden','true');host.append(svg);
  for(let i=0;i<routes.length;i++){
    const route=routes[i];
    const d=route.map((p,j)=>`${j?'L':'M'}${p.x} ${p.y}`).join('');
    for(const name of ['pm-signal-track','pm-signal-halo','pm-signal-packet']){
      const path=document.createElementNS(ns,'path');path.setAttribute('class',name);
      path.setAttribute('d',d);path.setAttribute('pathLength','1000');svg.append(path);
      if(name!=='pm-signal-track')animations.push(path.animate([{strokeDashoffset:'0'},{strokeDashoffset:'-1000'}],
        {duration:(16+i%5*3)*1000,delay:-i*3700,iterations:Infinity}));
    }
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
    animations.forEach(a=>a.cancel());svg.remove();
    document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);
    window.removeEventListener('blur',blur);window.removeEventListener('focus',focus);
  };
}
