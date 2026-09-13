'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Upload, LockKeyhole, Check, ArrowDownToLine, Archive, FileCode2, X, RotateCcw, Layers3, ShieldCheck, ChevronDown, ArrowUpRight, LoaderCircle, CircleAlert, MousePointer2, CheckCheck, Plus, Image as ImageIcon } from 'lucide-react';
import { zipSync } from 'fflate';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { ConversionResult, Stage } from '@/lib/convert';
import { PRESET, LIMITS, CONVERSION_TIMEOUTS } from '@/lib/preset';
import {IMAGE_ACCEPT,INPUT_LIMITS,artworkName,checkFile,type InputKind} from '@/lib/artwork-input';
import {TRACE_DEFAULTS,type ImageTrace,type TraceSettings} from '@/lib/image-settings';
import type {ConversionMessage,ConversionRequest,FailureKind,WorkStage} from '@/lib/worker-protocol';
import {ArtworkPreview,ImageTracingControls} from './image-tracing';
import ConversionWorker from '../lib/conversion.worker?worker';

const ModelViewer=lazy(()=>import('./model-viewer'));
type Job={id:string;name:string;kind:InputKind;source?:string;image?:Blob;settings:TraceSettings;trace?:ImageTrace;example:boolean;status:'queued'|'working'|'ready'|'error';stage?:WorkStage;result?:ConversionResult;error?:string;errorKind?:FailureKind};
type SourceFile={name:string;source:string;image?:never}|{name:string;image:Blob;source?:never};
type Outcome={id:string;filename:string;kind:InputKind;status:string;dimensions?:number[];tracedSvgReady?:boolean;error?:string};
const stages:Stage[]=['Reading vector paths','Creating silhouette','Building relief','Checking mesh'];
const cleanName=artworkName;
const imageStages:WorkStage[]=['Reading image','Preparing bold borders','Tracing smooth curves',...stages];
const formatted=(n:number)=>n.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
const outcome=(j:Job):Outcome=>({id:j.id,filename:j.name,kind:j.kind,status:j.status,dimensions:j.result?.dimensions,tracedSvgReady:!!j.trace,error:j.error});
function download(data:ArrayBuffer|Uint8Array,name:string,type:string) {
  const bytes=data instanceof Uint8Array?new Uint8Array(data):data;
  const url=URL.createObjectURL(new Blob([bytes],{type})),link=document.createElement('a');
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}

export default function Studio() {
  const [jobs,setJobs]=useState<Job[]>([]),jobsRef=useRef<Job[]>([]);
  const [selectedId,setSelectedId]=useState(''),[notice,setNotice]=useState(''),[dragging,setDragging]=useState(false),[view,setView]=useState<'3d'|'top'|'svg'|'source'>('3d'),[resetKey,setResetKey]=useState(0),[exampleLoading,setExampleLoading]=useState(false),[zipping,setZipping]=useState(false);
  const input=useRef<HTMLInputElement>(null),svgInput=useRef<HTMLInputElement>(null),imageInput=useRef<HTMLInputElement>(null),worker=useRef<Worker|null>(null),busy=useRef<string|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),mounted=useRef(false),exampleRequest=useRef(0),pumpRef=useRef<()=>void>(()=>{});
  const resolvers=useRef(new Map<string,(result:Outcome)=>void>());
  const update=useCallback((mutate:(current:Job[])=>Job[])=>{const next=mutate(jobsRef.current);jobsRef.current=next;if(mounted.current)setJobs(next);},[]);
  const finish=useCallback((id:string,result?:ConversionResult,error?:string,errorKind:FailureKind='input')=>{
    if(busy.current!==id)return;
    if(timer.current)clearTimeout(timer.current);
    busy.current=null;
    let completed:Job|undefined;
    update(current=>current.map(j=>j.id===id?(completed={...j,status:result?'ready':'error',result,error,errorKind:result?undefined:errorKind}):j));
    if(completed){resolvers.current.get(id)?.(outcome(completed));resolvers.current.delete(id);}
    queueMicrotask(()=>pumpRef.current());
  },[update]);
  const stopWorker=useCallback(()=>{worker.current?.terminate();worker.current=null;if(timer.current)clearTimeout(timer.current);},[]);
  pumpRef.current=()=>{
    if(!mounted.current || busy.current)return;
    const job=jobsRef.current.find(j=>j.status==='queued');if(!job)return;
    busy.current=job.id;update(current=>current.map(j=>j.id===job.id?{...j,status:'working',stage:job.kind==='image'?imageStages[0]:stages[0]}:j));
    try {
      if(!worker.current){
        worker.current=new ConversionWorker();
        worker.current.onmessage=(event:MessageEvent<ConversionMessage>)=>{
          const message=event.data;if(message.id!==busy.current)return;
          if(message.type==='progress')update(current=>current.map(j=>j.id===message.id?{...j,stage:message.stage}:j));
          else if(message.type==='traced')update(current=>current.map(j=>j.id===message.id?{...j,trace:message.trace,source:message.trace.svg}:j));
          else if(message.type==='result')finish(message.id,message.result);
          else finish(message.id,undefined,message.error||'Conversion could not finish. Try a plain SVG.',message.errorKind);
        };
        worker.current.onerror=()=>{const id=busy.current;stopWorker();if(id)finish(id,undefined,'The converter could not load or was interrupted. Try again; if it repeats, reload the studio.','engine');};
      }
      timer.current=setTimeout(()=>{stopWorker();finish(job.id,undefined,job.kind==='image'?'This image took too long to convert. Try a simpler background or resize it to 4,096 pixels.':'This file took too long to convert. Simplify unnecessary objects in your vector editor and try again.','timeout');},CONVERSION_TIMEOUTS[job.kind]);
      const request:ConversionRequest=job.image?{id:job.id,image:job.image,name:job.name,settings:job.settings}:{id:job.id,source:job.source||''};
      worker.current.postMessage(request);
    }catch{stopWorker();finish(job.id,undefined,'The converter could not start. Reload the studio and try again.','engine');}
  };
  const enqueue=useCallback((files:SourceFile[],example=false):{ids:string[];completed:Promise<Outcome[]>}=>{
    if(!files.length||files.length>INPUT_LIMITS.files)throw new Error('Choose 1 to 20 SVGs or images.');
    for(const file of files)checkFile(file.name,file.image?file.image.size:new TextEncoder().encode(file.source).length,file.image?file.image.type:'image/svg+xml');
    const existing=example?jobsRef.current:jobsRef.current.filter(j=>!j.example);
    if(existing.length+files.length>20)throw new Error('The studio holds up to 20 artworks. Remove some files before adding more.');
    if(!example){exampleRequest.current++;setExampleLoading(false);for(const job of jobsRef.current.filter(j=>j.example)){if(job.id===busy.current){stopWorker();busy.current=null;}resolvers.current.get(job.id)?.({id:job.id,filename:job.name,kind:job.kind,status:'cancelled'});resolvers.current.delete(job.id);}}
    const added:Job[]=files.map(f=>({id:crypto.randomUUID(),name:f.name,kind:f.image?'image':'svg',source:f.source,image:f.image,settings:{...TRACE_DEFAULTS},example,status:'queued'}));
    const completed=Promise.all(added.map(j=>new Promise<Outcome>(resolve=>resolvers.current.set(j.id,resolve))));
    update(()=>[...existing,...added]);setSelectedId(added[0].id);setView('3d');setNotice('');pumpRef.current();
    return {ids:added.map(j=>j.id),completed};
  },[stopWorker,update]);
  const loadExample=useCallback(async(automatic=false)=>{
    const request=++exampleRequest.current;
    setExampleLoading(true);setNotice('');
    try{const response=await fetch(new URL('example.svg',document.baseURI));if(!response.ok)throw new Error('The example could not load. Upload your SVG to get started.');const source=await response.text();if(mounted.current&&request===exampleRequest.current&&(!automatic||!jobsRef.current.length)&&!jobsRef.current.some(j=>j.example))enqueue([{name:'01-ganesha-walking.svg',source}],true);}
    catch(error){if(mounted.current&&request===exampleRequest.current)setNotice(error instanceof Error?error.message:'The example could not load.');}
    finally{if(mounted.current&&request===exampleRequest.current)setExampleLoading(false);}
  },[enqueue]);
  useEffect(()=>{
    mounted.current=true;void loadExample(true);
    return()=>{mounted.current=false;exampleRequest.current++;stopWorker();busy.current=null;for(const [id,resolve]of resolvers.current)resolve({id,filename:'',kind:'svg',status:'cancelled'});resolvers.current.clear();};
  },[loadExample,stopWorker]);
  async function addFiles(files:File[]) {
    setDragging(false);
    try{
      if(!files.length)return;
      if(files.length>INPUT_LIMITS.files)throw new Error('Choose up to 20 artworks at a time.');
      const kinds=files.map(file=>checkFile(file.name,file.size,file.type));
      const sources:SourceFile[]=await Promise.all(files.map(async(file,i)=>kinds[i]==='svg'?{name:file.name,source:await file.text()}:{name:file.name,image:file}));enqueue(sources);
    }catch(error){setNotice(error instanceof Error?error.message:'A file could not be read. Try uploading it again.');}
    finally{for(const control of [input.current,svgInput.current,imageInput.current])if(control)control.value='';}
  }
  const remove=useCallback((id:string)=>{
    if(busy.current===id){stopWorker();busy.current=null;}
    resolvers.current.get(id)?.({id,filename:jobsRef.current.find(j=>j.id===id)?.name||'',kind:jobsRef.current.find(j=>j.id===id)?.kind||'svg',status:'cancelled'});resolvers.current.delete(id);
    update(current=>current.filter(j=>j.id!==id));setSelectedId(current=>current===id?(jobsRef.current[0]?.id||''):current);pumpRef.current();
  },[stopWorker,update]);
  const retry=(id:string,settings?:TraceSettings)=>{update(current=>current.map(j=>j.id===id?{...j,status:'queued',settings:settings??j.settings,error:undefined,errorKind:undefined,result:undefined,trace:undefined}:j));pumpRef.current();};
  const downloadSvg=useCallback((id:string)=>{const job=jobsRef.current.find(j=>j.id===id);if(!job?.trace)throw new Error('Wait for the image trace to finish.');download(new TextEncoder().encode(job.trace.svg),cleanName(job.name)+'-traced.svg','image/svg+xml');return outcome(job);},[]);
  const downloadModel=useCallback((id:string)=>{const job=jobsRef.current.find(j=>j.id===id);if(!job?.result||job.status!=='ready')throw new Error('Select a model that has passed validation.');download(job.result.stl,cleanName(job.name)+'.stl','model/stl');return outcome(job);},[]);
  async function downloadBatch(){
    setZipping(true);
    try {
      await new Promise(resolve=>setTimeout(resolve,30));
      const files:Record<string,Uint8Array>={};
      for(const job of jobsRef.current.filter(j=>j.status==='ready'&&j.result)){const base=cleanName(job.name);let name=base+'.stl',n=2;while(files[name])name=base+'-'+(n++)+'.stl';files[name]=new Uint8Array(job.result!.stl);}
      if(!Object.keys(files).length)throw new Error('There are no validated models to download yet.');
      download(zipSync(files,{level:0}),'robustthreed-stl-models.zip','application/zip');
    }catch(error){setNotice(error instanceof Error?error.message:'The ZIP could not be created. Download each STL individually.');}finally{setZipping(false);}
  }

  // Agent actions use the same conversion queue and export checks as the interface.
  useEffect(()=>{
    type Tool={name:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean;untrustedContentHint:boolean};execute:(input:unknown)=>unknown|Promise<unknown>};
    const context=(document as Document&{modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
    if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Expected an input object.');return value as Record<string,unknown>;};
    const registry:Tool[]=[
      {name:'get_studio_state',description:'Read the current artwork queue, image tracing outcomes and locked millimeter preset.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({preset:{artboard:[PRESET.artboard,PRESET.artboard],base:PRESET.base,raised:PRESET.relief,raisedBottom:PRESET.base,total:PRESET.total,quality:PRESET.quality,curveTolerance:PRESET.tolerance},imageTracing:TRACE_DEFAULTS,files:jobsRef.current.map(outcome)})},
      {name:'convert_svgs',description:'Add SVG source strings to the visible queue and wait for each conversion to succeed or fail. Replaces the starter example. Does not download files.',inputSchema:{type:'object',properties:{files:{type:'array',minItems:1,maxItems:20,items:{type:'object',properties:{name:{type:'string'},source:{type:'string'}},required:['name','source'],additionalProperties:false}}},required:['files'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async(input)=>{const value=object(input);if(!Array.isArray(value.files)||!value.files.length||value.files.length>20)throw new Error('Provide 1 to 20 SVG files.');const files=value.files.map(item=>{const f=object(item);if(typeof f.name!=='string'||typeof f.source!=='string')throw new Error('Each file requires a name and SVG source.');return {name:f.name,source:f.source};});return {files:await enqueue(files).completed};}},
      {name:'download_traced_svg',description:'Download the smooth, filled SVG generated from an image. Available once tracing finishes, including when the STL needs adjustments.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:(input)=>{const value=object(input);if(typeof value.id!=='string')throw new Error('Provide an artwork ID.');return {downloadStarted:true,artwork:downloadSvg(value.id)};}},
      {name:'download_stl',description:'Trigger a browser download of one validated STL by its queue ID.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:(input)=>{const value=object(input);if(typeof value.id!=='string')throw new Error('Provide a model ID.');return {downloadStarted:true,model:downloadModel(value.id)};}}
    ];
    for(const tool of registry){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional browser capability. */}}
    return()=>lifecycle.abort();
  },[enqueue,downloadModel,downloadSvg]);

  const selected=jobs.find(j=>j.id===selectedId),result=selected?.result,ready=jobs.filter(j=>j.status==='ready').length,working=jobs.filter(j=>j.status==='queued'||j.status==='working').length;
  const activeStages=selected?.kind==='image'?imageStages:stages;
  const progress=selected?.stage?8+(activeStages.indexOf(selected.stage)+1)/activeStages.length*86:5;
  return <main className="studio">
    <header className="studio-header">
      <a className="brand" href="./" aria-label="Robustthreed STL Studio home"><span className="brand-mark"><Box size={25} strokeWidth={1.7}/></span><span>robustthreed<span className="brand-divider">/</span><span className="brand-product">STL Studio</span></span></a>
      <div className="header-right"><span className="local-label"><ShieldCheck size={15}/> Files stay in your browser</span><span className="lock-badge"><LockKeyhole size={12}/> Workflow locked</span></div>
    </header>
    <div className="workspace-heading"><div><span className="eyebrow">THE ARTWORK WORKBENCH</span><h1>From artwork to a solid.</h1></div><p>Your design. Your exact workflow.</p></div>
    <div className="workspace">
      <aside className="sidebar" aria-label="Artwork and workflow">
        <section className="artwork-panel">
          <div className="section-heading"><h2>Your artwork</h2><span className="count">{jobs.length.toString().padStart(2,'0')}</span></div>
          <input ref={input} type="file" accept={".svg,"+IMAGE_ACCEPT} multiple className="visually-hidden" aria-label="Upload SVGs or images" onChange={event=>void addFiles(Array.from(event.target.files||[]))}/>
          <input ref={svgInput} type="file" accept=".svg,image/svg+xml" multiple className="visually-hidden" aria-label="Upload SVG files" onChange={event=>void addFiles(Array.from(event.target.files||[]))}/>
          <input ref={imageInput} type="file" accept={IMAGE_ACCEPT} multiple className="visually-hidden" aria-label="Upload image files" onChange={event=>void addFiles(Array.from(event.target.files||[]))}/>
          <Button variant="outline" className={'dropzone'+(dragging?' dragging':'')} onClick={()=>input.current?.click()} onDragOver={event=>{event.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={event=>{event.preventDefault();void addFiles(Array.from(event.dataTransfer.files));}}>
            <span className="upload-icon"><Upload size={23}/></span><strong>Drop SVGs or images here</strong><span>or <u>browse files</u></span>
          </Button>
          <div className="input-methods"><Button variant="outline" onClick={()=>svgInput.current?.click()}><FileCode2 size={17}/>SVG input</Button><Button variant="outline" onClick={()=>imageInput.current?.click()}><ImageIcon size={17}/>Image input</Button></div>
          <p className="upload-hint">SVG: 5 MB · Images: 30 MB · Up to 20 files</p>
          <details className="image-formats"><summary>Supported image formats</summary><p>PNG, JPEG, WebP, GIF, BMP, AVIF, HEIC / HEIF, TIFF, ICO, PSD, TGA, JPEG XL, JPEG 2000 and more raster formats. First frame or page only. Images up to 48 megapixels.</p></details>
          {notice&&<div className="notice" role="alert"><CircleAlert size={17}/><span>{notice}</span><button aria-label="Dismiss message" onClick={()=>setNotice('')}><X size={14}/></button></div>}
          <div className="queue" aria-label="Uploaded files">
            {jobs.map(job=><div key={job.id} className={'queue-item'+(selectedId===job.id?' selected':'')}>
              <button className="queue-select" onClick={()=>{setSelectedId(job.id);setView('3d');}} aria-pressed={selectedId===job.id}>
                <span className={'file-icon '+job.status}>{job.status==='working'?<LoaderCircle className="spin" size={19}/>:job.kind==='image'?<ImageIcon size={19}/>:<FileCode2 size={19}/>}</span>
                <span className="file-copy"><strong title={job.name}>{job.name}</strong><span>{job.example?'Example · ':job.kind==='image'?'Image · ':''}{job.status==='ready'?'Ready to export':job.status==='working'?'Converting…':job.status==='error'?'Needs attention':'Queued'}</span></span>
                {job.status==='ready'&&<Check size={15} className="ready-tick"/>}{job.status==='error'&&<CircleAlert size={15} className="error-tick"/>}
              </button>
              <button className="remove-file" aria-label={'Remove '+job.name} onClick={()=>remove(job.id)}><X size={14}/></button>
            </div>)}
            {!jobs.length&&<p className="empty-queue">Your files will appear here.</p>}
          </div>
          <Button variant="secondary" className="zip-button" disabled={!ready||zipping} onClick={()=>void downloadBatch()}>{zipping?<LoaderCircle size={16} className="spin"/>:<Archive size={16}/>}<span>{zipping?'Preparing ZIP…':'Download '+(ready>1?'all '+ready+' STLs':'STL')+' as ZIP'}</span><ArrowDownToLine size={16}/></Button>
          <div className="queue-meta"><span>{ready} ready{working?' · '+working+' in progress':''}</span><Button variant="link" size="sm" onClick={()=>void loadExample()} disabled={exampleLoading||jobs.some(j=>j.example)}>{exampleLoading?'Loading…':'Load example'}<ArrowUpRight size={12}/></Button></div>
        </section>
        <details className="preset-panel" open>
          <summary><span><LockKeyhole size={14}/>Your locked preset</span><ChevronDown size={15}/></summary>
          <p className="preset-intro">The same dimensions, every time.</p>
          <dl className="preset-values"><div><dt>SVG artboard</dt><dd>120 × 120 <span>mm</span></dd></div><div><dt>Silhouette backing</dt><dd>1.6 <span>mm</span></dd></div><div><dt>Raised artwork</dt><dd>0.6 <span>mm</span></dd></div><div><dt>Artwork bottom Z</dt><dd>1.6 <span>mm</span></dd></div><div className="total-row"><dt>Total thickness</dt><dd>2.2 <span>mm</span></dd></div></dl>
          <div className="preset-note"><CheckCheck size={15}/><p>Original margins preserved.<br/>Centered on X/Y. One fused solid.</p></div>
          <div className="precision-note">{PRESET.quality} quality · {PRESET.tolerance.toFixed(5)} mm curve tolerance<br/>Up to {LIMITS.triangles/1000000} million triangles. Detailed models may take several minutes.</div>
        </details>
        <p className="sidebar-note">Images become bold, smooth SVGs automatically. Clear artwork on a plain background traces best. Keep one connected outer silhouette for the finished solid.</p>
      </aside>
      <section className="model-panel" aria-label="Model preview and export">
        <div className="model-heading"><div><span className="eyebrow">MODEL PREVIEW</span><h2>{selected?cleanName(selected.name).replace(/^[0-9]+-/,'').replace(/-/g,' '):'Your next model'}</h2></div>{selected&&<span className={'status-badge '+selected.status}>{selected.status==='ready'?<><span/>Validated</>:selected.status==='error'?<><CircleAlert size={13}/>Needs attention</>:<><LoaderCircle size={13} className="spin"/>{selected.status==='queued'?'Queued':'Converting'}</>}</span>}</div>
        {selected?.kind==='image'&&<ImageTracingControls key={selected.id} settings={selected.settings} trace={selected.trace} disabled={selected.status==='working'||selected.status==='queued'} onApply={settings=>retry(selected.id,settings)}/>}
        <div className="viewport">
          <div className="viewer-toolbar"><div className="view-toggle"><Button size="sm" variant="ghost" aria-pressed={view==='3d'} disabled={!result} onClick={()=>{setView('3d');setResetKey(n=>n+1);}}><Box size={14}/>3D</Button><Button size="sm" variant="ghost" aria-pressed={view==='top'} disabled={!result} onClick={()=>{setView('top');setResetKey(n=>n+1);}}><Layers3 size={14}/>Top</Button>{selected?.kind==='image'&&<><Button size="sm" variant="ghost" aria-pressed={view==='svg'} disabled={!selected.trace} onClick={()=>setView('svg')}><FileCode2 size={14}/>SVG</Button><Button size="sm" variant="ghost" aria-pressed={view==='source'} disabled={!selected.trace} onClick={()=>setView('source')}><ImageIcon size={14}/>Image</Button></>}</div><Button size="icon-sm" variant="ghost" className="reset-view" aria-label="Reset model view" title="Reset view" disabled={!result} onClick={()=>{setView('3d');setResetKey(n=>n+1);}}><RotateCcw size={16}/></Button></div>
          {selected?.trace&&(view==='svg'||view==='source')?<ArtworkPreview trace={selected.trace} view={view}/>:result?<Suspense fallback={<div className="canvas-state"><LoaderCircle className="spin" size={27}/><p>Opening your 3D preview…</p></div>}><ModelViewer model={result} view={view==='top'?'top':'3d'} resetKey={resetKey}/></Suspense>:selected?.status==='error'?<div className="canvas-state error-state"><span className="state-icon"><CircleAlert size={30}/></span><h3>{selected.errorKind==='engine'?'The converter could not start.':selected.errorKind==='timeout'?'Conversion took too long.':selected.kind==='image'?'This image needs a trace adjustment.':'This SVG needs a small edit.'}</h3><p>{selected.error}</p><Button variant="outline" onClick={()=>retry(selected.id)}><RotateCcw size={15}/>Try again</Button></div>:selected?<div className="canvas-state"><span className="state-icon"><Layers3 size={30}/></span><h3>{selected.status==='queued'?'Your artwork is in the queue.':selected.stage+'…'}</h3><p>Applying your locked 120 mm workflow.</p><Progress className="conversion-progress" value={selected.status==='queued'?5:progress}/><span className="stage-counter">1.6 mm backing + 0.6 mm artwork</span></div>:<div className="canvas-state"><span className="state-icon"><Box size={34} strokeWidth={1.4}/></span><h3>Every detail, in dimension.</h3><p>Upload an SVG or image to build and inspect your relief.</p><Button onClick={()=>input.current?.click()}><Plus size={16}/>Add artwork</Button></div>}
          <div className="viewport-footer"><span>{view==='svg'?'Smooth, filled vector paths':view==='source'?'Source image':<><MousePointer2 size={12}/>Drag to orbit · Scroll to zoom</>}</span><span>{view==='source'&&selected?.trace?selected.trace.originalDimensions.join(' × ')+' px':'120 × 120 mm artboard'}</span></div>
        </div>
        {selected?.kind==='image'&&selected.trace&&<div className={'trace-result-note'+(selected.error?' trace-error':'')} role={selected.error?'alert':undefined}>{selected.error||((selected.trace.mode==='dark'?'Dark artwork':'Photo outlines')+' traced · Image proportions preserved on a square page.')}{selected.error&&<span>Inspect the SVG and adjust Image tracing above.</span>}</div>}
        <div className="layer-legend"><span><i className="base-swatch"/>Silhouette <strong>1.6 mm</strong></span><span><i className="art-swatch"/>Artwork <strong>0.6 mm</strong></span><small>Colors indicate height. STL exports geometry.</small></div>
        <div className="export-panel">
          <div className="measurement-heading"><span className="eyebrow">FINISHED MODEL</span><span>Artboard scale preserved</span></div>
          <div className="measurements-and-action"><dl className="measurements"><div><dt>Width</dt><dd>{result?formatted(result.dimensions[0]):'—'}<span>mm</span></dd></div><div><dt>Height</dt><dd>{result?formatted(result.dimensions[1]):'—'}<span>mm</span></dd></div><div><dt>Thickness</dt><dd>{result?formatted(result.dimensions[2]):'—'}<span>mm</span></dd></div></dl><div className="export-actions"><Button className="download-button" disabled={!result} onClick={()=>selected&&downloadModel(selected.id)}><ArrowDownToLine size={18}/>Download STL<ArrowUpRight size={17}/></Button>{selected?.kind==='image'&&<Button variant="outline" className="download-svg" disabled={!selected.trace} onClick={()=>downloadSvg(selected.id)}><FileCode2 size={16}/>Download traced SVG</Button>}</div></div>
          <div className="validation-strip">{result?<><span><ShieldCheck size={15}/>Watertight</span><span><Check size={14}/>1 connected solid</span><span><Check size={14}/>Dimensions verified</span><span className="triangle-count">{result.triangles.toLocaleString()} triangles</span></>:<><ShieldCheck size={15}/><span>Every STL must pass solid and dimension checks before export.</span></>}</div>
        </div>
        <div className="workflow-caption"><span>STL has no unit or color metadata. Import your model in <strong>millimeters</strong>.</span></div>
      </section>
    </div>
    <footer className="studio-footer"><span><LockKeyhole size={12}/>ROBUSTTHREED WORKFLOW · v1.0</span><span>Files stay in your browser and clear when you leave or reload this page.</span></footer>
  </main>;
}
