export const IMAGE_EXTENSIONS = ['png','jpg','jpeg','jpe','jfif','webp','gif','bmp','dib','avif','heic','heif','tif','tiff','ico','cur','psd','psb','tga','pnm','ppm','pgm','pbm','jxl','jp2','j2k','jpf','pcx','qoi','dds'];
export const IMAGE_ACCEPT = 'image/*,' + IMAGE_EXTENSIONS.map(extension=>'.'+extension).join(',');
export const INPUT_LIMITS = Object.freeze({ files:20, svgBytes:5*1024*1024, imageBytes:30*1024*1024 });
export type InputKind = 'svg' | 'image';
export function inputKind(name:string,mime=''):InputKind {
  const extension=name.split('.').pop()?.toLowerCase();
  if(extension==='svg'||mime==='image/svg+xml')return 'svg';
  if(mime.startsWith('image/')||IMAGE_EXTENSIONS.includes(extension||''))return 'image';
  throw new Error('Choose an SVG or an image file.');
}
export function checkFile(name:string,size:number,mime=''):InputKind {
  const kind=inputKind(name,mime),limit=kind==='svg'?INPUT_LIMITS.svgBytes:INPUT_LIMITS.imageBytes;
  if(!size)throw new Error('This file is empty. Choose the original artwork file.');
  if(size>limit)throw new Error(kind==='svg'?'Each SVG must be smaller than 5 MB.':'Each image must be smaller than 30 MB.');
  return kind;
}
export const artworkName=(name:string)=>name.replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^[-.]+/,'').slice(0,100)||'artwork';
