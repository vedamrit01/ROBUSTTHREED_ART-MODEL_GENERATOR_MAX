import { strToU8, zlibSync } from 'fflate';
import type { ExportMesh } from './export-3mf';
import { PRESET } from './preset';

// A deterministic top view, rendered in the export worker without WebGL or
// screenshots. The thumbnail therefore works even if the preview is unavailable.
export function modelThumbnail({ positions, indices }: ExportMesh): Uint8Array {
  const size = 512, padding = 24;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]); maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]); maxY = Math.max(maxY, positions[i + 1]);
  }
  const scale = (size - 2 * padding) / Math.max(maxX - minX, maxY - minY);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Cannot create a thumbnail for an empty model.');
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const projected = new Float32Array(positions.length / 3 * 2);
  for (let i = 0; i < positions.length / 3; i++) {
    projected[i * 2] = size / 2 + (positions[i * 3] - cx) * scale;
    projected[i * 2 + 1] = size / 2 - (positions[i * 3 + 1] - cy) * scale;
  }
  const rgba = new Uint8Array(size * size * 4);
  const triangle = (a: number, b: number, c: number, colour: number) => {
    const xs = [projected[a * 2], projected[b * 2], projected[c * 2]];
    const ys = [projected[a * 2 + 1], projected[b * 2 + 1], projected[c * 2 + 1]];
    const start = Math.max(0, Math.ceil(Math.min(...ys) - .5));
    const end = Math.min(size - 1, Math.floor(Math.max(...ys) - .5));
    for (let row = start; row <= end; row++) {
      const y = row + .5;
      let left = Infinity, right = -Infinity;
      for (let edge = 0; edge < 3; edge++) {
        const next = (edge + 1) % 3;
        if ((ys[edge] <= y && y < ys[next]) || (ys[next] <= y && y < ys[edge])) {
          const x = xs[edge] + (y - ys[edge]) * (xs[next] - xs[edge]) / (ys[next] - ys[edge]);
          left = Math.min(left, x); right = Math.max(right, x);
        }
      }
      const first = Math.max(0, Math.ceil(left - .5)), last = Math.min(size - 1, Math.floor(right - .5));
      for (let column = first; column <= last; column++) {
        const offset = (row * size + column) * 4;
        rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = colour;
        rgba[offset + 3] = 255;
      }
    }
  };
  // The bottom surface describes the complete white silhouette. Paint the
  // raised top surface over it; vertical walls have zero area in this view.
  for (const [height, colour] of [[0, 255], [Math.fround(PRESET.total), 0]]) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i], b = indices[i + 1], c = indices[i + 2];
      if (positions[a * 3 + 2] === height && positions[b * 3 + 2] === height && positions[c * 3 + 2] === height)
        triangle(a, b, c, colour);
    }
  }
  const scanlines = new Uint8Array(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) scanlines.set(rgba.subarray(row * size * 4, (row + 1) * size * 4), row * (size * 4 + 1) + 1);
  const header = new Uint8Array(13), headerView = new DataView(header.buffer);
  headerView.setUint32(0, size); headerView.setUint32(4, size); header[8] = 8; header[9] = 6;
  const chunks = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', zlibSync(scanlines)), pngChunk('IEND', new Uint8Array())];
  const png = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) { png.set(chunk, offset); offset += chunk.length; }
  return png;
}

function pngChunk(type: string, bytes: Uint8Array) {
  const chunk = new Uint8Array(bytes.length + 12), view = new DataView(chunk.buffer);
  view.setUint32(0, bytes.length); chunk.set(strToU8(type), 4); chunk.set(bytes, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) {
    crc ^= chunk[i];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}
