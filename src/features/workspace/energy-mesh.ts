type Point = {x:number;y:number};
export type EnergyMesh = {points:Point[];edges:[number,number][];path:string};

/** Stable small cells; adjoining faces share one edge, never doubled strokes. */
export function createEnergyMesh():EnergyMesh {
  let seed=7419;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const columns=35,rows=23,pitch=48;
  const points=Array.from({length:(columns+1)*(rows+1)},(_,i)=>({
    x:(i%(columns+1))*pitch-40+(random()-.5)*22,
    y:Math.floor(i/(columns+1))*pitch-40+(random()-.5)*22,
  }));
  const edges:[number,number][]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){
    const a=y*(columns+1)+x;
    if(x<columns)edges.push([a,a+1]);
    if(y<rows)edges.push([a,a+columns+1]);
    if(x<columns&&y<rows&&random()<.72)
      edges.push(random()<.5?[a,a+columns+2]:[a+1,a+columns+1]);
  }
  const path=edges.map(([a,b])=>`M${points[a].x.toFixed(1)} ${points[a].y.toFixed(1)}L${points[b].x.toFixed(1)} ${points[b].y.toFixed(1)}`).join('');
  return {points,edges,path};
}

/** Diffusion along actual connections; no moving vertices or per-frame DOM work. */
export class EnergyNetwork {
  readonly values:Float32Array;
  private readonly delta:Float32Array;
  active=false;
  constructor(readonly mesh:EnergyMesh){
    this.values=new Float32Array(mesh.points.length);
    this.delta=new Float32Array(mesh.points.length);
  }
  inject(x:number,y:number){
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    let nearest=0,distance=Infinity;
    this.mesh.points.forEach((p,i)=>{
      const d=(p.x-x)**2+(p.y-y)**2;
      if(d<distance){distance=d;nearest=i;}
    });
    this.values[nearest]=Math.min(2,this.values[nearest]+1.4);
    this.active=true;
  }
  step(dt:number){
    if(!this.active||!Number.isFinite(dt)||dt<=0)return;
    const steps=Math.ceil(Math.min(dt,.1)/(1/60)),h=Math.min(dt,.1)/steps;
    for(let s=0;s<steps;s++){
      this.delta.fill(0);
      for(const [a,b] of this.mesh.edges){
        const flow=(this.values[b]-this.values[a])*h*5;
        this.delta[a]+=flow;this.delta[b]-=flow;
      }
      let peak=0;
      const decay=Math.exp(-h*2.8);
      for(let i=0;i<this.values.length;i++){
        this.values[i]=Math.max(0,(this.values[i]+this.delta[i])*decay);
        peak=Math.max(peak,this.values[i]);
      }
      if(peak<.002){this.clear();break;}
    }
  }
  clear(){this.values.fill(0);this.active=false;}
}
