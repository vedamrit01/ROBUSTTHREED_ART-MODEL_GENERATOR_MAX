export type TraceSettings = {
  mode: 'auto' | 'dark' | 'outline';
  border: 'original' | 'bold' | 'extra';
  smoothing: 'smooth' | 'detail';
  threshold: number | null;
};
export const TRACE_DEFAULTS:Readonly<TraceSettings> = Object.freeze({mode:'auto',border:'bold',smoothing:'smooth',threshold:null});
export const TRACE_LIMITS = Object.freeze({pixels:48_000_000,side:20000,workingSide:4096});
export type TraceStage = 'Reading image' | 'Preparing bold borders' | 'Tracing smooth curves';
export type ImageTrace = {
  svg:string; previewPng:ArrayBuffer;
  originalDimensions:[number,number]; workingDimensions:[number,number];
  format:string; mode:'dark'|'outline'; threshold:number;
  settings:TraceSettings;
};
export function validateTraceSettings(settings:TraceSettings):TraceSettings {
  if(!['auto','dark','outline'].includes(settings.mode)||!['original','bold','extra'].includes(settings.border)||!['smooth','detail'].includes(settings.smoothing)||(settings.threshold!==null&&(!Number.isFinite(settings.threshold)||settings.threshold<1||settings.threshold>254)))throw new Error('Choose valid image tracing settings.');
  return {...settings};
}
