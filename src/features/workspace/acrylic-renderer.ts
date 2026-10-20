import { ACRYLIC_FRAGMENT, ACRYLIC_VERTEX } from './acrylic-shader';
import { fragmentClip } from './fragment-reveal';

const CHROME='.pm-sidebar,.pm-workspace-panel,.pm-modal,.pm-context-menu,.pm-copy-path-submenu,.pm-link-hover-preview,.pm-asset-workspace>header,.pm-asset-workspace>footer,.pm-lock-banner,.pm-toast,.pm-mobile-dock';
const INSET='.pm-identity-card,.pm-material-demo,.pm-vault-location,.pm-notice,.pm-connection-status,.pm-option-row,.pm-client-card,.pm-mobile-setup-card';
const DOCUMENT='.pm-callout,.pm-properties,.pm-kanban,.pm-markdown pre';
const SURFACES=`${CHROME},${INSET},${DOCUMENT}`;
const MAX_TARGETS=20, BACKING_BUDGET=8_000_000, SCRATCH_BUDGET=2_000_000;
type Geometry={x:number;y:number;scale:number;width:number;height:number;left:number;top:number;cropWidth:number;cropHeight:number;radius:number};
type Target={pane:HTMLCanvasElement;ctx:CanvasRenderingContext2D;g:Geometry;density:number;dirty:boolean;hover:number;pointer:[number,number];paints:number;kind:number};

export function attachAcrylicRenderer(canvas:HTMLCanvasElement,shell:HTMLElement):()=>void {
 let gl:WebGLRenderingContext|null=null;
 try{gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,premultipliedAlpha:false,powerPreference:'low-power'});}catch{/* Native fallback. */}
 const fallback=()=>{canvas.dataset.renderer='fallback';shell.dataset.gl='fallback';};
 if(!gl){fallback();return()=>{delete shell.dataset.gl;};}
 const context=gl,targets=new Map<HTMLElement,Target>(),controls=new Set<HTMLElement>(),active=new Set<HTMLElement>();
 const uniforms=new Map<string,WebGLUniformLocation|null>();
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const sidebar=shell.querySelector<HTMLElement>('.pm-sidebar');
 let program:WebGLProgram|null=null,buffer:WebGLBuffer|null=null;
 let frame=0,stopped=false,lost=false,registryDirty=true,layoutDirty=true,movingUntil=0,lastTime=0,draws=0;
 let candidates:HTMLElement[]=[],cursor:[number,number]=[-10000,-10000],control:HTMLElement|null=null;
 let navigation=shell.dataset.navigation==='true',reveal=navigation?1:0,ownedStyle='';
 let motion:{from:number;to:number;start:number;duration:number}|null=null;
 const uniform=(name:string)=>uniforms.get(name)??null;
 const accentHex=getComputedStyle(shell).getPropertyValue('--pm-accent-base').trim().replace('#','');
 const accent=/^[0-9a-f]{6}$/i.test(accentHex)?[0,2,4].map(i=>parseInt(accentHex.slice(i,i+2),16)/255):[.47,.82,.86];
 function initialize(){
  const shaders:WebGLShader[]=[];
  try{
   program=context.createProgram();if(!program)throw new Error('Program allocation');
   for(const [type,source] of [[context.VERTEX_SHADER,ACRYLIC_VERTEX],[context.FRAGMENT_SHADER,ACRYLIC_FRAGMENT]] as const){
    const s=context.createShader(type);if(!s)throw new Error('Shader allocation');shaders.push(s);
    context.shaderSource(s,source);context.compileShader(s);if(!context.getShaderParameter(s,context.COMPILE_STATUS))throw new Error(context.getShaderInfoLog(s)||'Shader compilation');context.attachShader(program,s);
   }
   context.linkProgram(program);if(!context.getProgramParameter(program,context.LINK_STATUS))throw new Error(context.getProgramInfoLog(program)||'Material link');
   context.useProgram(program);buffer=context.createBuffer();if(!buffer)throw new Error('Buffer allocation');
   context.bindBuffer(context.ARRAY_BUFFER,buffer);context.bufferData(context.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),context.STATIC_DRAW);
   const position=context.getAttribLocation(program,'aPosition');context.enableVertexAttribArray(position);context.vertexAttribPointer(position,2,context.FLOAT,false,0,0);
   for(const name of ['uSize','uCrop','uCropSize','uBuffer','uPointer','uAccent','uDensity','uRadius','uHover','uKind','uReveal','uLight'])uniforms.set(name,context.getUniformLocation(program,name));
   context.uniform3f(uniform('uAccent'),accent[0],accent[1],accent[2]);
   context.uniform1f(uniform('uLight'),shell.dataset.theme==='pearl'?1:0);
   canvas.dataset.renderer='webgl';shell.dataset.gl='webgl';
  }finally{shaders.forEach(s=>context.deleteShader(s));}
 }
 function invalidate(){if(!frame&&!stopped&&!lost&&!document.hidden){lastTime=performance.now();frame=requestAnimationFrame(render);}}
 const resized=new ResizeObserver(()=>{layoutDirty=true;invalidate();});
 const intersecting=new Set<Element>();
 const intersections=new IntersectionObserver(entries=>{entries.forEach(e=>e.isIntersecting?intersecting.add(e.target):intersecting.delete(e.target));layoutDirty=true;invalidate();});
 function release(panel:HTMLElement,target:Target){
  target.pane.remove();target.pane.width=target.pane.height=1;panel.classList.remove('pm-material-host','pm-material-control','pm-material-relative');delete panel.dataset.surface;targets.delete(panel);
 }
 function collect(){
  registryDirty=false;resized.disconnect();intersections.disconnect();intersecting.clear();
  candidates=Array.from(shell.querySelectorAll<HTMLElement>(SURFACES)).filter(p=>!p.matches(DOCUMENT)||!p.parentElement?.closest(DOCUMENT));
  candidates.sort((a,b)=>Number(b.matches('.pm-modal'))-Number(a.matches('.pm-modal'))||Number(a.matches(DOCUMENT))-Number(b.matches(DOCUMENT)));
  resized.observe(shell);for(const p of candidates){resized.observe(p);intersections.observe(p);intersecting.add(p);}
  const topDialog=Array.from(shell.querySelectorAll('dialog[open]')).at(-1);
  if(topDialog){for(const p of active)if(!topDialog.contains(p))active.delete(p);if(control&&!topDialog.contains(control))control=null;}
  layoutDirty=true;
 }
 function measure(){
  layoutDirty=false;
  const visible:Array<[HTMLElement,Geometry]>=[];
  for(const panel of [...controls,...candidates]){
   if(!panel.isConnected||(!controls.has(panel)&&!intersecting.has(panel)))continue;
   const rect=panel.getBoundingClientRect(),s=getComputedStyle(panel);
   if(rect.width<2||rect.height<2||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)<.01||rect.bottom<=0||rect.top>=innerHeight||rect.right<=0||rect.left>=innerWidth)continue;
   const scale=rect.width/Math.max(1,panel.offsetWidth),width=panel.clientWidth,height=panel.clientHeight,x=rect.left+panel.clientLeft*scale,y=rect.top+panel.clientTop*scale;
   const left=Math.max(0,-x/scale),top=Math.max(0,-y/scale),cropWidth=Math.min(width-left,(innerWidth-Math.max(0,x))/scale),cropHeight=Math.min(height-top,(innerHeight-Math.max(0,y))/scale);
   if(cropWidth<1||cropHeight<1)continue;
   visible.push([panel,{x,y,scale,width,height,left,top,cropWidth,cropHeight,radius:Math.max(0,(parseFloat(s.borderRadius)||0)-panel.clientLeft)}]);if(visible.length>=MAX_TARGETS)break;
  }
  const live=new Set(visible.map(([p])=>p));targets.forEach((t,p)=>{if(!live.has(p))release(p,t);});
  controls.forEach(p=>{if(!p.isConnected||(p!==control&&!targets.has(p)))controls.delete(p);});
  const area=visible.reduce((n,[,g])=>n+g.cropWidth*g.cropHeight*g.scale*g.scale,0);
  const densityBudget=Math.min(devicePixelRatio||1,1.5,Math.sqrt(BACKING_BUDGET/Math.max(1,area)));
  for(const [panel,g] of visible){
   const density=Math.min(densityBudget*g.scale,Math.sqrt(SCRATCH_BUDGET/(g.cropWidth*g.cropHeight)),2048/Math.max(g.cropWidth,g.cropHeight));
   let target=targets.get(panel);
   if(!target){
    const pane=document.createElement('canvas');pane.className='pm-acrylic-pane';pane.setAttribute('aria-hidden','true');pane.dataset.material='frosted';
    const ctx=pane.getContext('2d');if(!ctx)continue;
    const kind=controls.has(panel)?1:panel.matches(DOCUMENT)?3:panel.matches(INSET)?2:0;
    panel.prepend(pane);panel.classList.add('pm-material-host');if(kind===1){panel.classList.add('pm-material-control');if(getComputedStyle(panel).position==='static')panel.classList.add('pm-material-relative');}panel.dataset.surface=kind===1?'control':kind===3?'document':kind===2?'inset':'chrome';
    target={pane,ctx,g,density,dirty:true,hover:0,pointer:[-10000,-10000],paints:0,kind};targets.set(panel,target);
   }else{
    if(Math.abs(density-target.density)>.001||Object.keys(g).some(k=>Math.abs(g[k as keyof Geometry]-target!.g[k as keyof Geometry])>.1))target.dirty=true;
    target.g=g;target.density=density;
   }
   target.pane.style.cssText=`left:${g.left}px;top:${panel.scrollTop+g.top}px;width:${g.cropWidth}px;height:${g.cropHeight}px;`;
  }
  canvas.dataset.surfaces=String(targets.size);
 }
 function finishReveal(){
  motion=null;reveal=navigation?1:0;
  if(sidebar){sidebar.dataset.reveal=String(reveal);delete sidebar.dataset.fragmenting;if(navigation)sidebar.style.removeProperty('clip-path');else sidebar.style.clipPath='inset(0 100% 0 0)';sidebar.style.removeProperty('--pm-reveal-x');ownedStyle=sidebar.style.cssText;}
  layoutDirty=true;
 }
 function beginReveal(){
  const next=shell.dataset.navigation==='true';if(next===navigation)return;navigation=next;
  if(!sidebar||reduced.matches||lost){finishReveal();return;}
  motion={from:reveal,to:next?1:0,start:performance.now(),duration:280*Math.max(.32,Math.abs((next?1:0)-reveal))};
  sidebar.style.clipPath=fragmentClip(reveal,sidebar.offsetWidth,sidebar.offsetHeight);sidebar.style.setProperty('--pm-reveal-x',`${-9*(1-reveal)}px`);ownedStyle=sidebar.style.cssText;
  sidebar.dataset.fragmenting='true';intersecting.add(sidebar);layoutDirty=true;invalidate();
 }
 function render(now:number){
  frame=0;if(stopped||lost||document.hidden||!program)return;
  if(registryDirty)collect();
  if(motion&&sidebar){
   const t=Math.min(1,(now-motion.start)/motion.duration),ease=t*t*(3-2*t);
   reveal=motion.from+(motion.to-motion.from)*ease;sidebar.dataset.reveal=reveal.toFixed(5);
   sidebar.style.clipPath=fragmentClip(reveal,sidebar.offsetWidth,sidebar.offsetHeight);sidebar.style.setProperty('--pm-reveal-x',`${-9*(1-reveal)}px`);ownedStyle=sidebar.style.cssText;
   layoutDirty=true;const target=targets.get(sidebar);if(target)target.dirty=true;
   if(t>=1)finishReveal();
  }
  if(layoutDirty||now<movingUntil)measure();
  const delta=Math.min(110,Math.max(1,now-lastTime));lastTime=now;
  let animate=!!motion||now<movingUntil;
  for(const [panel,target] of targets){
   const desired=active.has(panel)||panel===control?1:0;
   if(Math.abs(target.hover-desired)>.01){target.hover=reduced.matches?desired:target.hover+(desired-target.hover)*(1-Math.exp(-delta/38));if(Math.abs(target.hover-desired)<=.01)target.hover=desired;target.dirty=true;animate ||= target.hover!==desired;}
   if(desired){const p:[number,number]=[(cursor[0]-target.g.x)/target.g.scale,(cursor[1]-target.g.y)/target.g.scale];if(Math.abs(p[0]-target.pointer[0])+Math.abs(p[1]-target.pointer[1])>.15){target.pointer=p;target.dirty=true;}}
   if(target.kind===1&&panel!==control&&target.hover===0){controls.delete(panel);release(panel,target);continue;}
   if(!target.dirty)continue;
   const g=target.g,d=target.density,w=Math.max(1,Math.floor(g.cropWidth*d)),h=Math.max(1,Math.floor(g.cropHeight*d));
   if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;
   context.viewport(0,0,w,h);context.clearColor(0,0,0,0);context.clear(context.COLOR_BUFFER_BIT);
   context.uniform2f(uniform('uSize'),g.width,g.height);context.uniform2f(uniform('uCrop'),g.left,g.top);context.uniform2f(uniform('uCropSize'),g.cropWidth,g.cropHeight);context.uniform2f(uniform('uBuffer'),w,h);context.uniform2f(uniform('uPointer'),...target.pointer);
   context.uniform1f(uniform('uDensity'),d);context.uniform1f(uniform('uRadius'),Math.min(g.radius,g.width/2,g.height/2));context.uniform1f(uniform('uHover'),target.hover);context.uniform1f(uniform('uKind'),target.kind);context.uniform1f(uniform('uReveal'),panel===sidebar?reveal:1);
   context.drawArrays(context.TRIANGLES,0,6);
   if(target.pane.width!==w)target.pane.width=w;if(target.pane.height!==h)target.pane.height=h;
   target.ctx.clearRect(0,0,w,h);target.ctx.drawImage(canvas,0,0);target.pane.dataset.paints=String(++target.paints);target.dirty=false;canvas.dataset.draws=String(++draws);
  }
  canvas.dataset.backingPixels=String(Array.from(targets.values()).reduce((n,t)=>n+t.pane.width*t.pane.height,0));
  if(animate)frame=requestAnimationFrame(render);
 }
 const internal=(n:Node)=>n===canvas||(n instanceof Element&&n.matches('.pm-acrylic-pane'));
 const strip=(s:string)=>s.replace(/\bpm-material-(?:host|control|relative)\b/g,'').trim();
 const changed=new MutationObserver(records=>{
  let registry=false,layout=false;
  for(const r of records){
   if(internal(r.target))continue;
   if(r.type==='attributes'){
    const el=r.target as HTMLElement;
    if(el===shell&&r.attributeName==='data-navigation'){beginReveal();continue;}
    if(el===sidebar&&r.attributeName==='style'&&el.style.cssText===ownedStyle)continue;
    if(r.attributeName==='class'&&strip(r.oldValue||'')===strip(el.className.toString()))continue;
    if(el===shell||el.matches(`${SURFACES},dialog`))layout=true;
   }else if([...r.addedNodes,...r.removedNodes].some(n=>!internal(n)&&n instanceof Element&&(n.matches(SURFACES)||n.querySelector(SURFACES))))registry=true;
  }
  registryDirty ||= registry;layoutDirty ||= layout;if(registry||layout)invalidate();
 });
 const aim=(element:Element|null,x:number,y:number)=>{
  active.clear();let p=element?.closest<HTMLElement>(SURFACES)||null;
  while(p){active.add(p);p=p.parentElement?.closest<HTMLElement>(SURFACES)||null;}
  const next=element?.closest<HTMLElement>('button:not(:disabled):not(.pm-mobile-scrim):not(.pm-workspace-scrim):not(.pm-brand-anchor)')||null;
  if(next!==control){control=next&&shell.contains(next)?next:null;if(control)controls.add(control);layoutDirty=true;}
  cursor=[x,y];invalidate();
 };
 const reconcile = () => {
   if (cursor[0] < 0 || cursor[1] < 0 || cursor[0] > innerWidth || cursor[1] > innerHeight) return;
   // New file selection can replace sidebar DOM without a new pointermove.
   const hovered = document.elementFromPoint(cursor[0], cursor[1]);
   aim(hovered, cursor[0], cursor[1]);
 };
 const pointer=(e:PointerEvent)=>{if(e.pointerType!=='touch')aim(e.target instanceof Element?e.target:null,e.clientX,e.clientY);};
 const focus=(e:FocusEvent)=>{const el=e.target as HTMLElement;if(el.matches(':focus-visible')){const r=el.getBoundingClientRect();aim(el,r.x+r.width/2,r.y+r.height/2);}};
 const leave=()=>{active.clear();control=null;invalidate();};
 const layout=()=>{layoutDirty=true;invalidate();};
 const moving=(e:Event)=>{if(e.target instanceof Element&&e.target.matches(`${SURFACES},.pm-dialog-layer`)){movingUntil=performance.now()+(reduced.matches?0:240);layout();}};
 const visibility=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;active.clear();control=null;finishReveal();}else{targets.forEach(t=>t.dirty=true);layout();}};
 const onLost=(e:Event)=>{e.preventDefault();lost=true;cancelAnimationFrame(frame);frame=0;finishReveal();fallback();};
 const restored=()=>{lost=false;program=null;buffer=null;uniforms.clear();try{initialize();targets.forEach(t=>{t.dirty=true;});registryDirty=true;layout();}catch{lost=true;fallback();}};
 try{initialize();}catch(error){if(buffer)context.deleteBuffer(buffer);if(program)context.deleteProgram(program);fallback();console.warn('Material indisponível.',error);return()=>{resized.disconnect();intersections.disconnect();delete shell.dataset.gl;};}
 changed.observe(shell,{childList:true,subtree:true,attributes:true,attributeOldValue:true,attributeFilter:['class','style','open','data-entered','data-visible','data-navigation']});
 shell.addEventListener('pentamark:pointer-reconcile',reconcile);
 shell.addEventListener('pointermove',pointer,{passive:true});shell.addEventListener('pointerleave',leave);shell.addEventListener('focusin',focus);
 shell.addEventListener('scroll',layout,true);shell.addEventListener('transitionrun',moving);shell.addEventListener('animationstart',moving);shell.addEventListener('transitionend',layout);
 window.addEventListener('resize',layout);window.addEventListener('blur',leave);document.addEventListener('visibilitychange',visibility);reduced.addEventListener('change',layout);
 canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',restored);invalidate();
 return()=>{
  stopped=true;cancelAnimationFrame(frame);changed.disconnect();resized.disconnect();intersections.disconnect();finishReveal();if(sidebar){delete sidebar.dataset.reveal;sidebar.style.removeProperty('clip-path');sidebar.style.removeProperty('--pm-reveal-x');}
  targets.forEach((t,p)=>release(p,t));
  shell.removeEventListener('pentamark:pointer-reconcile',reconcile);
  shell.removeEventListener('pointermove',pointer);shell.removeEventListener('pointerleave',leave);shell.removeEventListener('focusin',focus);shell.removeEventListener('scroll',layout,true);shell.removeEventListener('transitionrun',moving);shell.removeEventListener('animationstart',moving);shell.removeEventListener('transitionend',layout);
  window.removeEventListener('resize',layout);window.removeEventListener('blur',leave);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',layout);
  canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',restored);
  if(!lost){if(buffer)context.deleteBuffer(buffer);if(program)context.deleteProgram(program);}canvas.width=canvas.height=1;delete shell.dataset.gl;
 };
}
