import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export type BlockEditRequest = {
  from: number; to: number; source: string; document: string; path: string; target: HTMLElement; host: HTMLElement;
};

// The rendered block continues to own its dimensions while source is open.
export function BlockSourceEditor({ request, readOnly, onApply, onClose }: {
  request: BlockEditRequest | null; readOnly: boolean;
  onApply: (request: BlockEditRequest, source: string) => string | null;
  onClose: () => void;
}) {
  const input=useRef<HTMLTextAreaElement>(null);
  const region=useRef<HTMLElement>(null);
  const [source,setSource]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    if(!request)return;
    setSource(request.source);setError('');input.current?.focus({preventScroll:true});
  },[request]);
  useLayoutEffect(()=>{
    if(!request)return;
    const position=()=>{
      if(!region.current || !request.target.isConnected)return;
      const host=request.host.getBoundingClientRect(),box=request.target.getBoundingClientRect();
      const scale=request.host.offsetWidth ? host.width/request.host.offsetWidth : 1;
      Object.assign(region.current.style,{top:`${(box.top-host.top)/scale}px`,left:`${(box.left-host.left)/scale}px`,width:`${box.width/scale}px`,height:`${box.height/scale}px`});
    };
    position();request.host.addEventListener('scroll',position,true);
    const observer=new ResizeObserver(position);observer.observe(request.host);observer.observe(request.target);
    return()=>{request.host.removeEventListener('scroll',position,true);observer.disconnect();};
  },[request]);
  if(!request)return null;
  const apply=()=>{
    if(readOnly)return;
    const result=onApply(request,source);
    if(result)setError(result);else onClose();
  };
  return createPortal(<section ref={region} className="pm-inline-source" aria-label="Editar fonte do bloco" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
    if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();apply();}
  }}>
    <div className="pm-inline-source-actions"><span>Markdown · Ctrl + Enter para aplicar</span><button type="button" onClick={onClose}>Cancelar</button><button type="button" disabled={readOnly} onClick={apply}>Aplicar</button></div>
    <textarea ref={input} aria-label="Fonte Markdown do bloco" value={source} readOnly={readOnly} spellCheck={false} onChange={event=>setSource(event.target.value)}/>
    {error&&<p role="alert">{error}</p>}
  </section>,request.host);
}
