import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createEnergyMesh } from './energy-mesh';

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
const cells=createEnergyMesh();

export function SignalBackground({ animated }: { animated: boolean }) {
  const svg=useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(()=>{
    const root=svg.current;
    if(!root)return;
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const nodes=Array.from(root.querySelectorAll<SVGGElement>('.pm-energy-cell'));
    const energy=new Float32Array(cells.length),next=new Float32Array(cells.length);
    let trails:Array<{x:number;y:number;time:number}>=[],frame=0,last=0;
    let previous: {x:number;y:number}|null=null;
    const clear=()=>{
      cancelAnimationFrame(frame);frame=0;trails=[];previous=null;energy.fill(0);
      nodes.forEach(n=>{n.style.opacity='0';n.removeAttribute('transform');});
    };
    const render=(now:number)=>{
      frame=0;
      if(!animated||document.hidden||reduced.matches){clear();return;}
      const dt=Math.min(.05,(now-last)/1000);last=now;
      trails=trails.filter(p=>now-p.time<1300);
      let active=false;
      cells.forEach((cell,i)=>{
        let excitation=0,dx=0,dy=0;
        for(const p of trails){
          const age=(now-p.time)/1000,distance=Math.hypot(cell.x-p.x,cell.y-p.y);
          const front=35+age*115;
          const ring=Math.exp(-(((distance-front)/39)**2));
          const core=Math.exp(-((distance/85)**2))*.24;
          const light=(ring*.9+core)*Math.exp(-age*3.8);
          if(light>excitation){excitation=light;dx=(cell.x-p.x)/Math.max(1,distance);dy=(cell.y-p.y)/Math.max(1,distance);}
        }
        const transported=cell.neighbors.reduce((sum,j)=>sum+energy[j],0)/Math.max(1,cell.neighbors.length);
        next[i]=Math.min(1,Math.max(excitation,energy[i]*Math.exp(-dt*5)+(transported-energy[i])*Math.min(.2,dt*2)));
        const e=next[i];active ||= e>.003;
        nodes[i].style.opacity=e>.003?e.toFixed(3):'0';
        if(e>.003)nodes[i].setAttribute('transform',`translate(${(dx*e*5).toFixed(2)} ${(dy*e*5).toFixed(2)})`);
        else nodes[i].removeAttribute('transform');
      });
      energy.set(next);
      if(active||trails.length)frame=requestAnimationFrame(render);
    };
    const pointer=(e:PointerEvent)=>{
      if(!animated||document.hidden||reduced.matches||e.pointerType==='touch')return;
      const matrix=root.getScreenCTM();if(!matrix)return;
      const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());
      if(previous&&Math.hypot(p.x-previous.x,p.y-previous.y)<12)return;
      previous=p;trails.push({x:p.x,y:p.y,time:performance.now()});
      if(trails.length>36)trails.shift();
      if(!frame){last=performance.now();frame=requestAnimationFrame(render);}
    };
    document.addEventListener('pointermove',pointer,{passive:true});
    document.addEventListener('visibilitychange',clear);
    window.addEventListener('blur',clear);
    reduced.addEventListener('change',clear);
    return()=>{clear();document.removeEventListener('pointermove',pointer);document.removeEventListener('visibilitychange',clear);window.removeEventListener('blur',clear);reduced.removeEventListener('change',clear);};
  },[animated,visible]);
  return <svg ref={svg} className="pm-signal-background" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"
    aria-hidden="true" focusable="false" data-animated={animated && visible}>
    {cells.map((cell,i)=><g key={i}>
      <path className="pm-mesh-track" d={cell.path}/>
      <g className="pm-energy-cell" style={{opacity:0}}>
        <path className="pm-energy-bloom" d={cell.path}/>
        <path className="pm-energy-wire" d={cell.path}/>
      </g>
    </g>)}
    {routes.map((d, i) => <g key={d} style={{ '--signal-duration': `${16 + i % 5 * 3}s`, '--signal-delay': `${-i * 3.7}s` } as CSSProperties}>
      <path className="pm-signal-track" d={d} />
      <path className="pm-signal-halo" d={d} pathLength={1000} />
      <path className="pm-signal-packet" d={d} pathLength={1000} />
    </g>)}
    {[[180,175],[110,470],[210,840],[475,90],[860,130],[1430,235],[1510,525],[1410,840],[1290,135],[800,905]].map(([cx,cy]) =>
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.5" className="pm-signal-node" />)}
  </svg>;
}
