import {build} from 'esbuild';
import assert from 'node:assert/strict';
const result=await build({entryPoints:['src/features/workspace/energy-mesh.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {createEnergyMesh,EnergyNetwork}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const mesh=createEnergyMesh(800,600);
assert.ok(mesh.cells.every(c=>c.length===6),'Use regular hexagons, not truncated house pentagons');
for(const cell of mesh.cells){
  const lengths=cell.map((a,i)=>{const p=mesh.points[a],q=mesh.points[cell[(i+1)%6]];return Math.hypot(p.x-q.x,p.y-q.y);});
  assert.ok(Math.max(...lengths)-Math.min(...lengths)<.001,'All six sides must have equal length');
}
const wave=new EnergyNetwork(mesh);
wave.inject(400,300);
assert.ok(wave.velocity?.some(v=>v>0),'Input excites velocity, not just a brightness blob');
const reach=()=>mesh.points.reduce((r,p,i)=>wave.values[i]>.025?Math.max(r,Math.hypot(p.x-400,p.y-300)):r,0);
for(let i=0;i<6;i++)wave.step(1/120);
const early=reach();
for(let i=0;i<42;i++)wave.step(1/120);
assert.ok(reach()>early+80,'A released pulse must advance beyond its initial footprint');
assert.ok(wave.height.some(h=>h<0),'A damped wave must rebound, unlike positive-only diffusion');
const rest=structuredClone(mesh.points);
assert.deepEqual(wave.samplePositions(1),rest,'Reference lattice stays sharp, without artificial jitter');
assert.deepEqual(wave.samplePositions(1.1),rest,'Clock alone cannot shake the lattice');
for(let i=0;i<1200;i++)wave.step(1/120);
assert.equal(wave.active,false,'Released wave must sleep after decay');
console.log('Checkpoint wave: regular hexagons, expanding wave, rebound, stable lattice and sleep passed');
