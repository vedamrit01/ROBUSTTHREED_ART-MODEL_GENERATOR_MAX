// Independent analytic reference for the supplied M/L/C Ganesha fixture.
// Integrates each original cubic exactly using Green's theorem. It does not
// flatten curves or use the production tessellator or solid modeller.
import assert from 'node:assert/strict';

type Point=[number,number];
type Ring={area:number;start:Point;points:Point[]};
function coefficients(a:number,b:number,c:number,d:number){return [a,3*(b-a),3*(a-2*b+c),-a+3*b-3*c+d];}
function cubicArea(a:Point,b:Point,c:Point,d:Point){
  const x=coefficients(a[0],b[0],c[0],d[0]),y=coefficients(a[1],b[1],c[1],d[1]);let total=0;
  for(let i=0;i<4;i++)for(let j=1;j<4;j++)total+=(x[i]*j*y[j]-y[i]*j*x[j])/(i+j);
  return total/2;
}
function pointOnCurve(a:Point,b:Point,c:Point,d:Point,t:number):Point{const s=1-t;return [0,1].map(i=>s*s*s*a[i]+3*s*s*t*b[i]+3*s*t*t*c[i]+t*t*t*d[i]) as Point;}
function contains(ring:Point[],p:Point){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>p[1])!==(ring[j][1]>p[1])&&p[0]<(ring[j][0]-ring[i][0])*(p[1]-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])inside=!inside;return inside;}

export function ganeshaReference(source:string){
  assert.match(source,/viewBox="0 0 1254 1254"/);
  assert.match(source,/fill-rule="evenodd"/);
  const path=source.match(/<path\s+d="([^"]+)"/)?.[1];assert.ok(path);
  assert.deepEqual([...new Set(path.match(/[A-DF-Za-df-z]/g))].sort(),['C','L','M']);
  const tokens=path.match(/[MLC]|[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)!;
  const scale=120/1254,rings:Ring[]=[];let i=0,command='',p:Point=[0,0],ring:Ring|undefined;
  const low=[Infinity,Infinity],high=[-Infinity,-Infinity];
  const include=(p:Point)=>{for(let k=0;k<2;k++){low[k]=Math.min(low[k],p[k]);high[k]=Math.max(high[k],p[k]);}};
  const nextPoint=():Point=>[Number(tokens[i++])*scale-60,60-Number(tokens[i++])*scale];
  const lineArea=(a:Point,b:Point)=>(a[0]*b[1]-a[1]*b[0])/2;
  const finish=()=>{if(ring){ring.area+=lineArea(p,ring.start);rings.push(ring);}};
  while(i<tokens.length){
    if(/[MLC]/.test(tokens[i]))command=tokens[i++];
    if(command==='M'){finish();p=nextPoint();include(p);ring={area:0,start:p,points:[p]};command='L';}
    else if(command==='L'){const q=nextPoint();ring!.area+=lineArea(p,q);ring!.points.push(q);include(q);p=q;}
    else if(command==='C'){
      const b=nextPoint(),c=nextPoint(),d=nextPoint();ring!.area+=cubicArea(p,b,c,d);include(d);
      // Samples are used only for unambiguous contour nesting, not for area.
      for(let k=1;k<=32;k++)ring!.points.push(pointOnCurve(p,b,c,d,k/32));
      for(let axis=0;axis<2;axis++){
        const values=coefficients(p[axis],b[axis],c[axis],d[axis]),a=3*values[3],bb=2*values[2],cc=values[1],discriminant=bb*bb-4*a*cc;
        const roots=Math.abs(a)<1e-16?(Math.abs(bb)>1e-16?[-cc/bb]:[]):discriminant>=0?[(-bb+Math.sqrt(discriminant))/(2*a),(-bb-Math.sqrt(discriminant))/(2*a)]:[];
        for(const t of roots)if(t>0&&t<1)include(pointOnCurve(p,b,c,d,t));
      }
      p=d;
    }else throw new Error('Unexpected fixture command.');
  }
  finish();assert.equal(rings.length,65);
  const depths=rings.map(r=>rings.filter(other=>Math.abs(other.area)>Math.abs(r.area)&&contains(other.points,r.start)).length);
  assert.deepEqual(depths.reduce((counts,depth)=>({...counts,[depth]:(counts[depth]??0)+1}),{} as Record<number,number>),{0:1,1:42,2:15,3:7});
  const baseArea=rings.reduce((sum,r,i)=>sum+(depths[i]===0?Math.abs(r.area):0),0);
  const artworkArea=rings.reduce((sum,r,i)=>sum+(depths[i]%2?-1:1)*Math.abs(r.area),0);
  return {baseArea,artworkArea,volume:baseArea*1.6+artworkArea*.6,dimensions:[high[0]-low[0],high[1]-low[1],2.2]};
}
