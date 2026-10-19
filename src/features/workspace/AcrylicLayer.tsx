import { useEffect, useRef } from 'react';
import { ACRYLIC_FRAGMENT, ACRYLIC_VERTEX } from './acrylic-shader';

const PANELS = '.pm-sidebar,.pm-workspace-panel,.pm-modal,.pm-context-menu,.pm-link-hover-preview,.pm-selection-tools';

/** One context, scissored draws, no idle loop and a maximum 1.5 DPR / 4M pixels. */
export function AcrylicLayer({ enabled, theme }: { enabled: boolean; theme: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const shell = canvas?.closest<HTMLElement>('.pm-shell');
    if (!enabled || !canvas || !shell) return;
    let gl: WebGLRenderingContext | null = null;
    try { gl = canvas.getContext('webgl', { alpha:true, antialias:false, depth:false, stencil:false, premultipliedAlpha:false, powerPreference:'low-power' }); } catch { /* native matte fallback */ }
    if (!gl) { canvas.dataset.renderer='fallback';shell.dataset.gl='fallback';return; }
    const context = gl;
    let program: WebGLProgram | null=null, buffer: WebGLBuffer | null=null;
    let frame=0, stopped=false, lost=false, until=0, panels:HTMLElement[]=[];
    let pointer=[-10000,-10000], draws=0;
    const targets=new Map<HTMLElement, {canvas:HTMLCanvasElement; context:CanvasRenderingContext2D}>();
    const shaders:WebGLShader[]=[];
    const uniforms=new Map<string,WebGLUniformLocation|null>();
    const uniform=(name:string)=>uniforms.get(name)??null;
    const compile=(type:number,source:string)=>{
      const shader=context.createShader(type);if(!shader)throw new Error('Shader allocation');
      shaders.push(shader);context.shaderSource(shader,source);context.compileShader(shader);
      if(!context.getShaderParameter(shader,context.COMPILE_STATUS))throw new Error(context.getShaderInfoLog(shader)||'Shader compilation');
      return shader;
    };
    const initialize=()=>{
      program=context.createProgram();if(!program)throw new Error('Program allocation');
      context.attachShader(program,compile(context.VERTEX_SHADER,ACRYLIC_VERTEX));
      context.attachShader(program,compile(context.FRAGMENT_SHADER,ACRYLIC_FRAGMENT));context.linkProgram(program);
      if(!context.getProgramParameter(program,context.LINK_STATUS))throw new Error('Material link');
      context.useProgram(program);buffer=context.createBuffer();context.bindBuffer(context.ARRAY_BUFFER,buffer);
      context.bufferData(context.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),context.STATIC_DRAW);
      const position=context.getAttribLocation(program,'aPosition');context.enableVertexAttribArray(position);context.vertexAttribPointer(position,2,context.FLOAT,false,0,0);
      ['uViewport','uPointer','uRect','uAccent','uDpr','uRadius','uOpacity'].forEach(n=>uniforms.set(n,context.getUniformLocation(program!,n)));
      canvas.dataset.renderer='webgl';shell.dataset.gl='webgl';
    };
    const invalidate=()=>{ if(!frame&&!stopped&&!lost&&!document.hidden)frame=requestAnimationFrame(render); };
    const resize = new ResizeObserver(()=>invalidate());
    const collect=()=>{
      resize.disconnect();resize.observe(shell);
      panels=Array.from(shell.querySelectorAll<HTMLElement>(PANELS)).slice(0,16);
      targets.forEach((target,panel)=>{if(!panels.includes(panel)){target.canvas.remove();panel.classList.remove('pm-material-host');targets.delete(panel);}});
      panels.forEach(p=>{
        resize.observe(p);
        if(!targets.has(p)){
          const backing=document.createElement('canvas');backing.className='pm-acrylic-pane';backing.setAttribute('aria-hidden','true');
          const target=backing.getContext('2d');if(target){p.prepend(backing);p.classList.add('pm-material-host');targets.set(p,{canvas:backing,context:target});}
        }
      });invalidate();
    };
    const render=(now:number)=>{
      frame=0;if(stopped||lost||document.hidden||!program)return;
      const bounds=canvas.getBoundingClientRect();if(bounds.width<1||bounds.height<1)return;
      const dpr=Math.min(devicePixelRatio||1,1.5,Math.sqrt(4_000_000/(bounds.width*bounds.height)));
      const width=Math.max(1,Math.round(bounds.width*dpr)),height=Math.max(1,Math.round(bounds.height*dpr));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      context.viewport(0,0,width,height);context.disable(context.SCISSOR_TEST);context.clearColor(0,0,0,0);context.clear(context.COLOR_BUFFER_BIT);context.enable(context.SCISSOR_TEST);
      context.uniform2f(uniform('uViewport'),bounds.width,bounds.height);context.uniform1f(uniform('uDpr'),dpr);
      context.uniform2f(uniform('uPointer'),pointer[0]-bounds.left,pointer[1]-bounds.top);
      const hex=getComputedStyle(shell).getPropertyValue('--pm-accent-base').trim().replace('#','');
      const rgb=/^[0-9a-f]{6}$/i.test(hex)?[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16)/255):[.47,.82,.86];
      context.uniform3f(uniform('uAccent'),rgb[0],rgb[1],rgb[2]);
      for(const panel of panels){
        const style=getComputedStyle(panel),opacity=Number(style.opacity),r=panel.getBoundingClientRect();
        if(style.visibility==='hidden'||style.display==='none'||opacity<.01||r.width<1||r.height<1)continue;
        const x=r.left-bounds.left,y=r.top-bounds.top;
        const sx=Math.max(0,Math.floor(x*dpr)),sy=Math.max(0,Math.floor((bounds.height-y-r.height)*dpr));
        const ex=Math.min(width,Math.ceil((x+r.width)*dpr)),ey=Math.min(height,Math.ceil((bounds.height-y)*dpr));
        if(ex<=sx||ey<=sy)continue;
        context.scissor(sx,sy,ex-sx,ey-sy);context.clear(context.COLOR_BUFFER_BIT);context.uniform4f(uniform('uRect'),x,y,r.width,r.height);
        context.uniform1f(uniform('uRadius'),Math.min(r.width,r.height)/2 < 12 ? 4 : (parseFloat(style.borderRadius)||0));
        context.uniform1f(uniform('uOpacity'),1);context.drawArrays(context.TRIANGLES,0,6);
        const target=targets.get(panel);
        if(target){
          const tw=Math.max(1,Math.round(r.width*dpr)),th=Math.max(1,Math.round(r.height*dpr));
          if(target.canvas.width!==tw)target.canvas.width=tw;if(target.canvas.height!==th)target.canvas.height=th;
          target.canvas.style.width=panel.clientWidth+'px';target.canvas.style.height=panel.clientHeight+'px';target.canvas.style.top=panel.scrollTop+'px';
          target.context.clearRect(0,0,tw,th);
          target.context.drawImage(canvas,sx,height-ey,ex-sx,ey-sy,Math.max(0,-x*dpr),Math.max(0,-y*dpr),ex-sx,ey-sy);
        }
      }
      canvas.dataset.draws=String(++draws);
      if(now<until)invalidate();
    };
    const changed=new MutationObserver(records=>{
      if(records.some(r=>{
        if(r.target===canvas)return false;
        if(r.type==='attributes')return r.target===shell||(r.target instanceof Element&&r.target.matches(PANELS));
        return [...r.addedNodes,...r.removedNodes].some(n=>n instanceof Element&&(n.matches(PANELS)||!!n.querySelector(PANELS)));
      }))collect();
    });
    const moving=(e:TransitionEvent)=>{if(e.target instanceof Element&&e.target.matches(PANELS)){until=performance.now()+230;invalidate();}};
    const mouse=(e:PointerEvent)=>{if((e.target as Element)?.closest?.(PANELS))pointer=[e.clientX,e.clientY];else if(pointer[0]!==-10000)pointer=[-10000,-10000];else return;invalidate();};
    const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else invalidate();};
    const onLost=(e:Event)=>{e.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;canvas.dataset.renderer='fallback';shell.dataset.gl='fallback';};
    const restored=()=>{lost=false;try{uniforms.clear();initialize();collect();}catch{onLost(new Event('webglcontextlost'));}};
    try {initialize();collect();} catch(error) {canvas.dataset.renderer='fallback';shell.dataset.gl='fallback';console.warn('Material acrílico indisponível; usando superfície nativa.',error);stopped=true;}
    changed.observe(shell,{childList:true,subtree:true,attributes:true,attributeFilter:['class','style','data-entered','data-visible']});
    shell.addEventListener('scroll',invalidate,true);shell.addEventListener('transitionrun',moving);shell.addEventListener('pointermove',mouse,{passive:true});
    document.addEventListener('visibilitychange',visibility);canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',restored);
    return ()=>{
      stopped=true;cancelAnimationFrame(frame);resize.disconnect();changed.disconnect();
      targets.forEach((target,panel)=>{target.canvas.remove();panel.classList.remove('pm-material-host');});targets.clear();
      shell.removeEventListener('scroll',invalidate,true);shell.removeEventListener('transitionrun',moving);shell.removeEventListener('pointermove',mouse);document.removeEventListener('visibilitychange',visibility);
      canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',restored);
      if(!lost){shaders.forEach(s=>context.deleteShader(s));if(buffer)context.deleteBuffer(buffer);if(program)context.deleteProgram(program);}
      delete shell.dataset.gl;
    };
  },[enabled,theme]);
  return enabled?<canvas ref={ref} className="pm-acrylic-layer" data-material="acrylic" aria-hidden="true"/>:null;
}
