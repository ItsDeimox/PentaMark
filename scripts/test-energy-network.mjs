import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['src/features/workspace/energy-mesh.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createEnergyMesh,EnergyNetwork}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.equal(typeof EnergyNetwork,'function','A real edge-connected energy solver is required');
const mesh=createEnergyMesh();
assert.deepEqual(mesh,createEnergyMesh(),'Geometry must not reshuffle');
assert.ok(mesh.cells?.length>100,'Connected polygon cells are required, not a triangular grid');
assert.ok(mesh.cells.every(c=>c.length===5),'Every cell must be a true pentagon');
const edgeUses=new Map();
for(const cell of mesh.cells){
  const p=cell.map(i=>mesh.points[i]);
  const area=Math.abs(p.reduce((sum,a,i)=>{const b=p[(i+1)%5];return sum+a.x*b.y-a.y*b.x;},0))/2;
  assert.ok(Math.abs(area-1680)<.01,'Every repeated symmetric pentagon has the same area');
  cell.forEach((a,i)=>{const b=cell[(i+1)%5],key=a<b?`${a}:${b}`:`${b}:${a}`;edgeUses.set(key,(edgeUses.get(key)||0)+1);});
}
for(const [a,b] of mesh.edges){
  if([mesh.points[a],mesh.points[b]].every(p=>p.x>100&&p.y>100&&p.x<1400&&p.y<800)){
    assert.equal(edgeUses.get(a<b?`${a}:${b}`:`${b}:${a}`),2,'Interior edges must join exactly two pentagons');
  }
}
const contains=(cell,x,y)=>{
  let inside=false;
  for(let i=0,j=cell.length-1;i<cell.length;j=i++){
    const a=mesh.points[cell[i]],b=mesh.points[cell[j]];
    if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
};
for(let y=13.17;y<1000;y+=47)for(let x=11.23;x<1600;x+=43){
  assert.equal(mesh.cells.filter(c=>contains(c,x,y)).length,1,'Pentagons cover the viewport without gaps or overlap');
}
assert.ok(mesh.cells.filter(c=>c.length<4).length<mesh.cells.length*.05,'Avoid the old triangulation');
const large=createEnergyMesh(3200,2000);
assert.ok(large.cells.length>mesh.cells.length*2,'Larger displays add cells instead of enlarging the pattern');
assert.ok(mesh.edges.length>500);
for(const [a,b] of mesh.edges){
  const p=mesh.points[a],q=mesh.points[b];
  assert.ok(Math.hypot(p.x-q.x,p.y-q.y)<100,'Small cells, including diagonals');
}
// A hand-built chain plus a disconnected vertex detects distance-based diffusion.
const graph={points:[{x:0,y:0},{x:40,y:0},{x:80,y:0},{x:1,y:1}],edges:[[0,1],[1,2]],path:''};
const network=new EnergyNetwork(graph);
network.inject(0,0);
assert.ok(network.values[0]>0);
assert.equal(network.values[2],0);
const initial=JSON.stringify(graph);
for(let i=0;i<12;i++)network.step(1/60);
assert.ok(network.values[2]>0,'Energy must travel through actual connections');
assert.equal(network.values[3],0,'Nearby disconnected points must not glow');
assert.equal(JSON.stringify(graph),initial,'Simulation cannot move geometry');
for(let i=0;i<600;i++)network.step(1/60);
assert.equal(network.active,false,'No perpetual work after decay');
network.inject(40,0);network.clear();
assert.ok(network.values.every(v=>v===0));
assert.equal(network.active,false);
const spread=new EnergyNetwork(mesh);
spread.inject(800,500);
for(let i=0;i<12;i++)spread.step(1/60);
const outer=mesh.points.reduce((peak,p,i)=>Math.hypot(p.x-800,p.y-500)>100?Math.max(peak,spread.values[i]):peak,0);
assert.ok(outer>.01,'A single impulse must spread visibly beyond 100 screen pixels within 200 ms');
for(let i=0;i<180;i++)spread.step(1/60);
assert.equal(spread.active,false,'The wider impulse must still stop within three seconds');
assert.equal(typeof spread.samplePositions,'function','The visible mesh must deform under the pulse');
spread.inject(800,500);
const rest=JSON.stringify(mesh.points);
const displaced=spread.samplePositions(.1).map(p=>({...p}));
assert.ok(displaced.some((p,i)=>Math.hypot(p.x-mesh.points[i].x,p.y-mesh.points[i].y)>.1),'An active pulse must move real vertices');
assert.ok(displaced.every((p,i)=>Math.hypot(p.x-mesh.points[i].x,p.y-mesh.points[i].y)<=2.5),'Deformation must remain subtle');
assert.notDeepEqual(displaced,spread.samplePositions(.15),'The displacement must evolve smoothly through the pulse');
assert.equal(JSON.stringify(mesh.points),rest,'Rest geometry must remain available for exact recovery');
spread.clear();
assert.deepEqual(spread.samplePositions(.5),mesh.points,'Every vertex returns exactly to rest');
const independent=new EnergyNetwork({points:[{x:0,y:0},{x:40,y:0}],edges:[],path:''});
independent.inject(0,0);independent.inject(40,0);independent.step(.1);
assert.notEqual(independent.values[0],independent.values[1],'Different points must have staggered decay');
console.log('Energy graph: small stable cells, edge transport, disconnected isolation, decay and cleanup passed');
