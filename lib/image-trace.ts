import {AlphaAction,ColorSpace,FilterType,ImageMagick,initializeImageMagick,Kernel,MagickColors,MagickFormat,MagickImageInfo,MagickReadSettings,MorphologyMethod,MorphologySettings,Percentage,ResourceLimits,type IMagickImage} from '@imagemagick/magick-wasm';
import {init as initPotrace,potrace} from 'esm-potrace-wasm';
import {DOMParser} from '@xmldom/xmldom';
import {PRESET} from './preset';
import {TRACE_DEFAULTS,TRACE_LIMITS,validateTraceSettings,type TraceSettings,type ImageTrace,type TraceStage} from './image-settings';
import {INPUT_LIMITS} from './artwork-input';

let ready:Promise<void>|undefined;
export function initImageTracing(wasm:URL|Uint8Array):Promise<void> {
  ready??=Promise.all([initializeImageMagick(wasm),initPotrace()]).then(()=>{
    ResourceLimits.width=BigInt(TRACE_LIMITS.side);ResourceLimits.height=BigInt(TRACE_LIMITS.side);
    ResourceLimits.memory=BigInt(512*1024*1024);ResourceLimits.disk=BigInt(0);
    ResourceLimits.maxMemoryRequest=BigInt(512*1024*1024);ResourceLimits.maxProfileSize=BigInt(16*1024*1024);
  }).catch(error=>{ready=undefined;throw error;});
  return ready;
}

// Raster-only readers. Documents, scripts, URL readers and generated-image
// pseudo-formats never enter this path, even when renamed with an image suffix.
const RASTER_FORMATS=new Set(('3FR AAI APNG ARW AVIF AVS BMP BMP2 BMP3 CAL CALS CIN CR2 CR3 CRW CUR CUT DCM DCR DCX DDS DNG DPX DXT1 DXT5 ERF EXR FAX FF FITS FTS GIF GIF87 HDR HEIC HEIF ICB ICN ICO ICON IIQ J2C J2K JNG JP2 JPC JPE JPEG JPG JPM JPS JPT JXL K25 KDC MAT MDC MEF MIFF MNG MOS MPO MRW NEF NRW ORF OTB PALM PAM PBM PCD PCDS PCT PCX PEF PES PFM PGM PGX PHM PICON PICT PIX PJPEG PNG PNG00 PNG24 PNG32 PNG48 PNG64 PNG8 PNM PPM PSB PSD PTIF QOI RAF RAS RLA RLE RMF RW2 RWL SCT SFW SGI SR2 SRF SRW SUN TGA TIFF TIFF64 TIM VDA VICAR VIFF VIPS VST WBMP WEBP WPG X3F XBM XCF XPM XV').split(' '));
const unsupported='This image encoding could not be opened. Export it as PNG, JPEG, TIFF or WebP and upload again.';

function dimensions(width:number,height:number){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<2||height<2)throw new Error('Choose an image at least 2 × 2 pixels.');
  if(width>TRACE_LIMITS.side||height>TRACE_LIMITS.side||width*height>TRACE_LIMITS.pixels)throw new Error('This image is too large to trace here. Use an image up to 48 megapixels and 20,000 pixels per side.');
}
function pixels(image:IMagickImage):Uint8Array {
  return image.getPixels(p=>{const data=p.toByteArray(0,0,image.width,image.height,'RGBA');if(!data)throw new Error(unsupported);return new Uint8Array(data);});
}

// Otsu separates ink from the background; a midpoint across a flat optimum
// avoids choosing black itself as the threshold for a clean two-tone image.
export function automaticThreshold(data:Uint8Array):number {
  const histogram=new Float64Array(256);let sum=0,total=data.length/4;
  for(let i=0;i<data.length;i+=4){const value=Math.round(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);histogram[value]++;sum+=value;}
  let weight=0,lowerSum=0,best=-1,first=0,last=0;
  for(let t=0;t<255;t++){
    weight+=histogram[t];lowerSum+=t*histogram[t];
    if(!weight||weight===total)continue;
    const difference=lowerSum/weight-(sum-lowerSum)/(total-weight),score=weight*(total-weight)*difference*difference;
    if(score>best*(1+1e-12)){best=score;first=last=t;}else if(Math.abs(score-best)<=Math.max(1,best)*1e-12)last=t;
  }
  if(best<0)throw new Error('This image has no visible contrast to trace. Choose artwork with a clear subject and background.');
  return Math.max(32,Math.min(224,Math.round((first+last)/2)));
}

function characterize(data:Uint8Array,width:number,height:number){
  let ink=0,foreground=0,colored=0,borderDark=0,borderCount=0;
  const step=Math.max(1,Math.floor(Math.sqrt(width*height/200000)));
  for(let y=0;y<height;y+=step)for(let x=0;x<width;x+=step){
    const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2],lum=.2126*r+.7152*g+.0722*b;
    if(lum<245){foreground++;if(lum<70)ink++;if(Math.max(r,g,b)-Math.min(r,g,b)>35)colored++;}
    if(x<width*.025||y<height*.025||x>width*.975||y>height*.975){borderCount++;if(lum<100)borderDark++;}
  }
  return {invert:borderDark>borderCount*.8,outline:foreground>0&&colored>foreground*.35&&ink<foreground*.12};
}

function cleanPotraceSvg(traced:string,width:number,height:number):string {
  // Reconstruct a minimal filled-path SVG, discarding Potrace's DOCTYPE and
  // XML metadata. The path transform is essential: coordinates use 1/10 pixels
  // and a bottom-up Y axis. Square padding preserves image proportions/margins.
  const safe=traced.replace(/<!DOCTYPE[\s\S]*?>/g,'');
  const doc=new DOMParser().parseFromString(safe,'image/svg+xml');
  const groups=doc.getElementsByTagName('g'),paths=doc.getElementsByTagName('path');
  if(groups.length!==1||!paths.length)throw new Error('No closed artwork could be traced. Increase the contrast or choose clearer line art.');
  const transform=groups[0].getAttribute('transform')||'';
  if(!/^translate\([\d.,\s-]+\)\s+scale\([\d.,\s-]+\)$/.test(transform))throw new Error('The vector trace could not preserve its coordinate system.');
  const parts:string[]=[];
  for(let i=0;i<paths.length;i++){
    const d=paths[i].getAttribute('d')||'';
    if(!d||!/^[MLHVCSQTAZmlhvcsqtaz0-9eE.,\s+-]+$/.test(d))throw new Error('The vector trace contains an unsupported contour.');
    parts.push(d);
  }
  const side=Math.max(width,height),x=(side-width)/2,y=(side-height)/2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120mm" height="120mm" viewBox="0 0 ${side} ${side}"><title>Bold, smooth traced artwork</title><rect width="${side}" height="${side}" fill="#ffffff"/><g transform="translate(${x} ${y})"><g transform="${transform}"><path fill="#000000" fill-rule="nonzero" d="${parts.join(' ')}"/></g></g></svg>`;
}

export async function traceImage(bytes:Uint8Array,settings:TraceSettings={...TRACE_DEFAULTS},progress:(stage:TraceStage)=>void=()=>{},fileName=''):Promise<ImageTrace> {
  if(!ready)throw new Error('The image converter has not loaded yet.');
  await ready;settings=validateTraceSettings(settings);
  if(!bytes.length||bytes.length>INPUT_LIMITS.imageBytes)throw new Error('Choose an image smaller than 30 MB.');
  progress('Reading image');
  const header=new TextDecoder().decode(bytes.subarray(0,256)).trimStart();
  if(header.startsWith('<')||header.startsWith('%PDF')||header.startsWith('%!'))throw new Error('Use SVG input for vector files. Image input accepts raster images.');
  // ICO and TGA do not reliably auto-detect from an in-memory blob. Supply only
  // these known raster hints; never accept an arbitrary coder from a filename.
  const iconCount=(bytes[4]||0)+256*(bytes[5]||0);
  const icon=bytes[0]===0&&bytes[1]===0&&(bytes[2]===1||bytes[2]===2)&&bytes[3]===0&&iconCount>0&&bytes.length>=6+16*iconCount;
  const hint=/\.(tga|vda|vst)$/i.test(fileName)?MagickFormat.Tga:icon?(bytes[2]===2?MagickFormat.Cur:MagickFormat.Ico):undefined;
  const readSettings=new MagickReadSettings({frameIndex:0,frameCount:1,format:hint});
  let info;
  try{info=MagickImageInfo.create(bytes,readSettings);}catch{throw new Error(unsupported);}
  if(!RASTER_FORMATS.has(info.format))throw new Error(unsupported);
  dimensions(info.width,info.height);
  try {
    const prepared=ImageMagick.read(bytes,readSettings,image=>{
      image.autoOrient();image.resetPage();
      const originalDimensions:[number,number]=[image.width,image.height];
      image.colorSpace=ColorSpace.sRGB;image.backgroundColor=MagickColors.White;image.alpha(AlphaAction.Remove);
      const previewPng=image.clone(preview=>{preview.resize(768,768,FilterType.Lanczos);return preview.write(MagickFormat.Png,data=>new Uint8Array(data).buffer);});
      const originalSide=Math.max(image.width,image.height),target=Math.min(TRACE_LIMITS.workingSide,Math.max(2048,originalSide)),ratio=target/originalSide;
      image.resize(Math.max(2,Math.round(image.width*ratio)),Math.max(2,Math.round(image.height*ratio)),FilterType.Lanczos);
      const width=image.width,height=image.height,character=characterize(pixels(image),width,height);
      const mode:ImageTrace['mode']=settings.mode==='auto'?(character.outline?'outline':'dark'):settings.mode;
      if(character.invert)image.negate();
      image.grayscale();
      // Work relative to source pixels so enlargement cannot invent detail.
      const sigma=(settings.smoothing==='smooth'?.85:.35)*ratio;
      image.blur(0,Math.max(.35,Math.min(2.2,sigma)));
      let threshold:number;
      if(mode==='outline'){
        threshold=settings.threshold??144;
        const upper=8+(255-threshold)*.18;
        image.cannyEdge(0,1,new Percentage(upper*.4),new Percentage(upper));image.negate();
      }else{
        threshold=settings.threshold??automaticThreshold(pixels(image));
        image.threshold(new Percentage(threshold/255*100));
      }
      progress('Preparing bold borders');
      const extraWidth=settings.border==='extra'?.24:settings.border==='bold'?.12:0;
      const radius=extraWidth*Math.max(width,height)/PRESET.artboard/2;
      if(radius>0)image.morphology(new MorphologySettings(MorphologyMethod.Erode,Kernel.Disk,String(Math.max(1,radius))));
      const data=pixels(image);
      let ink=0;for(let i=0;i<data.length;i+=4)if(data[i]<128)ink++;
      if(ink<4||ink>width*height*.98)throw new Error('The trace is empty or almost completely filled. Adjust the contrast or choose artwork with a clear background.');
      return {width,height,data,previewPng,originalDimensions,mode,threshold};
    });
    progress('Tracing smooth curves');
    const traced=await potrace({width:prepared.width,height:prepared.height,data:new Uint8ClampedArray(prepared.data)} as ImageData,{extractcolors:false,posterizelevel:2,turdsize:4,turnpolicy:4,alphamax:1,opticurve:1,opttolerance:settings.smoothing==='smooth'?.25:.1});
    const svg=cleanPotraceSvg(traced,prepared.width,prepared.height);
    if(new TextEncoder().encode(svg).length>INPUT_LIMITS.svgBytes)throw new Error('This image contains too much texture to become a clean SVG. Use smooth tracing or a simpler background.');
    return {svg,previewPng:prepared.previewPng,originalDimensions:prepared.originalDimensions,workingDimensions:[prepared.width,prepared.height],format:info.format,mode:prepared.mode,threshold:prepared.threshold,settings};
  }catch(error){
    const message=error instanceof Error?error.message:'';
    if(/memory|cache resources|width or height|allocation|too large/i.test(message))throw new Error('The image needs too much memory to trace. Resize it to 4,096 pixels on the longest side and try again.');
    if(error&&typeof error==='object'&&'severity' in error)throw new Error(unsupported);
    throw error;
  }
}
