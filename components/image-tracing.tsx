'use client';
import {useEffect,useState} from 'react';
import {SlidersHorizontal,RotateCcw,ChevronDown} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Slider} from '@/components/ui/slider';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {TRACE_DEFAULTS,type ImageTrace,type TraceSettings} from '@/lib/image-settings';

export function ImageTracingControls({settings,trace,disabled,onApply}:{settings:TraceSettings;trace?:ImageTrace;disabled:boolean;onApply:(settings:TraceSettings)=>void}){
  const [draft,setDraft]=useState<TraceSettings>(settings);
  useEffect(()=>setDraft(settings),[settings]);
  const dirty=JSON.stringify(draft)!==JSON.stringify(settings);
  const set=<K extends keyof TraceSettings>(key:K,value:TraceSettings[K])=>setDraft(current=>({...current,[key]:value}));
  return <details className="image-tracing-controls">
    <summary><span><SlidersHorizontal size={16}/>Image tracing<span className="trace-summary">{{original:'Original weight',bold:'Bold borders',extra:'Extra bold'}[settings.border]} · {settings.smoothing==='smooth'?'Smooth curves':'Fine details'}</span></span><ChevronDown size={16}/></summary>
    <div className="trace-control-grid">
      <div><label htmlFor="trace-mode">Artwork style</label><Select value={draft.mode} onValueChange={value=>set('mode',value as TraceSettings['mode'])}><SelectTrigger id="trace-mode"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="auto">Detect automatically</SelectItem><SelectItem value="dark">Dark artwork / line art</SelectItem><SelectItem value="outline">Colour / photo outlines</SelectItem></SelectContent></Select></div>
      <div><label htmlFor="trace-border">Border weight</label><Select value={draft.border} onValueChange={value=>set('border',value as TraceSettings['border'])}><SelectTrigger id="trace-border"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="original">Original weight</SelectItem><SelectItem value="bold">Bold</SelectItem><SelectItem value="extra">Extra bold</SelectItem></SelectContent></Select></div>
      <div><label htmlFor="trace-curves">Curve finish</label><Select value={draft.smoothing} onValueChange={value=>set('smoothing',value as TraceSettings['smoothing'])}><SelectTrigger id="trace-curves"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="smooth">Smooth curves</SelectItem><SelectItem value="detail">Keep finer details</SelectItem></SelectContent></Select></div>
    </div>
    <div className="trace-contrast"><div><label id="contrast-label">Trace sensitivity</label><span>{draft.threshold===null?'Automatic':Math.round(draft.threshold)}<Button variant="link" size="sm" disabled={draft.threshold===null} onClick={()=>set('threshold',null)}>Auto</Button></span></div><Slider aria-labelledby="contrast-label" min={1} max={254} step={1} value={[draft.threshold??trace?.threshold??128]} onValueChange={value=>set('threshold',value[0])}/><p>Higher captures more lines. Check the SVG preview before printing.</p></div>
    <div className="trace-control-actions"><Button variant="ghost" size="sm" onClick={()=>setDraft({...TRACE_DEFAULTS})}>Reset settings</Button><Button variant="secondary" size="sm" disabled={disabled||!dirty} onClick={()=>onApply(draft)}><RotateCcw size={14}/>Apply &amp; regenerate</Button></div>
  </details>;
}

export function ArtworkPreview({trace,view}:{trace:ImageTrace;view:'svg'|'source'}){
  const [url,setUrl]=useState('');
  useEffect(()=>{
    const blob=view==='svg'?new Blob([trace.svg],{type:'image/svg+xml'}):new Blob([trace.previewPng],{type:'image/png'});
    const next=URL.createObjectURL(blob);setUrl(next);return()=>URL.revokeObjectURL(next);
  },[trace,view]);
  return <div className="artwork-preview">{url&&<img src={url} alt={view==='svg'?'Traced black vector artwork with smooth curves':'Original image, oriented for tracing'}/>}</div>;
}
