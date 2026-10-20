type Point = {x:number;y:number};
export type EnergyMesh = {points:Point[];edges:[number,number][];path:string;cells?:number[][]};

/** Regular shared-edge hexagons, measured in screen pixels. */
export function createEnergyMesh(width=1600,height=1000):EnergyMesh {
  const radius=26,pitchY=Math.sqrt(3)*radius;
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
  for(let col=-1;col<=Math.ceil(width/(radius*1.5))+1;col++){
    for(let row=-1;row<=Math.ceil(height/pitchY)+1;row++){
      const x=col*radius*1.5,y=(row+(Math.abs(col)%2)*.5)*pitchY;
      addCell(Array.from({length:6},(_,i)=>({
        x:x+radius*Math.cos(i*Math.PI/3),y:y+radius*Math.sin(i*Math.PI/3),
      })));
    }
  }
  const path=edges.map(([a,b])=>`M${points[a].x.toFixed(1)} ${points[a].y.toFixed(1)}L${points[b].x.toFixed(1)} ${points[b].y.toFixed(1)}`).join('');
  return {points,edges,path,cells};
}

/** Damped spring wave adapted from Checkpoint's PanelEnergyField.
 * Velocity carries the released impulse outward; glow retains its afterimage.
 * The reference lattice is rigid: brightness, not clock-driven jitter, moves.
 */
export class EnergyNetwork {
  readonly values:Float32Array;
  readonly height:Float32Array;
  readonly velocity:Float32Array;
  private readonly force:Float32Array;
  private readonly springs:Float32Array;
  private accumulator=0;
  private age=0;
  active=false;
  constructor(readonly mesh:EnergyMesh){
    this.values=new Float32Array(mesh.points.length);
    this.height=new Float32Array(mesh.points.length);
    this.velocity=new Float32Array(mesh.points.length);
    this.force=new Float32Array(mesh.points.length);
    this.springs=Float32Array.from(mesh.edges,([a,b])=>{
      const p=mesh.points[a],q=mesh.points[b];
      const weight=.86+.14*(((Math.imul(a*197+b*73+11,1664525)+1013904223)>>>0)/4294967296);
      return Math.min(900,600*600*weight/Math.max(1,(p.x-q.x)**2+(p.y-q.y)**2));
    });
  }
  inject(x:number,y:number){
    if(!Number.isFinite(x)||!Number.isFinite(y))return;
    let nearest=0,distance=Infinity;
    this.mesh.points.forEach((p,i)=>{
      const d=(p.x-x)**2+(p.y-y)**2;
      if(d<distance){distance=d;nearest=i;}
    });
    this.velocity[nearest]=Math.min(28,this.velocity[nearest]+5);
    this.values[nearest]=Math.min(2.5,Math.abs(this.velocity[nearest])*.55);
    this.active=true;this.age=0;
  }
  step(dt:number){
    if(!this.active||!Number.isFinite(dt)||dt<=0)return;
    const h=1/120;
    this.accumulator=Math.min(this.accumulator+dt,h*8);
    const steps=Math.floor((this.accumulator+1e-10)/h);
    const decay=Math.exp(-4.4*h),afterglow=Math.exp(-3.6*h);
    for(let s=0;s<steps;s++){
      this.force.fill(0);
      for(let e=0;e<this.mesh.edges.length;e++){
        const [a,b]=this.mesh.edges[e],f=(this.height[b]-this.height[a])*this.springs[e];
        this.force[a]+=f;this.force[b]-=f;
      }
      let peak=0;
      for(let i=0;i<this.values.length;i++){
        this.velocity[i]=(this.velocity[i]+(this.force[i]-this.height[i]*12)*h)*decay;
        this.height[i]+=this.velocity[i]*h;
        this.values[i]=Math.max(this.values[i]*afterglow,Math.min(2.5,Math.abs(this.height[i])*18+Math.abs(this.velocity[i])*.55));
        peak=Math.max(peak,this.values[i]);
      }
      this.age+=h;
      if(this.age>3&&peak<.002){this.clear();return;}
    }
    this.accumulator=Math.max(0,this.accumulator-steps*h);
  }
  samplePositions(_seconds:number){return this.mesh.points;}
  clear(){this.values.fill(0);this.height.fill(0);this.velocity.fill(0);this.force.fill(0);this.accumulator=0;this.age=0;this.active=false;}
}
