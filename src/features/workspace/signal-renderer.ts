import { EnergyNetwork, type EnergyMesh } from './energy-mesh';
import { circuitRoutes } from './signal-routes';

/** A bounded high-DPI tile, not a window-sized raster uploaded every frame. */
export function attachEnergyHover(root:HTMLElement,canvas:HTMLCanvasElement,mesh:EnergyMesh,zoom:number,enabled:boolean) {
  const size=512,density=Math.min(2,devicePixelRatio||1);
  // Fixed world-space tiles retain the trail without a full-window raster.
  // Four is a hard upper bound, independent of monitor size.
  const layers=Array.from({length:4},(_,i)=>{
    const layer=i===0?canvas:document.createElement('canvas');
    layer.className='pm-energy-layer';
    layer.width=layer.height=Math.round(size*density);
    layer.style.width=layer.style.height=`${size/zoom}px`;
    if(i)root.append(layer);
    return {canvas:layer,ctx:layer.getContext('2d'),dirty:null as number[]|null};
  });
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const energy=new EnergyNetwork(mesh),bounds=root.getBoundingClientRect();
  const color=getComputedStyle(root).color;
  let frame=0,last=0,painted=0;
  let focused=document.hasFocus();
  let pending:{x:number;y:number}|null=null,previous:{x:number;y:number}|null=null;
  const clearPaint=()=>{
    for(const layer of layers){
      if(!layer.dirty||!layer.ctx)continue;
      layer.ctx.resetTransform();
      const [x,y,w,h]=layer.dirty;layer.ctx.clearRect(x,y,w,h);layer.dirty=null;
    }
  };
  const clear=()=>{
    cancelAnimationFrame(frame);frame=0;pending=null;previous=null;energy.clear();
    clearPaint();
  };
  const render=(now:number)=>{
    frame=0;
    if(!enabled||!focused||document.hidden||reduced.matches){clear();return;}
    // Limit only the decorative raster, never scrolling or compositor motion.
    if(now-painted<1000/24){frame=requestAnimationFrame(render);return;}
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
    clearPaint();
    if(!energy.active){previous=null;return;}
    const positions=energy.samplePositions(now/1000);
    const faces=Array.from({length:4},()=>new Path2D());
    for(const cell of mesh.cells||[]){
      const strength=cell.reduce((sum,i)=>sum+energy.values[i],0)/cell.length;
      const level=Math.min(3,Math.floor(Math.sqrt(strength)*6));
      if(level<1)continue;
      const first=positions[cell[0]];faces[level].moveTo(first.x,first.y);
      for(let i=1;i<cell.length;i++)faces[level].lineTo(positions[cell[i]].x,positions[cell[i]].y);
      faces[level].closePath();
    }
    const segments:{ax:number;ay:number;bx:number;by:number;level:number}[]=[];
    for(const [a,b] of mesh.edges){
      const va=energy.values[a],vb=energy.values[b];
      if(Math.max(va,vb)<.008)continue;
      const p=positions[a],q=positions[b];
      for(let s=0;s<4;s++){
        const t=(s+.5)/4,e=va*(1-t)+vb*t;
        const level=Math.min(11,Math.floor(Math.sqrt(e)*11));
        if(level<1)continue;
        const ax=p.x+(q.x-p.x)*s/4,ay=p.y+(q.y-p.y)*s/4;
        const bx=p.x+(q.x-p.x)*(s+1)/4,by=p.y+(q.y-p.y)*(s+1)/4;
        segments.push({ax,ay,bx,by,level});
      }
    }
    const tiles=new Map<string,{x:number;y:number;minX:number;minY:number;maxX:number;maxY:number;buckets:Path2D[]}>();
    let tileSize=size;
    // Expand coverage for unusually long trails instead of dropping live tiles.
    // Backing pixel count remains capped; normal local motion keeps full 2x DPI.
    for(;;tileSize*=2){
      tiles.clear();
      for(const {ax,ay,bx,by,level} of segments){
        for(let ty=Math.floor((Math.min(ay,by)-6)/tileSize);ty<=Math.floor((Math.max(ay,by)+6)/tileSize);ty++)
          for(let tx=Math.floor((Math.min(ax,bx)-6)/tileSize);tx<=Math.floor((Math.max(ax,bx)+6)/tileSize);tx++){
            if(tx*tileSize>=bounds.width||ty*tileSize>=bounds.height||tx<0||ty<0)continue;
            const key=`${tx}:${ty}`;
            let tile=tiles.get(key);
            if(!tile){tile={x:tx*tileSize,y:ty*tileSize,minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity,buckets:Array.from({length:12},()=>new Path2D())};tiles.set(key,tile);}
            tile.minX=Math.min(tile.minX,ax,bx);tile.minY=Math.min(tile.minY,ay,by);
            tile.maxX=Math.max(tile.maxX,ax,bx);tile.maxY=Math.max(tile.maxY,ay,by);
            tile.buckets[level].moveTo(ax,ay);tile.buckets[level].lineTo(bx,by);
          }
      }
      if(tiles.size<=layers.length)break;
    }
    if(!tiles.size){energy.clear();previous=null;return;}
    const visible=[...tiles.values()];
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
      ctx.fillStyle=color;
      for(let i=1;i<4;i++){ctx.globalAlpha=i*.006;ctx.fill(faces[i]);}
      ctx.strokeStyle=color;ctx.lineCap='round';
      for(let i=1;i<12;i++)for(const [width,alpha] of [[11,.024],[4,.095],[.7,.95]]){
        ctx.lineWidth=width;ctx.globalAlpha=i/11*alpha;ctx.stroke(tile.buckets[i]);
      }
      // Short chromatic echoes, offset only a couple of screen pixels.
      // No CSS/SVG blur surfaces or per-cell DOM nodes.
      for(let i=3;i<12;i++){
        const flutter=Math.sin(now*.025+i*2.4),echo=1.5+flutter*.45;
        ctx.save();ctx.translate(echo,flutter*.55);
        ctx.strokeStyle='#df91ef';ctx.lineWidth=.65;ctx.globalAlpha=i/11*.32;
        ctx.stroke(tile.buckets[i]);ctx.restore();
        ctx.save();ctx.translate(-echo,-flutter*.55);
        ctx.strokeStyle='#a5f5ff';ctx.lineWidth=.55;ctx.globalAlpha=i/11*.16;
        ctx.stroke(tile.buckets[i]);ctx.restore();
      }
      ctx.restore();
      ctx.globalAlpha=1;
    }
    frame=requestAnimationFrame(render);
  };
  const pointer=(e:PointerEvent)=>{
    if(e.pointerType==='touch'||e.buttons){pending=null;previous=null;return;}
    if(!enabled||!focused||document.hidden||reduced.matches)return;
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
    layers.slice(1).forEach(layer=>layer.canvas.remove());
  };
}

/** Small prepainted light sprites; only transform/opacity animate on the compositor. */
export function attachAmbientSignals(host:HTMLElement,width:number,height:number,enabled:boolean) {
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const routes=circuitRoutes(width,height);
  const animations:Animation[]=[],sprites:HTMLElement[]=[];
  for(let i=0;i<routes.length;i++){
    const sprite=document.createElement('i');sprite.className='pm-signal-packet';
    host.append(sprite);sprites.push(sprite);
    const route=routes[i];
    const frames:Keyframe[]=[];let total=0;
    const lengths=route.slice(1).map((b,j)=>{
      const a=route[j],length=Math.hypot(b.x-a.x,b.y-a.y);total+=length;return length;
    });
    let distance=0;
    for(let j=0;j<lengths.length;j++){
      const a=route[j],b=route[j+1],angle=Math.atan2(b.y-a.y,b.x-a.x);
      const transform=(x:number,y:number)=>`translate(${x}px,${y}px) rotate(${angle}rad)`;
      const from=distance/total;distance+=lengths[j];const to=distance/total;
      frames.push({transform:transform(a.x,a.y),offset:from,opacity:j===0?0:.58});
      frames.push({transform:transform(b.x,b.y),offset:to,opacity:j===lengths.length-1?0:.58});
    }
    if(!frames.length)continue;
    const animation=sprite.animate(frames,{duration:(16+i%5*3)*1000,delay:-i*3700,iterations:Infinity});
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
