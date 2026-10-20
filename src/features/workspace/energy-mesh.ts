type Point = {x:number;y:number};
export type EnergyMesh = {points:Point[];edges:[number,number][];path:string;cells?:number[][]};

/** Seeded Voronoi cells, calculated only on resize. Coordinates are screen pixels. */
export function createEnergyMesh(width=1600,height=1000):EnergyMesh {
  let seed=7419;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const pitch=60,columns=Math.ceil(width/pitch)+4,rows=Math.ceil(height/pitch)+4;
  const sites=Array.from({length:columns*rows},(_,i)=>({
    x:(i%columns-1.5)*pitch+(random()-.5)*pitch*.85,
    y:(Math.floor(i/columns)-1.5)*pitch+(random()-.5)*pitch*.85,
  }));
  const points:Point[]=[],edges:[number,number][]=[],cells:number[][]=[];
  const vertices=new Map<string,number>(),connections=new Set<string>();
  for(let row=1;row<rows-1;row++)for(let col=1;col<columns-1;col++){
    const p=sites[row*columns+col];
    let polygon:Point[]=[{x:-80,y:-80},{x:width+80,y:-80},{x:width+80,y:height+80},{x:-80,y:height+80}];
    // Two rings suffice: jitter is less than half the lattice pitch.
    for(let y=Math.max(0,row-2);y<=Math.min(rows-1,row+2);y++)for(let x=Math.max(0,col-2);x<=Math.min(columns-1,col+2);x++){
      const q=sites[y*columns+x];if(q===p)continue;
      const nx=q.x-p.x,ny=q.y-p.y,limit=(q.x*q.x+q.y*q.y-p.x*p.x-p.y*p.y)/2;
      const clipped:Point[]=[];
      for(let i=0;i<polygon.length;i++){
        const a=polygon[i],b=polygon[(i+1)%polygon.length];
        const da=a.x*nx+a.y*ny-limit,db=b.x*nx+b.y*ny-limit;
        if(da<=0)clipped.push(a);
        if((da<=0)!==(db<=0)){
          const t=da/(da-db);clipped.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
        }
      }
      polygon=clipped;
    }
    if(polygon.length<3)continue;
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
  }
  const path=edges.map(([a,b])=>`M${points[a].x.toFixed(1)} ${points[a].y.toFixed(1)}L${points[b].x.toFixed(1)} ${points[b].y.toFixed(1)}`).join('');
  return {points,edges,path,cells};
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
