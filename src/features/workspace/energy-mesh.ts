// Seeded geometry: changing themes or editing never reshuffles the background.
type Point = { x:number; y:number };
export type EnergyCell = Point & { path:string; neighbors:number[] };
export function createEnergyMesh():EnergyCell[] {
  let seed=7419;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const columns=12,rows=8;
  const points=Array.from({length:(columns+1)*(rows+1)},(_,i)=>({
    x:(i%(columns+1))*150-100+(random()-.5)*96,
    y:Math.floor(i/(columns+1))*150-100+(random()-.5)*96,
  }));
  const cells:EnergyCell[]=[];
  const add=(vertices:Point[])=>cells.push({
    x:vertices.reduce((s,p)=>s+p.x,0)/vertices.length,
    y:vertices.reduce((s,p)=>s+p.y,0)/vertices.length,
    path:vertices.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')+'Z',
    neighbors:[],
  });
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const i=y*(columns+1)+x,a=points[i],b=points[i+1],c=points[i+columns+2],d=points[i+columns+1];
    if(random()<.55){add([a,b,c]);add([a,c,d]);}else add([a,b,c,d]);
  }
  // Local transport keeps the afterglow connected instead of spraying particles.
  cells.forEach((cell,i)=>{cell.neighbors=cells.flatMap((other,j)=>j!==i&&Math.hypot(cell.x-other.x,cell.y-other.y)<175?[j]:[]);});
  return cells;
}
