const NS='http://www.w3.org/2000/svg';
let sequence=0;
export type GlassLens={update:(width:number,height:number,radius:number)=>void;setScrolling:(active:boolean)=>void;dispose:()=>void};

/** Distorts the actual backdrop, not the panel's children. The blue map channel
 * masks a clear curved bevel over the frosted center. Separate sample distances
 * disperse existing light; a uniform backdrop therefore stays neutral. */
export function attachGlassLens(panel:HTMLElement):GlassLens|null {
  if(!CSS.supports('backdrop-filter','url("#pm-lens-probe")'))return null;
  const id=`pm-lens-${++sequence}`,svg=document.createElementNS(NS,'svg');
  svg.classList.add('pm-lens-defs');svg.setAttribute('aria-hidden','true');
  const element=(tag:string,attrs:Record<string,string>)=>{
    const node=document.createElementNS(NS,tag);
    Object.entries(attrs).forEach(([key,value])=>node.setAttribute(key,value));
    return node;
  };
  const filter=element('filter',{id,x:'0',y:'0',filterUnits:'userSpaceOnUse','color-interpolation-filters':'sRGB'});
  const map=element('feImage',{result:'map',x:'0',y:'0',width:'100%',height:'100%',preserveAspectRatio:'none'});
  filter.append(map,element('feGaussianBlur',{in:'SourceGraphic',stdDeviation:'.65',result:'source'}));
  for(const [channel,scale] of [['r','29'],['g','23'],['b','17']] as const){
    filter.append(element('feDisplacementMap',{in:'source',in2:'map',scale,xChannelSelector:'R',yChannelSelector:'G',result:`shift-${channel}`}));
    const mask=channel==='r'?'1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0':
      channel==='g'?'0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0':
      '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0';
    filter.append(element('feColorMatrix',{in:`shift-${channel}`,type:'matrix',values:mask,result:channel}));
  }
  filter.append(
    element('feComposite',{in:'r',in2:'g',operator:'arithmetic',k2:'1',k3:'1',result:'rg'}),
    element('feComposite',{in:'rg',in2:'b',operator:'arithmetic',k2:'1',k3:'1',result:'spectrum'}),
    element('feColorMatrix',{in:'map',type:'matrix',values:'0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 1 0 0',result:'edge'}),
    element('feComposite',{in:'spectrum',in2:'edge',operator:'in',result:'rim'}),
    element('feGaussianBlur',{in:'SourceGraphic',stdDeviation:'9',result:'frost'}),
    element('feComposite',{in:'frost',in2:'edge',operator:'out',result:'body'}),
    element('feComposite',{in:'rim',in2:'body',operator:'arithmetic',k2:'1',k3:'1'}),
  );
  svg.append(filter);panel.append(svg);
  const saved=['backdrop-filter','-webkit-backdrop-filter'].map(name=>({name,value:panel.style.getPropertyValue(name),priority:panel.style.getPropertyPriority(name)}));
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx){svg.remove();return null;}
  let previous='';
  let pending=0;
  let scrolling=false;
  const apply=()=>{
    for(const {name} of saved)panel.style.setProperty(name,scrolling?'blur(9px)':`url("#${id}")`,'important');
  };
  const rebuild=(width:number,height:number,radius:number)=>{
      const key=`${Math.round(width)}:${Math.round(height)}:${Math.round(radius)}`;if(previous===key)return;
      previous=key;
      // A smooth displacement field needs far fewer pixels than its backdrop.
      const density=Math.min(1,384/Math.max(width,height));
      canvas.width=Math.max(2,Math.ceil(width*density));canvas.height=Math.max(2,Math.ceil(height*density));
      const pixels=ctx.createImageData(canvas.width,canvas.height);
      const r=Math.max(0,Math.min(radius,width/2,height/2));
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
        const px=(x+.5)/canvas.width*width-width/2,py=(y+.5)/canvas.height*height-height/2;
        const qx=Math.abs(px)-width/2+r,qy=Math.abs(py)-height/2+r;
        const ax=Math.max(qx,0),ay=Math.max(qy,0),length=Math.hypot(ax,ay);
        const depth=Math.max(0,-(length+Math.min(Math.max(qx,qy),0)-r));
        const nx=(length?ax/length:qx>qy?1:0)*Math.sign(px);
        const ny=(length?ay/length:qy>=qx?1:0)*Math.sign(py);
        const slope=Math.exp(-(((depth-5)/12)**2))*.43;
        // A soft optical shoulder, not a flat rim with an abrupt inner cutoff.
        const edge=Math.exp(-((depth/22)**2));
        const i=(y*canvas.width+x)*4;
        pixels.data[i]=Math.round((.5-nx*slope)*255);
        pixels.data[i+1]=Math.round((.5-ny*slope)*255);
        pixels.data[i+2]=Math.round(edge*255);pixels.data[i+3]=255;
      }
      ctx.putImageData(pixels,0,0);map.setAttribute('href',canvas.toDataURL());
      apply();
  };
  return {
    setScrolling(active){
      if(scrolling===active)return;
      scrolling=active;apply();
    },
    update(width,height,radius){
      // Percentages resolve against the hidden SVG's zero-size viewport.
      // Stretch bounds immediately, even while map regeneration is debounced.
      for(const node of [filter,map]){
        if(node.getAttribute('width')!==String(width))node.setAttribute('width',String(width));
        if(node.getAttribute('height')!==String(height))node.setAttribute('height',String(height));
      }
      clearTimeout(pending);
      if(!previous)rebuild(width,height,radius);
      else if(previous!==`${Math.round(width)}:${Math.round(height)}:${Math.round(radius)}`){
        // Stretch the existing field while resizing; regenerate once settled.
        pending=window.setTimeout(()=>rebuild(width,height,radius),120);
      }
    },
    dispose(){
      clearTimeout(pending);
      svg.remove();
      for(const {name,value,priority} of saved){
        if(value)panel.style.setProperty(name,value,priority);else panel.style.removeProperty(name);
      }
      canvas.width=canvas.height=1;
    },
  };
}
