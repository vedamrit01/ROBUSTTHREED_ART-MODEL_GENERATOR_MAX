import Module from 'manifold-3d';
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { convertSvg } from './convert';
import imageWasmUrl from '@imagemagick/magick-wasm/magick.wasm?url';
import type {ConversionRequest} from './worker-protocol';

let ready:ReturnType<typeof Module>|undefined;
self.onmessage=async(event:MessageEvent<ConversionRequest>)=>{
  const {id}=event.data;
  let source=event.data.source;
  if(event.data.image){
    let tracer;
    self.postMessage({id,type:'progress',stage:'Reading image'});
    try{
      tracer=await import('./image-trace');
      await tracer.initImageTracing(new URL(imageWasmUrl,self.location.href));
    }catch{self.postMessage({id,type:'error',errorKind:'engine',error:'The image converter could not load. Check your connection and try again.'});return;}
    try{
      const trace=await tracer.traceImage(new Uint8Array(await event.data.image.arrayBuffer()),event.data.settings,stage=>self.postMessage({id,type:'progress',stage}),event.data.name);
      source=trace.svg;
      // Keep this usable even if the resulting silhouette needs adjustment.
      self.postMessage({id,type:'traced',trace},{transfer:[trace.previewPng]});
    }catch(error){self.postMessage({id,type:'error',errorKind:'image',error:error instanceof Error?error.message:'This image could not be traced. Try clearer artwork.'});return;}
  }
  let api;
  try {
    ready??=Module({locateFile:()=>wasmUrl}).then(api=>{api.setup();return api;});
    api=await ready;
  } catch {
    ready=undefined;
    self.postMessage({id,type:'error',errorKind:'engine',error:'The converter could not load. Check your connection and try again.'});
    return;
  }
  try {
    if(typeof source!=='string')throw new Error('Choose SVG artwork or an image.');
    const result=convertSvg(source,api,stage=>self.postMessage({id,type:'progress',stage}));
    self.postMessage({id,type:'result',result},{transfer:[result.stl,result.positions.buffer,result.indices.buffer]});
  } catch(error) {self.postMessage({id,type:'error',errorKind:'input',error:error instanceof Error?error.message:'Conversion could not finish. Check the SVG and try again.'});}
};
