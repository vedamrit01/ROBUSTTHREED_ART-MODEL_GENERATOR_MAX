import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {ImageMagick,MagickFormat,MagickReadSettings} from '@imagemagick/magick-wasm';
import Module from 'manifold-3d';
import {convertSvg} from '../lib/convert';
import {parseSvg} from '../lib/svg-geometry';
import {TRACE_DEFAULTS} from '../lib/image-settings';

// The upstream browser bundle retains a CommonJS-only Node bootstrap. Browser
// workers do not use it; these globals let the exact unmodified bundle run here.
Object.assign(globalThis,{require:createRequire(import.meta.url),__dirname:process.cwd()});
const {initImageTracing,traceImage}=await import('../lib/image-trace');
await initImageTracing(readFileSync(fileURLToPath(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm'))));
const api=await Module();api.setup();
const width=256,height=192,rgba=new Uint8Array(width*height*4).fill(255);
for(let y=24;y<168;y++)for(let x=24;x<232;x++){
  const leftHole=x>=48&&x<112&&y>=40&&y<136;
  const island=x>=72&&x<88&&y>=72&&y<104;
  const rightHole=(x-184)**2+(y-80)**2<20**2;
  if((!leftHole||island)&&!rightHole)for(let c=0;c<3;c++)rgba[(y*width+x)*4+c]=0;
}
const rawSettings=new MagickReadSettings({width,height,depth:8,format:MagickFormat.Rgba});
const encode=(format:MagickFormat,pixels=rgba)=>ImageMagick.read(pixels,rawSettings,image=>{image.quality=95;return image.write(format,data=>new Uint8Array(data));});
mkdirSync('.sites-runtime/image-tests',{recursive:true});
const png=encode(MagickFormat.Png);writeFileSync('.sites-runtime/image-tests/fixture.png',png);
const traced=await traceImage(png,{...TRACE_DEFAULTS,border:'original'});
assert.deepEqual(traced.originalDimensions,[width,height]);
assert.deepEqual(traced.workingDimensions,[2048,1536]);
assert.equal(traced.mode,'dark');
assert.ok(!/DOCTYPE|<image|<script|<style|stroke=/.test(traced.svg));
assert.match(traced.svg,/viewBox="0 0 2048 2048"/);
assert.ok(parseSvg(traced.svg).filter(shape=>!shape.white).reduce((sum,shape)=>sum+shape.contours.length,0)>=4,'Preserve nested cutouts and the interior island.');
const model=convertSvg(traced.svg,api);
assert.ok(Math.abs(model.dimensions[0]-97.5)<.15,'Preserve the 120 mm square page scale.');
assert.ok(Math.abs(model.dimensions[1]-67.5)<.15,'Pad landscape images; never stretch them square.');
assert.ok(Math.abs(model.dimensions[2]-2.2)<1e-6);
assert.equal(model.checks.connectedSolids,1);
const bold=await traceImage(png);
assert.ok(convertSvg(bold.svg,api).baseArea>model.baseArea,'Bold borders must change actual filled geometry, not a preview stroke.');
assert.deepEqual(new Uint8Array(convertSvg(traced.svg,api).stl),new Uint8Array(model.stl),'The downloadable traced SVG must reproduce the exact STL.');
writeFileSync('.sites-runtime/image-tests/fixture-traced.svg',traced.svg);

// HEIC is decode-only in the chosen runtime and uses a separate real-file check.
const formats=[MagickFormat.Jpeg,MagickFormat.WebP,MagickFormat.Gif,MagickFormat.Bmp,MagickFormat.Avif,MagickFormat.Tiff,MagickFormat.Ico,MagickFormat.Psd,MagickFormat.Tga,MagickFormat.Jxl,MagickFormat.Jp2,MagickFormat.Qoi,MagickFormat.Pnm];
const passed=['PNG'];
const failures:{format:string;error:string}[]=[];
for(const format of formats){
  try{
    const data=encode(format);
    writeFileSync('.sites-runtime/image-tests/fixture.'+format.toLowerCase(),data);
    const trace=await traceImage(data,{...TRACE_DEFAULTS,border:'original'},undefined,'fixture.'+format.toLowerCase());
    assert.deepEqual(trace.originalDimensions,[width,height],format+' must decode its actual dimensions.');
    assert.ok(parseSvg(trace.svg).filter(shape=>!shape.white).reduce((sum,shape)=>sum+shape.contours.length,0)>=4,format+' must retain cutouts.');
    passed.push(format);console.log('Decoded and traced '+format);
  }catch(error){const detail={format,error:error instanceof Error?error.message:String(error)};failures.push(detail);console.log(detail);}
}
assert.deepEqual(failures,[],'Every advertised format must really decode and trace.');

const blank=rgba.slice();blank.fill(255);
await assert.rejects(()=>traceImage(encode(MagickFormat.Png,blank)),/contrast|empty/);
await assert.rejects(()=>traceImage(new Uint8Array([1,2,3,4])),/encoding/);
await assert.rejects(()=>traceImage(new TextEncoder().encode('<svg></svg>')),/SVG input/);
const transparent=rgba.slice();
for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<24||x>=232||y<24||y>=168){const i=(y*width+x)*4;transparent[i]=0;transparent[i+1]=0;transparent[i+2]=0;transparent[i+3]=0;}
const alphaTrace=await traceImage(encode(MagickFormat.Png,transparent),{...TRACE_DEFAULTS,border:'original'});
assert.ok(Math.abs(convertSvg(alphaTrace.svg,api).dimensions[0]-model.dimensions[0])<.01,'Transparent black pixels must composite to white, not a black page.');
// A coloured illustration should become connected outlines without manual mode
// selection, while the source transparency and aspect ratio remain unchanged.
const coloured=rgba.slice();
for(let i=0;i<coloured.length;i+=4)if(coloured[i]===0){coloured[i]=215;coloured[i+1]=90;coloured[i+2]=50;}
const outline=await traceImage(encode(MagickFormat.Png,coloured));
assert.equal(outline.mode,'outline');
assert.equal(convertSvg(outline.svg,api).checks.connectedSolids,1);
console.log(JSON.stringify({passed:true,formats:passed,reference:{dimensions:model.dimensions,triangles:model.triangles,checks:model.checks}}));
