import type {ConversionResult,Stage} from './convert';
import type {ImageTrace,TraceSettings,TraceStage} from './image-settings';
export type FailureKind='input'|'image'|'engine'|'timeout';
export type WorkStage=Stage|TraceStage;
export type ConversionRequest={id:string;source:string;image?:never;settings?:never;name?:never}|{id:string;image:Blob;name:string;settings:TraceSettings;source?:never};
export type ConversionMessage=
  |{id:string;type:'progress';stage:WorkStage}
  |{id:string;type:'traced';trace:ImageTrace}
  |{id:string;type:'result';result:ConversionResult}
  |{id:string;type:'error';errorKind:FailureKind;error:string};
