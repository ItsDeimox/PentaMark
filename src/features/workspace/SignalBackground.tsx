import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createEnergyMesh, EnergyNetwork } from './energy-mesh';

// Fixed routes keep the pattern stable during editing and theme changes.
const routes = [
  'M-40 90 H95 L180 175 V400 L110 470 V740 L210 840 H380 L460 920 V1040',
  'M-40 130 H65 L145 210 V375 L75 445 V770 L180 875 H345 L415 945 V1040',
  'M-40 340 H15 L65 290 V90 L155 0',
  'M160 -40 V60 L255 155 H410 L475 90 H650 L720 20 V-40',
  'M205 -40 V30 L295 120 H395 L460 55 H620 L680 -5',
  'M450 -40 V10 L520 80 H810 L860 130 H1040 L1160 10 V-40',
  'M1640 150 H1515 L1430 235 V445 L1510 525 V740 L1410 840 H1240 L1160 920 V1040',
  'M1640 190 H1550 L1465 275 V420 L1545 500 V775 L1440 880 H1270 L1200 950 V1040',
  'M1640 420 H1590 L1540 370 V110 L1430 0',
  'M1380 -40 V45 L1290 135 H1170 L1110 75 H980 L930 25 V-40',
  'M-40 970 H150 L245 875 H410 L520 985 H720 L800 905 H1000 L1095 1000',
  'M1640 960 H1490 L1390 910 H1300 L1210 1000',
];
const mesh=createEnergyMesh();

export function SignalBackground({ animated,theme }: { animated: boolean;theme:string }) {
  const host=useRef<HTMLDivElement>(null);
  const canvas=useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(()=>{
    const root=host.current,layer=canvas.current,ctx=layer?.getContext('2d');
    if(!root||!layer||!ctx)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const energy=new EnergyNetwork(mesh);
    let frame=0,last=0,pending:{x:number;y:number}|null=null,previous:{x:number;y:number}|null=null;
    let bounds=root.getBoundingClientRect(),scale=1,offsetX=0,offsetY=0;
    const color=getComputedStyle(root).color;
    const clear=()=>{
      cancelAnimationFrame(frame);frame=0;pending=null;previous=null;energy.clear();
      ctx.resetTransform();ctx.clearRect(0,0,layer.width,layer.height);
    };
    const resize=()=>{
      clear();bounds=root.getBoundingClientRect();
      const density=Math.min(1,1600/Math.max(1,bounds.width),1000/Math.max(1,bounds.height));
      layer.width=Math.max(1,Math.round(bounds.width*density));layer.height=Math.max(1,Math.round(bounds.height*density));
      scale=Math.max(bounds.width/1600,bounds.height/1000);
      offsetX=(bounds.width-1600*scale)/2;offsetY=(bounds.height-1000*scale)/2;
    };
    const render=(now:number)=>{
      frame=0;
      if(!animated||document.hidden||reduced.matches){clear();return;}
      // Coalesce input; never measure layout at pointer-event frequency.
      if(pending){
        if(!previous||Math.hypot(pending.x-previous.x,pending.y-previous.y)>6){
          energy.inject(pending.x,pending.y);previous=pending;
        }
        pending=null;
      }
      energy.step((now-last)/1000);last=now;
      ctx.resetTransform();ctx.clearRect(0,0,layer.width,layer.height);
      const density=layer.width/Math.max(1,bounds.width);
      ctx.setTransform(scale*density,0,0,scale*density,offsetX*density,offsetY*density);
      const buckets=Array.from({length:16},()=>new Path2D());
      for(const [a,b] of mesh.edges){
        const va=energy.values[a],vb=energy.values[b];
        if(Math.max(va,vb)<.008)continue;
        const p=mesh.points[a],q=mesh.points[b];
        for(let s=0;s<3;s++){
          const t=(s+.5)/3,e=va*(1-t)+vb*t;
          const level=Math.min(15,Math.floor(Math.sqrt(e)*15));
          if(level<1)continue;
          buckets[level].moveTo(p.x+(q.x-p.x)*s/3,p.y+(q.y-p.y)*s/3);
          buckets[level].lineTo(p.x+(q.x-p.x)*(s+1)/3,p.y+(q.y-p.y)*(s+1)/3);
        }
      }
      ctx.strokeStyle=color;ctx.lineCap='round';
      // Batched layered strokes: no per-cell blur surfaces or DOM mutations.
      for(let i=1;i<16;i++)for(const [width,alpha] of [[7,.035],[3,.10],[.85,.85]]){
        ctx.lineWidth=width;ctx.globalAlpha=i/15*alpha;ctx.stroke(buckets[i]);
      }
      ctx.globalAlpha=1;
      if(energy.active)frame=requestAnimationFrame(render);
    };
    const pointer=(e:PointerEvent)=>{
      if(!animated||document.hidden||reduced.matches||e.pointerType==='touch'||e.buttons)return;
      pending={x:(e.clientX-bounds.left-offsetX)/scale,y:(e.clientY-bounds.top-offsetY)/scale};
      if(!frame){last=performance.now();frame=requestAnimationFrame(render);}
    };
    const observer=new ResizeObserver(resize);observer.observe(root);resize();
    document.addEventListener('pointermove',pointer,{passive:true});
    document.addEventListener('visibilitychange',clear);
    window.addEventListener('blur',clear);
    reduced.addEventListener('change',clear);
    return()=>{clear();observer.disconnect();document.removeEventListener('pointermove',pointer);document.removeEventListener('visibilitychange',clear);window.removeEventListener('blur',clear);reduced.removeEventListener('change',clear);};
  },[animated,visible,theme]);
  return <div ref={host} className="pm-signal-background" aria-hidden="true" data-animated={animated && visible}>
    <canvas ref={canvas} className="pm-energy-layer"/>
    <svg viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
    <path className="pm-mesh-track" d={mesh.path}/>
    {routes.map((d, i) => <g key={d} style={{ '--signal-duration': `${16 + i % 5 * 3}s`, '--signal-delay': `${-i * 3.7}s` } as CSSProperties}>
      <path className="pm-signal-track" d={d} />
      <path className="pm-signal-halo" d={d} pathLength={1000} />
      <path className="pm-signal-packet" d={d} pathLength={1000} />
    </g>)}
    {[[180,175],[110,470],[210,840],[475,90],[860,130],[1430,235],[1510,525],[1410,840],[1290,135],[800,905]].map(([cx,cy]) =>
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.5" className="pm-signal-node" />)}
  </svg></div>;
}
