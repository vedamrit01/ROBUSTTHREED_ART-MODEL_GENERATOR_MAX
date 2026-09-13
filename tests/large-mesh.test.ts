import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import Module from 'manifold-3d';
import {convertSvg} from '../lib/convert';

// A solid backing with circular recesses exercises real curved geometry near
// the export ceiling. No duplicated faces or artificial subdivisions are used.
// Run each mode in a fresh process so WASM and mesh buffers are released.
const oversize=process.argv.includes('--oversize');
const side=oversize?42:41, radius=.53, holes:string[]=[];
for(let row=0;row<side;row++)for(let column=0;column<side;column++){
  const x=6+column*2.6,y=6+row*2.6;
  holes.push(`M${x-radius} ${y}a${radius} ${radius} 0 1 0 ${2*radius} 0a${radius} ${radius} 0 1 0 ${-2*radius} 0Z`);
}
const source=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><path fill-rule="evenodd" d="M4 4H116V116H4Z ${holes.join(' ')}"/></svg>`;
const api=await Module();api.setup();
const started=performance.now();
if(oversize){
  assert.throws(()=>convertSvg(source,api),/exceeds the five-million-triangle limit/);
  console.log(JSON.stringify({passed:true,case:'over-limit rejected',milliseconds:Math.round(performance.now()-started)}));
}else{
  const model=convertSvg(source,api,stage=>process.stderr.write(`${Math.round(performance.now()-started)} ms: ${stage}\n`));
  assert.ok(model.triangles>4_800_000 && model.triangles<=5_000_000,'Exercise an actual model near five million triangles.');
  assert.equal(new DataView(model.stl).getUint32(80,true),model.triangles);
  assert.equal(model.stl.byteLength,84+50*model.triangles);
  assert.deepEqual(model.dimensions.slice(0,2),[112,112]);
  assert.ok(Math.abs(model.dimensions[2]-2.2)<1e-6);
  const analyticVolume=112*112*2.2-side*side*Math.PI*radius*radius*.6;
  assert.ok(Math.abs(model.volume-analyticVolume)<.05,'Retain the analytically defined recesses and layer volume.');
  assert.deepEqual(model.checks,{watertight:true,connectedSolids:1,winding:true,dimensions:true});
  console.log(JSON.stringify({passed:true,case:'near-limit valid solid',triangles:model.triangles,vertices:model.vertices,stlBytes:model.stl.byteLength,dimensions:model.dimensions,volume:model.volume,analyticVolume,sha256:createHash('sha256').update(new Uint8Array(model.stl)).digest('hex'),milliseconds:Math.round(performance.now()-started),peakRssMb:Math.round(process.resourceUsage().maxRSS/1024),checks:model.checks}));
}
