import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import Module from 'manifold-3d';
import { convertSvg } from '../lib/convert';
import { parseSvg, PRESET } from '../lib/svg-geometry';
import { ganeshaReference } from './ganesha-reference';

const api=await Module();api.setup();
const svg=(content:string)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${content}</svg>`;
const ring=svg('<path fill-rule="evenodd" d="M10 10H110V110H10Z M30 30H90V90H30Z M50 50H70V70H50Z"/>');
const model=convertSvg(ring,api);
assert.deepEqual(model.dimensions.slice(0,2),[100,100]);
assert.ok(Math.abs(model.volume-(10000*1.6+6800*.6))<.01,'Nested islands must be preserved above a solid backing.');
assert.equal(new DataView(model.stl).getUint32(80,true),model.triangles);
assert.equal(model.stl.byteLength,84+50*model.triangles);
const source=readFileSync(new URL('../public/example.svg',import.meta.url),'utf8');
const sample=convertSvg(source,api);
const exact=ganeshaReference(source);
// Compare against the original cubic curves, not the older, coarser reference
// STL. Increasing fidelity legitimately changes its approximate area/volume.
for(let axis=0;axis<2;axis++)assert.ok(Math.abs(sample.dimensions[axis]-exact.dimensions[axis])<.00003,'Preserve analytic SVG bounds, including page margins.');
assert.ok(Math.abs(sample.dimensions[2]-2.2)<1e-6,'The manufacturing thickness must not change.');
assert.ok(Math.abs(sample.volume-exact.volume)<.003,'Volume must approach the original analytic SVG.');
assert.ok(Math.abs(sample.baseArea-exact.baseArea)<.002,'Silhouette area must approach the original curves.');
assert.ok(Math.abs(sample.artworkArea-exact.artworkArea)<.001,'Small artwork contours must be preserved.');
assert.deepEqual(new Uint8Array(convertSvg(source,api).stl),new Uint8Array(sample.stl),'The same SVG must export deterministically.');
const painted=convertSvg(svg('<rect x="10" y="10" width="100" height="100"/><rect fill="white" x="30" y="30" width="60" height="60"/><rect x="50" y="50" width="20" height="20"/>'),api);
assert.ok(Math.abs(painted.volume-model.volume)<.01,'White cutouts follow SVG paint order.');
const transformed=convertSvg(svg('<g transform="translate(10 10) scale(2)"><path d="M0 0h50v50h-50Z"/></g>'),api);
assert.deepEqual(transformed.dimensions.slice(0,2),[100,100]);
assert.ok(Math.abs(transformed.volume-22000)<.01);
const circleSource=svg('<circle cx="60" cy="60" r="40"/>'),circle=convertSvg(circleSource,api);
assert.ok(Math.abs(circle.artworkArea-Math.PI*1600)<.002,'Arc area must retain maximum precision.');
const circlePoints=parseSvg(circleSource)[0].contours[0];
for(let i=0;i<circlePoints.length;i++){
  const a=circlePoints[i],b=circlePoints[(i+1)%circlePoints.length];
  assert.ok(Math.abs(40-Math.hypot((a[0]+b[0])/2,(a[1]+b[1])/2))<=PRESET.tolerance,'Measure the actual arc chord error against an analytic circle.');
}
const openCutout=convertSvg(svg('<rect x="10" y="10" width="100" height="100"/><rect fill="white" x="60" y="60" width="60" height="60"/>'),api);
assert.ok(Math.abs(openCutout.volume-7500*2.2)<.01,'A cutout reaching the exterior changes the silhouette; it must not be filled as an internal recess.');
assert.throws(()=>parseSvg('<svg viewBox="0 0 100 200"><path d="M0 0H10V10Z"/></svg>'),/square/);
assert.throws(()=>parseSvg('<svg width="200" height="100" viewBox="0 0 100 100"><path d="M0 0H10V10Z"/></svg>'),/square/);
assert.throws(()=>parseSvg(svg('<path d="L10 10H20V20Z"/>')),/move command/);
assert.throws(()=>parseSvg(svg('<path stroke="black" d="M10 10H110V110Z"/>')),/strokes/);
assert.throws(()=>parseSvg(svg('<text>Hello</text>')),/text/);
assert.throws(()=>parseSvg('<!DOCTYPE svg [<!ENTITY x "bad">]>'+svg('')),/entities/);
assert.throws(()=>parseSvg(svg('<path fill="red" d="M10 10H110V110Z"/>')),/black filled/);
assert.throws(()=>convertSvg(svg('<rect x="10" y="10" width="10" height="10"/><rect x="40" y="40" width="10" height="10"/>'),api),/separate/);
assert.throws(()=>convertSvg(svg('<rect x="-10" y="10" width="100" height="100"/>'),api),/outside/);
// An optional destination saves the same reference bytes that passed every
// assertion, including the deterministic second conversion.
if(process.argv[2])writeFileSync(process.argv[2],Buffer.from(sample.stl));
console.log(JSON.stringify({passed:true,tolerance:PRESET.tolerance,reference:{dimensions:sample.dimensions,volume:sample.volume,baseArea:sample.baseArea,artworkArea:sample.artworkArea,triangles:sample.triangles,vertices:sample.vertices,checks:sample.checks},analytic:exact,exported:process.argv[2]},null,2));
