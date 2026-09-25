// Exercise the production worker and its emitted WASM in a worker-like runtime.
// This is an integration test, not browser or WebGL UI testing.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { unzipSync, strFromU8 } from 'fflate';
import vm,{ runInNewContext,createContext,runInContext } from 'node:vm';

if(isMainThread) {
  const pages=process.argv.includes('--pages');
  const root=path.resolve(fileURLToPath(new URL(pages?'../dist-pages/':'../dist/client/',import.meta.url)));
  // Inspect the actual Worker constructor shipped to the page. Loading a worker
  // directly by its filename would miss invalid file:// URLs in the client code.
  const pageUrl=new URL(pages?'https://studio.example.test/ROBUSTTHREED_ART-MODEL_GENERATOR_MAX/':'https://studio.example.test/');
  const chunks=pages?'assets':'_next/static/chunks';
  const chunkDir=path.join(root,chunks), workerUrls=[], exportUrls=[];
  if(pages){
    const html=await readFile(path.join(root,'index.html'),'utf8');
    for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
      const asset=new URL(match[1],pageUrl);
      assert.ok(asset.pathname.startsWith(pageUrl.pathname),'Page assets must retain the repository URL prefix.');
      await readFile(path.join(root,asset.pathname.slice(pageUrl.pathname.length)));
    }
  }
  for(const chunk of await readdir(chunkDir)){
    if(!chunk.endsWith('.js'))continue;
    const code=await readFile(path.join(chunkDir,chunk),'utf8');
    const source=ts.createSourceFile(chunk,code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    function visit(node){
      if(ts.isNewExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='Worker'){
        assert.ok(node.arguments?.length,'Worker requires an entry URL.');
        // Auth libraries can ship a separate, runtime-configured heartbeat
        // Worker. Select the emitted conversion entry, whose static URL must
        // still be present exactly once and resolve under the repository path.
        const argumentText=node.arguments[0].getText(source);
        if(!argumentText.includes('conversion.worker-')&&!argumentText.includes('export-3mf.worker-'))return;
        const expression=node.arguments[0].getText(source).replace(/import\.meta\.url/g,JSON.stringify(new URL(chunks+'/'+chunk,pageUrl).href));
        const argument=runInNewContext(expression,{URL,location:pageUrl,window:{location:pageUrl}},{timeout:500});
        const url=new URL(String(argument),pageUrl);
        assert.equal(url.protocol,'https:','The published Worker constructor must not resolve to an internal file URL.');
        assert.equal(url.origin,pageUrl.origin,'The converter must load from the website origin.');
        assert.ok(url.pathname.startsWith(pageUrl.pathname),'The converter must retain the repository URL prefix.');
        (argumentText.includes('export-3mf.worker-')?exportUrls:workerUrls).push(url);
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  assert.equal(exportUrls.length,1,'Exactly one 3MF export worker must be emitted.');
  assert.equal(workerUrls.length,1,'Exactly one browser converter must be emitted.');
  const workerUrl=workerUrls[0],entry=path.basename(workerUrl.pathname);
  assert.match(entry,/^conversion\.worker-.*\.js$/);
  const worker=new Worker(new URL(import.meta.url),{execArgv:['--experimental-vm-modules'],workerData:{root,url:workerUrl.href,basePath:pageUrl.pathname,origin:pageUrl.origin}});
  const run=request=>new Promise((resolve,reject)=>{
    let trace;const stages=[];
    const cleanup=()=>{clearTimeout(timer);worker.off('error',onError);worker.off('message',onMessage);};
    const onError=error=>{cleanup();reject(error);};
    const onMessage=message=>{
      if(message.id!==request.id)return;
      if(message.type==='progress'){stages.push(message.stage);return;}
      if(message.type==='traced'){assert.ok(!trace,'Exactly one trace per image.');trace=message.trace;return;}
      cleanup();
      message.type==='error'?reject(new Error(message.error)):resolve({result:message.result,trace,stages});
    };
    const timer=setTimeout(()=>onError(new Error('Production worker timed out.')),180000);
    worker.on('error',onError);worker.on('message',onMessage);worker.postMessage(request);
  });
  try {
    const {result,trace:svgTrace}=await run({id:'reference',source:await readFile(new URL('../public/example.svg',import.meta.url),'utf8')});
    assert.equal(svgTrace,undefined,'SVG inputs must bypass image processing.');
    assert.ok(result.stl instanceof ArrayBuffer && result.stl.byteLength>1000000);
    assert.equal(new DataView(result.stl).getUint32(80,true),result.triangles);
    assert.ok(result.positions instanceof Float32Array && result.indices instanceof Uint32Array);
    // Original cubic curves integrated independently in ganesha-reference.ts.
    assert.ok(Math.abs(result.volume-9972.554113746119)<.003);
    assert.equal(result.checks.connectedSolids,1);
    // Asymmetric 256 × 192 stencil: two holes and a nested black island. This
    // fixture is generated by image-pipeline.test.ts; keeping its bytes here
    // allows the packaged test to run independently from development tracing.
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAQAAAADAAQAAAADDloDLAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAACYktHRAAB3YoTpAAAAAd0SU1FB+oJCw04HKpcBNMAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDktMTFUMTM6NTY6MjgrMDA6MDCkpuPaAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA5LTExVDEzOjU2OjI4KzAwOjAw1ftbZgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wOS0xMVQxMzo1NjoyOCswMDowMILuerkAAACmSURBVFjD7djNCYAwDAXgiAfHcBRH09EcxREcQHxSEI0QE39AkL6ccvhuTV5pBUEJAUGeQE6LIFOwjQcBwV9BMwcA6FxQAoMLKmB0QQ1MLmiA2QXt2j4Hqe0cUKS2vw1kz5IygeENqBIYCX4B3h93OFEhsKdaA3MvbgFzNzUwt1sDMx80MBNGAzOjDsBKOZEgJz8AvJIICAj4ziIgILgO+C9HQHCsBecesg6p4aOoAAAAAElFTkSuQmCC','base64');
    // Exercise image Blob decoding, lazy WASM loading and the trace transfer.
    const image=await run({id:'image',name:'stencil.png',image:new Blob([png],{type:'image/png'}),settings:{mode:'auto',border:'bold',smoothing:'smooth',threshold:null}});
    assert.ok(image.trace.previewPng instanceof ArrayBuffer&&image.trace.previewPng.byteLength>100);
    assert.deepEqual(image.trace.originalDimensions,[256,192]);
    assert.match(image.trace.svg,/viewBox="0 0 2048 2048"/);
    assert.ok(image.stages.includes('Tracing smooth curves')&&image.stages.includes('Checking mesh'));
    assert.ok(Math.abs(image.result.dimensions[0]-97.62)<.2);
    assert.ok(Math.abs(image.result.dimensions[1]-67.62)<.2);
    assert.ok(Math.abs(image.result.dimensions[2]-2.2)<1e-6);
    assert.equal(image.result.checks.connectedSolids,1);
    const roundtrip=await run({id:'traced-svg',source:image.trace.svg});
    assert.deepEqual(new Uint8Array(roundtrip.result.stl),new Uint8Array(image.result.stl),'The downloadable SVG and image must produce identical STLs.');
    const exporter=new Worker(new URL(import.meta.url),{execArgv:['--experimental-vm-modules'],workerData:{root,url:exportUrls[0].href,basePath:pageUrl.pathname,origin:pageUrl.origin}});
    try {
      const exported=await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject(new Error('3MF worker timed out')),60000);
        exporter.once('error',error=>{clearTimeout(timeout);reject(error);});
        exporter.once('message',message=>{clearTimeout(timeout);message.type==='error'?reject(new Error(message.error)):resolve(message);});
        exporter.postMessage({name:'Image stencil',positions:image.result.positions,indices:image.result.indices});
      });
      assert.ok(exported.bytes instanceof Uint8Array);
      const entries=unzipSync(exported.bytes);
      assert.match(strFromU8(entries['3D/3dmodel.model']),/White base - 1.6 mm/);
      assert.match(strFromU8(entries['Metadata/model_settings.config']),/key="extruder" value="2"/);
      assert.deepEqual(JSON.parse(strFromU8(entries['Metadata/project_settings.config'])).filament_colour,['#FFFFFF','#000000']);
      assert.ok(image.result.positions.byteLength>0,'3MF export must not detach the existing preview.');
    } finally {await exporter.terminate();}
    console.log(JSON.stringify({passed:true,hosting:pages?'GitHub Pages':'Sites',pagePath:pageUrl.pathname,packagedWorker:entry,svg:{dimensions:result.dimensions,triangles:result.triangles,stlBytes:result.stl.byteLength},image:{dimensions:image.result.dimensions,triangles:image.result.triangles,traceBytes:image.trace.svg.length},exactSvgRoundtrip:true,coloured3mf:true}));
  } finally {await worker.terminate();}
} else {
  const {SourceTextModule}=vm;
  const assetPath=input=>{
    const url=new URL(String(input),workerData.url);
    assert.ok(url.origin===workerData.origin&&url.pathname.startsWith(workerData.basePath),'Asset requests must stay on the same HTTPS site and repository path.');
    const filename=path.resolve(workerData.root,url.pathname.slice(workerData.basePath.length));
    if(!filename.startsWith(workerData.root+path.sep))throw new Error('Asset path escaped the public output.');
    return filename;
  };
  // Use actual browser import.meta URLs. Native Node file:// module URLs would
  // incorrectly select Emscripten's file/XHR loader instead of its fetch path.
  const context=createContext({console,URL,Response,Request,Headers,Blob,TextEncoder,TextDecoder,WebAssembly,performance,crypto:globalThis.crypto,atob,btoa,setTimeout,clearTimeout,
    location:{href:workerData.url},WorkerGlobalScope:function WorkerGlobalScope(){},
    fetch:async input=>{const url=new URL(String(input),workerData.url);return new Response(await readFile(assetPath(url)),{headers:{'Content-Type':url.pathname.endsWith('.wasm')?'application/wasm':'text/javascript'}});},
    postMessage:(message,options)=>parentPort.postMessage(message,options?.transfer)
  });
  runInContext('self=globalThis',context);
  const modules=new Map();
  async function load(url){
    if(modules.has(url.href))return modules.get(url.href);
    const code=await readFile(assetPath(url),'utf8');
    const module=new SourceTextModule(code,{context,identifier:url.href,initializeImportMeta:meta=>{meta.url=url.href;},importModuleDynamically:async(specifier,parent)=>{
      const imported=await load(new URL(specifier,parent.identifier));
      if(imported.status==='unlinked')await imported.link(linker);
      if(imported.status!=='evaluated')await imported.evaluate();
      return imported;
    }});
    modules.set(url.href,module);return module;
  }
  const linker=(specifier,parent)=>load(new URL(specifier,parent.identifier));
  const entry=await load(new URL(workerData.url));await entry.link(linker);await entry.evaluate();
  parentPort.on('message',data=>context.onmessage({data}));
}
