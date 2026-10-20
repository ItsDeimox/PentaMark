import {build} from 'esbuild';
import assert from 'node:assert/strict';
const bundle=await build({entryPoints:['src/features/workspace/energy-mesh.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createEnergyMesh,EnergyNetwork}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
assert.equal(typeof EnergyNetwork,'function','A real edge-connected energy solver is required');
const mesh=createEnergyMesh();
assert.deepEqual(mesh,createEnergyMesh(),'Geometry must not reshuffle');
assert.ok(mesh.cells?.length>100,'Connected polygon cells are required, not a triangular grid');
assert.ok(mesh.cells.filter(c=>c.length===5).length>mesh.cells.length*.15,'Irregular pentagons must be present throughout the mesh');
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
console.log('Energy graph: small stable cells, edge transport, disconnected isolation, decay and cleanup passed');
