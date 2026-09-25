import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { unzipSync, strFromU8 } from 'fflate';
import Module from 'manifold-3d';
import { convertSvg } from '../lib/convert';
import { exportThreeMf, separateLayers } from '../lib/export-3mf';

const api = await Module(); api.setup();
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">${body}</svg>`;
const sources = [
  svg('<rect x="10" y="10" width="100" height="100"/>'),
  svg('<path fill-rule="evenodd" d="M10 10H110V110H10Z M30 30H90V90H30Z M50 50H70V70H50Z"/>'),
  svg('<rect x="10" y="10" width="100" height="100"/><rect fill="white" x="60" y="60" width="60" height="60"/>'),
  svg('<circle cx="60" cy="60" r="40"/><circle fill="white" cx="60" cy="60" r="30"/>'),
];
for (const source of sources) {
  const original = convertSvg(source, api), originalBytes = new Uint8Array(original.stl).slice();
  const layers = separateLayers(original);
  for (const [indices, expected, low, high] of [
    [layers.base, original.baseArea * 1.6, 0, 1.6],
    [layers.raised, original.artworkArea * .6, 1.6, 2.2],
  ] as const) {
    const solid = new api.Manifold(new api.Mesh({ numProp: 3, vertProperties: layers.positions, triVerts: indices }));
    assert.equal(solid.status(), 'NoError', 'Each material must be a closed, consistently wound mesh.');
    assert.ok(Math.abs(solid.volume() - expected) < Math.max(.01, expected * 1e-5));
    const bounds = solid.boundingBox();
    assert.ok(Math.abs(bounds.min[2] - low) < 1e-6);
    assert.ok(Math.abs(bounds.max[2] - high) < 1e-6);
    solid.delete();
  }
  const bytes = exportThreeMf({ ...original, name: 'Artwork & "white/black" <test>' });
  const entries = unzipSync(bytes);
  assert.deepEqual(Object.keys(entries).sort(), ['3D/3dmodel.model', 'Metadata/model_settings.config', 'Metadata/project_settings.config', '[Content_Types].xml', '_rels/.rels'].sort());
  const parser = new DOMParser();
  const doc = parser.parseFromString(strFromU8(entries['3D/3dmodel.model']), 'application/xml');
  assert.equal(doc.documentElement!.getAttribute('unit'), 'millimeter');
  assert.equal(doc.getElementsByTagName('metadata')[1].textContent, 'Artwork & "white/black" <test>');
  assert.equal(doc.getElementsByTagName('item').length, 1, 'Import one assembled model, not independently placed pieces.');
  assert.equal(doc.getElementsByTagName('item')[0].getAttribute('objectid'), '4');
  assert.deepEqual(Array.from(doc.getElementsByTagName('component'), e => e.getAttribute('objectid')), ['2', '3']);
  assert.deepEqual(Array.from(doc.getElementsByTagName('base'), e => e.getAttribute('displaycolor')), ['#FFFFFFFF', '#000000FF']);
  for (const object of Array.from(doc.getElementsByTagName('object')).slice(0, 2)) {
    const points = Float32Array.from(Array.from(object.getElementsByTagName('vertex')).flatMap(e => ['x', 'y', 'z'].map(a => Number(e.getAttribute(a)))));
    const triangles = Uint32Array.from(Array.from(object.getElementsByTagName('triangle')).flatMap(e => ['v1', 'v2', 'v3'].map(a => Number(e.getAttribute(a)))));
    const solid = new api.Manifold(new api.Mesh({ numProp: 3, vertProperties: points, triVerts: triangles }));
    assert.equal(solid.status(), 'NoError', 'Serialized meshes remain valid after vertex remapping.');
    solid.delete();
  }
  const config = parser.parseFromString(strFromU8(entries['Metadata/model_settings.config']), 'application/xml');
  const parts = Array.from(config.getElementsByTagName('part'));
  assert.deepEqual(parts.map(p => [p.getAttribute('id'), Array.from(p.getElementsByTagName('metadata')).find(m => m.getAttribute('key') === 'extruder')!.getAttribute('value')]), [['2', '1'], ['3', '2']]);
  assert.deepEqual(JSON.parse(strFromU8(entries['Metadata/project_settings.config'])), { filament_colour: ['#FFFFFF', '#000000'] }, 'Do not embed printer or slicing presets.');
  assert.deepEqual(new Uint8Array(original.stl), originalBytes, 'STL output stays unchanged.');
}
const example = convertSvg(readFileSync(new URL('../public/example.svg', import.meta.url), 'utf8'), api);
const example3mf = exportThreeMf({ ...example, name: 'ROBUSTTHREED reference' });
if (process.argv[2]) writeFileSync(process.argv[2], example3mf);
console.log(JSON.stringify({ passed: true, fixtures: sources.length, exampleTriangles: example.triangles, example3mfBytes: example3mf.length }));
