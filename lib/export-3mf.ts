import { Zip, ZipDeflate, strToU8 } from 'fflate';
import { LIMITS, PRESET } from './preset';

export type ExportMesh = { positions: Float32Array; indices: Uint32Array };
export type ThreeMfRequest = ExportMesh & { name: string };
export type ThreeMfMessage = { type: 'result'; bytes: Uint8Array } | { type: 'error'; error: string };

// The validated relief already has an exact horizontal material boundary.
// Close both parts by copying its top triangulation to that boundary. This
// preserves every exterior triangle without a Boolean, retrace or decimation.
export function separateLayers({ positions, indices }: ExportMesh) {
  const baseZ = Math.fround(PRESET.base), topZ = Math.fround(PRESET.total);
  if (!indices.length || indices.length % 3 || positions.length % 3 || indices.length / 3 > LIMITS.triangles)
    throw new Error('Choose a validated model within the five-million-triangle limit.');
  for (const v of positions) if (!Number.isFinite(v)) throw new Error('Invalid model coordinates.');
  let baseCount = 0, raisedCount = 0, topCount = 0;
  const kinds = new Uint8Array(indices.length / 3);
  for (let f = 0; f < kinds.length; f++) {
    const ids = indices.subarray(f * 3, f * 3 + 3);
    for (const id of ids) if (id >= positions.length / 3) throw new Error('Invalid model vertex.');
    const z = Array.from(ids, id => positions[id * 3 + 2]);
    if (z.some(v => v !== 0 && v !== baseZ && v !== topZ)) throw new Error('This model does not match the locked relief heights.');
    if (z.every(v => v === topZ)) { kinds[f] = 2; topCount++; raisedCount++; }
    else if (z.some(v => v > baseZ)) {
      if (z.some(v => v < baseZ)) throw new Error('A face crosses the material boundary.');
      kinds[f] = 1; raisedCount++;
    } else baseCount++;
  }
  if (!topCount || !baseCount) throw new Error('Both base and raised artwork are required.');
  const points = new Float32Array(positions.length * 2);
  points.set(positions);
  let vertexCount = positions.length / 3;
  const planeIds = new Map<string, number>();
  for (let id = 0; id < vertexCount; id++) if (positions[id * 3 + 2] === baseZ)
    planeIds.set(`${positions[id * 3]},${positions[id * 3 + 1]}`, id);
  const lowered = new Int32Array(vertexCount).fill(-1);
  const lower = (id: number) => {
    if (lowered[id] >= 0) return lowered[id];
    const x = positions[id * 3], y = positions[id * 3 + 1], key = `${x},${y}`;
    let target = planeIds.get(key);
    if (target === undefined) {
      target = vertexCount++; planeIds.set(key, target);
      points.set([x, y, baseZ], target * 3);
    }
    lowered[id] = target;
    return target;
  };
  const base = new Uint32Array((baseCount + topCount) * 3);
  const raised = new Uint32Array((raisedCount + topCount) * 3);
  let bi = 0, ri = 0;
  for (let f = 0; f < kinds.length; f++) {
    const a = indices[f * 3], b = indices[f * 3 + 1], c = indices[f * 3 + 2];
    if (kinds[f] === 0) { base.set([a, b, c], bi); bi += 3; }
    else { raised.set([a, b, c], ri); ri += 3; }
    if (kinds[f] === 2) {
      const x = lower(a), y = lower(b), z = lower(c);
      base.set([x, y, z], bi); bi += 3;
      raised.set([x, z, y], ri); ri += 3;
    }
  }
  return { positions: points.subarray(0, vertexCount * 3), base, raised };
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);

export function exportThreeMf(mesh: ThreeMfRequest): Uint8Array {
  const layers = separateLayers(mesh);
  const chunks: Uint8Array[] = [];
  let length = 0;
  const archive = new Zip((error, data) => {
    if (error) throw error;
    chunks.push(data); length += data.length;
  });
  const add = (name: string, text: string) => {
    const entry = new ZipDeflate(name, { level: 6 });
    archive.add(entry); entry.push(strToU8(text), true);
  };
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/></Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" Target="/3D/3dmodel.model"/></Relationships>');
  const model = new ZipDeflate('3D/3dmodel.model', { level: 6 });
  archive.add(model);
  // Stream XML in small blocks: five million triangles must not create one
  // enormous JavaScript string or an uncompressed archive in browser memory.
  let buffer = '';
  const write = (text: string) => {
    buffer += text;
    if (buffer.length >= 65536) { model.push(strToU8(buffer), false); buffer = ''; }
  };
  write('<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">ROBUSTTHREED</metadata><metadata name="Title">' + xml(mesh.name) + '</metadata><resources><basematerials id="1"><base name="White base" displaycolor="#FFFFFFFF"/><base name="Black raised artwork" displaycolor="#000000FF"/></basematerials>');
  const part = (id: number, name: string, indices: Uint32Array, material: number) => {
    const remap = new Int32Array(layers.positions.length / 3).fill(-1);
    let count = 0;
    for (const vertex of indices) if (remap[vertex] < 0) remap[vertex] = count++;
    const ordered = new Uint32Array(count);
    for (let i = 0; i < remap.length; i++) if (remap[i] >= 0) ordered[remap[i]] = i;
    write(`<object id="${id}" type="model" name="${name}" pid="1" pindex="${material}"><mesh><vertices>`);
    for (const i of ordered) write(`<vertex x="${layers.positions[i * 3]}" y="${layers.positions[i * 3 + 1]}" z="${layers.positions[i * 3 + 2]}"/>`);
    write('</vertices><triangles>');
    for (let i = 0; i < indices.length; i += 3) write(`<triangle v1="${remap[indices[i]]}" v2="${remap[indices[i + 1]]}" v3="${remap[indices[i + 2]]}"/>`);
    write('</triangles></mesh></object>');
  };
  part(2, 'White base - 1.6 mm', layers.base, 0);
  part(3, 'Black raised artwork - 0.6 mm', layers.raised, 1);
  write('<object id="4" type="model" name="' + xml(mesh.name) + '"><components><component objectid="2"/><component objectid="3"/></components></object></resources><build><item objectid="4"/></build></model>');
  model.push(strToU8(buffer), true);
  // Bambu's importer matches part IDs to component resource IDs (not triangle
  // ranges). Only filament assignments are included; no machine/process preset.
  add('Metadata/model_settings.config', `<?xml version="1.0" encoding="UTF-8"?><config><object id="4"><metadata key="name" value="${xml(mesh.name)}"/><metadata key="extruder" value="1"/><part id="2" subtype="normal_part"><metadata key="name" value="White base - 1.6 mm"/><metadata key="extruder" value="1"/></part><part id="3" subtype="normal_part"><metadata key="name" value="Black raised artwork - 0.6 mm"/><metadata key="extruder" value="2"/></part></object></config>`);
  add('Metadata/project_settings.config', JSON.stringify({ filament_colour: ['#FFFFFF', '#000000'] }));
  archive.end();
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
