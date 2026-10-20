type Point = {x:number;y:number};
export type EnergyMesh = {points:Point[];edges:[number,number][];path:string;cells?:number[][]};

/** Congruent symmetric pentagons in alternating rows, in screen pixels. */
export function createEnergyMesh(width=1600,height=1000):EnergyMesh {
  const pitch=48,wall=28,roof=14,band=2*wall+roof;
  const points:Point[]=[],edges:[number,number][]=[],cells:number[][]=[];
  const vertices=new Map<string,number>(),connections=new Set<string>();
  const addCell=(polygon:Point[])=>{
    const cell=polygon.map(p=>{
      const key=`${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      let index=vertices.get(key);
      if(index===undefined){index=points.length;vertices.set(key,index);points.push(p);}
      return index;
    });
    cells.push(cell);
    for(let i=0;i<cell.length;i++){
      const a=cell[i],b=cell[(i+1)%cell.length],key=a<b?`${a}:${b}`:`${b}:${a}`;
      if(a!==b&&!connections.has(key)){connections.add(key);edges.push([a,b]);}
    }
  };
  // A row and its half-pitch shifted reflection share the entire zigzag.
  // Consecutive bands share flat bases, without T-junctions or random vertices.
  for(let row=-1;row<=Math.ceil(height/band);row++){
    const y=row*band,shift=((row%2)+2)%2*pitch/2;
    for(let col=-2;col<=Math.ceil(width/pitch)+1;col++){
      const x=col*pitch+shift;
      addCell([{x,y},{x:x+pitch,y},{x:x+pitch,y:y+wall},
        {x:x+pitch/2,y:y+wall+roof},{x,y:y+wall}]);
      const dx=x+pitch/2,base=y+band;
      addCell([{x:dx,y:base},{x:dx+pitch,y:base},{x:dx+pitch,y:base-wall},
        {x:dx+pitch/2,y:base-wall-roof},{x:dx,y:base-wall}]);
    }
  }
  const path=edges.map(([a,b])=>`M${points[a].x.toFixed(1)} ${points[a].y.toFixed(1)}L${points[b].x.toFixed(1)} ${points[b].y.toFixed(1)}`).join('');
  return {points,edges,path,cells};
}

/** Diffusion along actual connections; no moving vertices or per-frame DOM work. */
export class EnergyNetwork {
  readonly values:Float32Array;
  private readonly delta:Float32Array;
  private readonly decayRates:Float32Array;
  private readonly attenuation:Float32Array;
  private readonly positions:Point[];
  active=false;
  constructor(readonly mesh:EnergyMesh){
    this.values=new Float32Array(mesh.points.length);
    this.delta=new Float32Array(mesh.points.length);
    this.decayRates=Float32Array.from(mesh.points,(_,i)=>3.3+((Math.imul(i+1,2654435761)>>>0)%1024)/1024*1.1);
    this.attenuation=new Float32Array(mesh.points.length);
    this.positions=mesh.points.map(p=>({...p}));
  }
  inject(x:number,y:number){
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    let nearest=0,distance=Infinity;
    this.mesh.points.forEach((p,i)=>{
      const d=(p.x-x)**2+(p.y-y)**2;
      if(d<distance){distance=d;nearest=i;}
    });
    this.values[nearest]=Math.min(2,this.values[nearest]+2);
    this.active=true;
  }
  step(dt:number){
    if(!this.active||!Number.isFinite(dt)||dt<=0)return;
    const steps=Math.ceil(Math.min(dt,.1)/(1/120)),h=Math.min(dt,.1)/steps;
    for(let i=0;i<this.attenuation.length;i++)this.attenuation[i]=Math.exp(-h*this.decayRates[i]);
    for(let s=0;s<steps;s++){
      this.delta.fill(0);
      for(const [a,b] of this.mesh.edges){
        const flow=(this.values[b]-this.values[a])*h*24;
        this.delta[a]+=flow;this.delta[b]-=flow;
      }
      let peak=0;
      for(let i=0;i<this.values.length;i++){
        this.values[i]=Math.max(0,(this.values[i]+this.delta[i])*this.attenuation[i]);
        peak=Math.max(peak,this.values[i]);
      }
      if(peak<.002){this.clear();break;}
    }
  }
  /** Shared vertices deform once, so neighboring faces never separate. */
  samplePositions(seconds:number){
    for(let i=0;i<this.positions.length;i++){
      const p=this.mesh.points[i],target=this.positions[i];
      const strength=Math.min(1,Math.sqrt(this.values[i]));
      const phase=seconds*28+i*2.399963;
      target.x=p.x+Math.sin(phase)*1.65*strength;
      target.y=p.y+Math.cos(phase*.83)*1.35*strength;
    }
    return this.positions;
  }
  clear(){this.values.fill(0);this.active=false;}
}
