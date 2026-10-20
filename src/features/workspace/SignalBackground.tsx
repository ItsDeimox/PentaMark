import { memo, useEffect, useRef, useState } from 'react';
import { createEnergyMesh, type EnergyMesh } from './energy-mesh';
import { attachEnergyHover, attachAmbientSignals } from './signal-renderer';

type Geometry = {mesh:EnergyMesh|null;width:number;height:number;zoom:number;density:number};
type Props = {animated:boolean;reactive:boolean;theme:string;acrylic?:boolean};

/** Geometry changes on resize, never on pointer input or document edits. */
export const SignalBackground = memo(function SignalBackground(props:Props) {
  return props.animated || props.reactive ? <ActiveSignalBackground {...props}/> : null;
});

function ActiveSignalBackground({animated,reactive,theme,acrylic=false}:Props) {
  const host=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null);
  const ambient=useRef<HTMLDivElement>(null);
  const [geometry,setGeometry]=useState<Geometry|null>(null);
  useEffect(()=>{
    const root=host.current;if(!root)return;
    let timer:ReturnType<typeof setTimeout>;
    const measure=()=>{
      const bounds=root.getBoundingClientRect();
      const width=Math.max(1,Math.round(bounds.width)),height=Math.max(1,Math.round(bounds.height));
      const zoom=bounds.width/Math.max(1,root.clientWidth);
      const density=devicePixelRatio||1;
      setGeometry(previous=>previous&&previous.width===width&&previous.height===height&&previous.density===density&&Math.abs(previous.zoom-zoom)<.001&&Boolean(previous.mesh)===reactive
        ?previous:{mesh:reactive?(previous?.width===width&&previous?.height===height&&previous.mesh?previous.mesh:createEnergyMesh(width,height)):null,width,height,zoom,density});
    };
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(measure,100);};
    const observer=new ResizeObserver(schedule);observer.observe(root);
    window.addEventListener('resize',schedule);measure();
    return()=>{clearTimeout(timer);observer.disconnect();window.removeEventListener('resize',schedule);};
  },[reactive]);
  useEffect(()=>{
    if(!reactive||!host.current||!canvas.current||!geometry?.mesh)return;
    return attachEnergyHover(host.current,canvas.current,geometry.mesh,geometry.zoom,reactive,acrylic);
  },[geometry,reactive,theme,acrylic]);
  useEffect(()=>{
    if(!animated||!ambient.current||!geometry)return;
    return attachAmbientSignals(ambient.current,geometry.width,geometry.height,animated);
  },[geometry,animated]);
  return <div ref={host} className="pm-signal-background" aria-hidden="true" data-animated={animated}>
    {reactive&&geometry?.mesh&&<svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none" focusable="false">
      <path className="pm-mesh-track" d={geometry.mesh.path}/>
    </svg>}
    {animated&&<div ref={ambient} className="pm-ambient-signals" style={{transform:`scale(${1/(geometry?.zoom||1)})`}}/>}
    {reactive&&<canvas ref={canvas} className="pm-energy-layer"/>}
  </div>;
}
