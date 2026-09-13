import { DOMParser } from '@xmldom/xmldom';
import { PRESET, LIMITS } from './preset';
export { PRESET } from './preset';

export type Point = [number, number];
type Matrix = [number, number, number, number, number, number];
export type Shape = { contours: Point[][]; fillRule: 'EvenOdd' | 'NonZero'; white: boolean };
const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function fail(message: string): never { throw new Error(message); }
const mid = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const same = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-10;
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function transform(p: Point, m: Matrix): Point { return [m[0]*p[0]+m[2]*p[1]+m[4], m[1]*p[0]+m[3]*p[1]+m[5]]; }
function numbers(value: string): number[] {
  const values = value.match(numberPattern) || [];
  if (value.replace(numberPattern, '').replace(/[\s,]/g, '')) fail('The SVG contains invalid numeric values. Re-export it as a plain SVG.');
  const result = values.map(Number);
  if (result.some(n => !Number.isFinite(n) || Math.abs(n) > 1e9)) fail('The SVG has coordinates outside the supported range.');
  return result;
}
function matrixFrom(value: string): Matrix {
  let result = identity;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  if (value.replace(re, '').trim()) fail('An SVG transform could not be read. Apply transforms before exporting.');
  for (const match of value.matchAll(re)) {
    const n = numbers(match[2]); let m: Matrix;
    switch (match[1]) {
      case 'matrix': if (n.length !== 6) fail('Invalid matrix transform.'); m = n as Matrix; break;
      case 'translate': if (n.length < 1 || n.length > 2) fail('Invalid translation.'); m = [1,0,0,1,n[0],n[1] ?? 0]; break;
      case 'scale': if (n.length < 1 || n.length > 2) fail('Invalid scale.'); m = [n[0],0,0,n[1] ?? n[0],0,0]; break;
      case 'rotate': {
        if (n.length !== 1 && n.length !== 3) fail('Invalid rotation.');
        const t = n[0]*Math.PI/180, c = Math.cos(t), s = Math.sin(t), x = n[1] ?? 0, y = n[2] ?? 0;
        m = [c,s,-s,c,x-c*x+s*y,y-s*x-c*y]; break;
      }
      case 'skewX': if (n.length !== 1) fail('Invalid skew.'); m = [1,0,Math.tan(n[0]*Math.PI/180),1,0,0]; break;
      case 'skewY': if (n.length !== 1) fail('Invalid skew.'); m = [1,Math.tan(n[0]*Math.PI/180),0,1,0,0]; break;
      default: fail('Unsupported SVG transform. Apply transforms before exporting.');
    }
    result = multiply(result, m);
  }
  return result;
}
function distance(p: Point, a: Point, b: Point) {
  const dx = b[0]-a[0], dy = b[1]-a[1], len = dx*dx+dy*dy;
  const t = len ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len)) : 0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}

function pathContours(d: string, matrix: Matrix, budget: { count: number }): Point[][] {
  const tokens = d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || [];
  if (d.replace(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g, '').replace(/[\s,]/g,'')) fail('A path contains invalid commands. Re-export it as a plain SVG.');
  const rings: Point[][] = []; let ring: Point[] = [], i = 0, cmd = '', previous = '', p: Point = [0,0], start: Point = [0,0], control: Point = [0,0], hasMove=false;
  if(tokens.length && !/^[mM]$/.test(tokens[0]!))fail('Every SVG path must start with a move command. Re-export the vector artwork.');
  function add(q: Point) {
    if (!q.every(Number.isFinite) || q.some(x => Math.abs(x) > 1e6)) fail('The SVG contains invalid coordinates.');
    if (++budget.count > LIMITS.pathPoints) fail('This SVG exceeds the maximum-precision point limit. Remove unnecessary objects or split it into simpler designs.');
    if (!ring.length || !same(q,ring[ring.length-1])) ring.push(q);
  }
  function finish() { if (ring.length > 1 && same(ring[0],ring[ring.length-1])) ring.pop(); if (ring.length >= 3) rings.push(ring); ring = []; }
  function cubic(a: Point, b: Point, c: Point, end: Point, depth = 0) {
    if (Math.max(distance(b,a,end),distance(c,a,end)) <= PRESET.tolerance) { add(end); return; }
    if (depth >= 24) fail('A curve could not meet the locked precision. Apply transforms and re-export.');
    const ab=mid(a,b), bc=mid(b,c), cd=mid(c,end), abc=mid(ab,bc), bcd=mid(bc,cd), center=mid(abc,bcd);
    cubic(a,ab,abc,center,depth+1); cubic(center,bcd,cd,end,depth+1);
  }
  function read() { if (i >= tokens.length || /^[a-z]$/i.test(tokens[i])) fail('An SVG path is incomplete. Re-export the vector artwork.'); const n = Number(tokens[i++]); if (!Number.isFinite(n) || Math.abs(n)>1e9) fail('Invalid path coordinate.'); return n; }
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++];
    if (!cmd) fail('The SVG path must start with a move command.');
    const upper = cmd.toUpperCase(), relative = cmd !== upper;
    if(!hasMove&&upper!=='M')fail('An SVG path must start with a move command. Re-export the artwork as valid filled paths.');
    if (!'MLHVCSQTAZ'.includes(upper)) fail('An SVG path command is unsupported. Convert the artwork to plain paths.');
    if (!ring.length && upper !== 'M') { if (upper === 'Z') fail('An SVG path is malformed.'); add(transform(p,matrix)); }
    const point = (): Point => { const x=read(),y=read(); return [x+(relative?p[0]:0),y+(relative?p[1]:0)]; };
    const reflect = (): Point => [2*p[0]-control[0],2*p[1]-control[1]];
    if (upper === 'M') { hasMove=true; const q=point(); finish(); p=q; start=q; add(transform(p,matrix)); cmd=relative?'l':'L'; }
    else if (upper === 'Z') { p=start; finish(); cmd=''; }
    else if (upper === 'L') { p=point(); add(transform(p,matrix)); }
    else if (upper === 'H') { p=[read()+(relative?p[0]:0),p[1]]; add(transform(p,matrix)); }
    else if (upper === 'V') { p=[p[0],read()+(relative?p[1]:0)]; add(transform(p,matrix)); }
    else if (upper === 'C' || upper === 'S') {
      const b = upper==='C'?point():('CS'.includes(previous)?reflect():p), c=point(), q=point();
      cubic(transform(p,matrix),transform(b,matrix),transform(c,matrix),transform(q,matrix)); control=c; p=q;
    } else if (upper === 'Q' || upper === 'T') {
      const b=upper==='Q'?point():('QT'.includes(previous)?reflect():p), q=point();
      const c1: Point=[p[0]+(b[0]-p[0])*2/3,p[1]+(b[1]-p[1])*2/3], c2: Point=[q[0]+(b[0]-q[0])*2/3,q[1]+(b[1]-q[1])*2/3];
      cubic(transform(p,matrix),transform(c1,matrix),transform(c2,matrix),transform(q,matrix)); control=b; p=q;
    } else if (upper === 'A') {
      let rx=Math.abs(read()), ry=Math.abs(read()); const angle=read()*Math.PI/180, large=read(), sweep=read(), q=point();
      if (![0,1].includes(large) || ![0,1].includes(sweep)) fail('Invalid SVG arc flags. Re-export arcs as curves.');
      if (!same(p,q)) {
        if (!rx || !ry) add(transform(q,matrix));
        else {
          const c=Math.cos(angle),s=Math.sin(angle), dx=(p[0]-q[0])/2,dy=(p[1]-q[1])/2, x=c*dx+s*dy,y=-s*dx+c*dy;
          const lambda=x*x/(rx*rx)+y*y/(ry*ry); if(lambda>1){rx*=Math.sqrt(lambda);ry*=Math.sqrt(lambda);}
          const coefficient=(large===sweep?-1:1)*Math.sqrt(Math.max(0,(rx*rx*ry*ry-rx*rx*y*y-ry*ry*x*x)/(rx*rx*y*y+ry*ry*x*x)));
          const cxp=coefficient*rx*y/ry,cyp=-coefficient*ry*x/rx,cx=c*cxp-s*cyp+(p[0]+q[0])/2,cy=s*cxp+c*cyp+(p[1]+q[1])/2;
          const begin=Math.atan2((y-cyp)/ry,(x-cxp)/rx); let delta=Math.atan2((-y-cyp)/ry,(-x-cxp)/rx)-begin;
          if(!sweep && delta>0)delta-=2*Math.PI; if(sweep && delta<0)delta+=2*Math.PI;
          // Bound linear interpolation error by max |r''| * angleStep^2 / 8.
          const u=transform([c*rx,s*rx],[...matrix.slice(0,4),0,0] as Matrix), v=transform([-s*ry,c*ry],[...matrix.slice(0,4),0,0] as Matrix);
          const radiusBound=Math.hypot(...u)+Math.hypot(...v), count=Math.max(1,Math.ceil(Math.abs(delta)*Math.sqrt(radiusBound/(8*PRESET.tolerance))));
          if(count>LIMITS.pathPoints)fail('An arc exceeds the maximum-precision point limit.');
          for(let k=1;k<=count;k++){const t=begin+delta*k/count;add(k===count?transform(q,matrix):transform([cx+c*rx*Math.cos(t)-s*ry*Math.sin(t),cy+s*rx*Math.cos(t)+c*ry*Math.sin(t)],matrix));}
        }
      } p=q;
    }
    previous=upper;
  }
  finish(); return rings;
}

type Style = { fill: string; rule: string; stroke: string; strokeWidth: string; hidden: boolean };
type XmlElement = NonNullable<ReturnType<DOMParser['parseFromString']>['documentElement']>;
function color(value: string): 'black'|'white'|'none' {
  const s=value.toLowerCase().replace(/\s/g,'');
  if(s==='none')return 'none';
  if(['black','#000','#000000','rgb(0,0,0)','rgb(0%,0%,0%)'].includes(s))return 'black';
  if(['white','#fff','#ffffff','rgb(255,255,255)','rgb(100%,100%,100%)'].includes(s))return 'white';
  return fail('Use black filled artwork on a white or transparent background. Colors and gradients need to be converted first.');
}
export function parseSvg(source: string): Shape[] {
  if(new TextEncoder().encode(source).length>5*1024*1024)fail('Each SVG must be smaller than 5 MB.');
  if(/<!DOCTYPE|<!ENTITY|<\s*(?:\w+:)?(?:script|style)\b/i.test(source))fail('Scripts, external entities and stylesheets are unsupported. Export a plain SVG with inline fills.');
  const doc=new DOMParser({onError:()=>{fail('The file is not a valid SVG. Re-export it from your vector editor.');}}).parseFromString(source,'image/svg+xml');
  const root=doc.documentElement;
  if(!root || root.localName!=='svg')fail('Choose an SVG vector file.');
  const attr=(el: XmlElement,key: string)=>el.getAttribute(key) || '';
  const length=(s:string):number=>{const m=s.trim().match(/^([-+]?(?:\d*\.\d+|\d+\.?\d*))(px|mm|cm|in|pt|pc)?$/);if(!m)fail('Set an explicit square artboard in your SVG.'); const factors:Record<string,number>={px:1,mm:96/25.4,cm:96/2.54,in:96,pt:96/72,pc:16}; return Number(m[1])*(factors[m[2]||'px']);};
  const box=attr(root,'viewBox')?numbers(attr(root,'viewBox')):[0,0,length(attr(root,'width')),length(attr(root,'height'))];
  if(box.length!==4 || box[2]<=0 || box[3]<=0 || Math.abs(box[2]-box[3])>Math.max(box[2],box[3])*1e-6)fail('This workflow requires a square SVG artboard. Place the artwork on a square page, preserving its margins, then upload again.');
  if(attr(root,'width')&&attr(root,'height')){const w=length(attr(root,'width')),h=length(attr(root,'height'));if(w<=0||h<=0||Math.abs(w-h)>Math.max(w,h)*1e-6)fail('The SVG page dimensions must also be square. Make the page and viewBox square before exporting.');}
  const scale=PRESET.artboard/box[2], rootMatrix:Matrix=[scale,0,0,-scale,-60-box[0]*scale,60+box[1]*scale];
  const shapes:Shape[]=[], budget={count:0}; let elements=0;
  function walk(el: XmlElement, parentMatrix:Matrix, inherited:Style, isRoot=false) {
    if(++elements>10000)fail('This SVG contains too many objects. Export the final artwork as compound paths.');
    const tag=el.localName || el.nodeName;
    if(['metadata','title','desc','defs','namedview'].includes(tag))return;
    const css:Record<string,string>={};
    for(const item of attr(el,'style').split(';').filter(x=>x.trim())){const colon=item.indexOf(':'); if(colon<0)fail('An inline SVG style is invalid.');css[item.slice(0,colon).trim()]=item.slice(colon+1).trim();}
    const prop=(key:string)=>css[key]??attr(el,key);
    if(prop('display')==='none' || inherited.hidden)return;
    if(prop('visibility') && prop('visibility')!=='visible')fail('Resolve hidden objects before exporting this SVG.');
    for(const key of Object.keys(css))if(!['fill','fill-rule','stroke','stroke-width','opacity','fill-opacity','stroke-opacity','display','visibility'].includes(key))fail(`The SVG uses an unsupported ${key} style. Export plain filled paths.`);
    if(prop('class') || ['clip-path','mask','filter','vector-effect','marker-start','marker-mid','marker-end'].some(key=>prop(key) && prop(key)!=='none'))fail('Clipping, masks, effects and CSS classes must be applied to paths before conversion.');
    for(const key of ['opacity','fill-opacity','stroke-opacity'])if(prop(key) && Number(prop(key))!==1)fail('Use fully opaque black fills. Transparency cannot define this relief reliably.');
    const style:Style={fill:prop('fill')||inherited.fill,rule:prop('fill-rule')||inherited.rule,stroke:prop('stroke')||inherited.stroke,strokeWidth:prop('stroke-width')||inherited.strokeWidth,hidden:false};
    const matrix=multiply(parentMatrix,matrixFrom(attr(el,'transform')));
    if(tag==='g' || (tag==='svg' && isRoot)) { for(let child=el.firstChild;child;child=child.nextSibling)if(child.nodeType===1)walk(child as XmlElement,matrix,style); return; }
    if(!['path','rect','circle','ellipse','polygon'].includes(tag))fail(`The SVG contains ${tag} objects. Convert text, strokes and other objects to filled paths first.`);
    if(style.stroke!=='none' && Number.parseFloat(style.strokeWidth)!==0)fail('This SVG uses strokes. Convert strokes to filled paths in your vector editor before uploading.');
    const fill=color(style.fill); if(fill==='none')return;
    if(!['nonzero','evenodd'].includes(style.rule))fail('Unsupported SVG fill rule.');
    const n=(key:string,fallback=0)=>{const v=attr(el,key);if(!v)return fallback;const percent=v.endsWith('%');const parsed=numbers(percent?v.slice(0,-1):v);if(parsed.length!==1)fail('Shape coordinates must use plain SVG units. Convert shapes to paths.');return parsed[0]*(percent?box[2]/100:1);};
    let d=attr(el,'d');
    if(tag==='polygon'){const p=numbers(attr(el,'points'));if(p.length<6 || p.length%2)fail('An SVG polygon is incomplete.'); d=`M${p[0]} ${p[1]} L${p.slice(2).join(' ')} Z`;}
    if(tag==='rect'){
      const x=n('x'),y=n('y'),w=n('width'),h=n('height'); if(w<0||h<0)fail('Invalid rectangle size.'); if(!w||!h)return;
      let rx=n('rx',n('ry')),ry=n('ry',rx);if(rx<0||ry<0)fail('Invalid corner radius.');rx=Math.min(rx,w/2);ry=Math.min(ry,h/2);
      d=rx&&ry?`M${x+rx} ${y} H${x+w-rx} A${rx} ${ry} 0 0 1 ${x+w} ${y+ry} V${y+h-ry} A${rx} ${ry} 0 0 1 ${x+w-rx} ${y+h} H${x+rx} A${rx} ${ry} 0 0 1 ${x} ${y+h-ry} V${y+ry} A${rx} ${ry} 0 0 1 ${x+rx} ${y} Z`:`M${x} ${y} h${w} v${h} h${-w} Z`;
    }
    if(tag==='circle'||tag==='ellipse'){const x=n('cx'),y=n('cy'),rx=n(tag==='circle'?'r':'rx'),ry=tag==='circle'?rx:n('ry');if(rx<0||ry<0)fail('Invalid circle size.');if(!rx||!ry)return;d=`M${x-rx} ${y} A${rx} ${ry} 0 1 0 ${x+rx} ${y} A${rx} ${ry} 0 1 0 ${x-rx} ${y} Z`;}
    const contours=pathContours(d,matrix,budget);
    if(contours.length)shapes.push({contours,fillRule:style.rule==='evenodd'?'EvenOdd':'NonZero',white:fill==='white'});
  }
  walk(root,rootMatrix,{fill:'black',rule:'nonzero',stroke:'none',strokeWidth:'1',hidden:false},true);
  if(!shapes.length)fail('No filled artwork was found. Convert your artwork to black filled paths.');
  return shapes;
}
