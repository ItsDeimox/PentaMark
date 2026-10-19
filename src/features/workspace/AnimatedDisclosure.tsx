import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Pixel-height animation survives reversals; exit unmounts on finish, not a timer. */
export function AnimatedDisclosure({open,children}:{open:boolean;children:()=>ReactNode}) {
 const ref=useRef<HTMLDivElement>(null),running=useRef<Animation|null>(null);
 const [mounted,setMounted]=useState(open);
 useLayoutEffect(()=>{
  const el=ref.current;if(!el)return;
  if(open&&!mounted){setMounted(true);return;}
  const start=el.getBoundingClientRect().height;
  running.current?.cancel();running.current=null;el.style.height=`${start}px`;
  const end=open?(el.firstElementChild as HTMLElement|null)?.scrollHeight||0:0;
  const finish=()=>{el.style.height=open?'auto':'0px';if(!open)setMounted(false);};
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||Math.abs(start-end)<.5){finish();return;}
  const animation=el.animate([{height:`${start}px`},{height:`${end}px`}],{duration:180,easing:'cubic-bezier(.2,.7,.2,1)',fill:'forwards'});
  running.current=animation;
  animation.onfinish=()=>{if(running.current!==animation)return;finish();running.current=null;animation.cancel();};
  return()=>{
   if(running.current!==animation)return;
   // Commit the displayed height before cancellation so a reverse has no jump.
   el.style.height=`${el.getBoundingClientRect().height}px`;
   running.current=null;animation.cancel();
  };
 },[open,mounted]);
 return <div ref={ref} className="pm-tree-disclosure" data-expanded={open} inert={!open}>
  <div className="pm-folder-children">{mounted?children():null}</div>
 </div>;
}
