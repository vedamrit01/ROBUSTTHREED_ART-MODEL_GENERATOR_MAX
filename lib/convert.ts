import type { ManifoldToplevel, CrossSection, Manifold } from 'manifold-3d';
import { parseSvg, PRESET, type Point } from './svg-geometry';
import { LIMITS } from './preset';

export type ConversionResult = {
  positions: Float32Array; indices: Uint32Array; stl: ArrayBuffer;
  dimensions: [number,number,number]; volume: number; triangles: number;
  baseArea: number; artworkArea: number; vertices: number;
  checks: { watertight: true; connectedSolids: 1; winding: true; dimensions: true };
};
export type Stage = 'Reading vector paths'|'Creating silhouette'|'Building relief'|'Checking mesh';
function area(ring:Point[]) { let a=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)a+=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];return a/2; }
function inside(p:Point,ring:Point[]) { let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>p[1])!==(ring[j][1]>p[1]) && p[0]<(ring[j][0]-ring[i][0])*(p[1]-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])yes=!yes;return yes; }

export function convertSvg(source:string, api:ManifoldToplevel, progress:(stage:Stage)=>void=()=>{}):ConversionResult {
  const resources:(CrossSection|Manifold)[]=[];
  const keep=<T extends CrossSection|Manifold>(object:T):T=>{resources.push(object);return object;};
  try {
    progress('Reading vector paths'); const shapes=parseSvg(source);
    let artwork=keep(api.CrossSection.square(0));
    for(const shape of shapes){const part=keep(new api.CrossSection(shape.contours,shape.fillRule));artwork=keep(shape.white?artwork.subtract(part):artwork.add(part));}
    if(artwork.isEmpty())throw new Error('No black artwork remains after applying the SVG fills. Check your fill colors and object order.');
    const polygons=artwork.toPolygons(), positive=polygons.filter(p=>area(p)>0).sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)));
    progress('Creating silhouette');
    const outers:Point[][]=[];
    for(const ring of positive)if(!outers.some(outer=>inside(ring[0],outer)))outers.push(ring);
    if(outers.length!==1)throw new Error('The artwork has separate outer pieces. Join them into one connected silhouette before uploading; this preset does not add bridges.');
    const bounds=[Infinity,Infinity,-Infinity,-Infinity];
    for(const ring of polygons)for(const [x,y] of ring){bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],y);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],y);}
    if(bounds[0]<-60.002 || bounds[1]<-60.002 || bounds[2]>60.002 || bounds[3]>60.002)throw new Error('Artwork extends outside the square artboard. Fit the paths inside the page without changing the required margins.');
    const center:Point=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2];
    const backing=keep(new api.CrossSection(outers,'NonZero')), baseArea=backing.area(), artworkArea=artwork.area();
    progress('Building relief');
    // Build only the exterior of the two layers. A 3D Boolean between two
    // overlapping extrusions introduces tiny triangles at finely sampled curves.
    // The canonical 2D contours instead share exactly welded Float32 boundaries.
    const meshPoints:number[]=[], meshTriangles:number[]=[], pointIds=new Map<string,number>();
    function vertex(p:Point,z:number){
      const q=[Math.fround(p[0]-center[0]),Math.fround(p[1]-center[1]),Math.fround(z)],key=q.join(',');
      let id=pointIds.get(key);
      if(id===undefined){id=meshPoints.length/3;pointIds.set(key,id);meshPoints.push(...q);}
      return id;
    }
    function triangle(a:number,b:number,c:number){
      if(meshTriangles.length/3>=LIMITS.triangles)throw new Error('This design exceeds the five-million-triangle limit at maximum precision. Remove unnecessary objects or split it into simpler designs.');
      meshTriangles.push(a,b,c);
    }
    function surface(rings:Point[][],z:number,down=false){
      const ids=rings.flatMap(ring=>ring.map(p=>vertex(p,z)));
      for(const [a,b,c] of api.triangulate(rings,1e-12,false))triangle(ids[a],ids[down?c:b],ids[down?b:c]);
    }
    function walls(rings:Point[][],low:number,high:number){
      for(const ring of rings)for(let i=0;i<ring.length;i++){
        const a=ring[i],b=ring[(i+1)%ring.length],al=vertex(a,low),bl=vertex(b,low),ah=vertex(a,high),bh=vertex(b,high);
        triangle(al,bl,bh);triangle(al,bh,ah);
      }
    }
    const recess=keep(backing.subtract(artwork));
    surface(outers,0,true);walls(outers,0,PRESET.base);
    if(!recess.isEmpty())surface(recess.toPolygons(),PRESET.base);
    surface(polygons,PRESET.total);walls(polygons,PRESET.base,PRESET.total);
    progress('Checking mesh');
    const solid=keep(new api.Manifold(new api.Mesh({numProp:3,vertProperties:new Float32Array(meshPoints),triVerts:new Uint32Array(meshTriangles)})));
    meshPoints.length=0;meshTriangles.length=0;pointIds.clear();
    if(solid.status()!=='NoError')throw new Error('The artwork could not form a valid solid. Check for touching or intersecting contour edges.');
    const mesh=solid.getMesh(), raw=new Float32Array(mesh.numVert*3);
    for(let i=0;i<mesh.numVert;i++)for(let j=0;j<3;j++)raw[i*3+j]=mesh.vertProperties[i*mesh.numProp+j];
    const unique=new Map<string,number>(), remap=new Uint32Array(mesh.numVert), coords:number[]=[];
    for(let i=0;i<mesh.numVert;i++){const p=Array.from(raw.subarray(i*3,i*3+3));const key=p.join(',');let id=unique.get(key);if(id===undefined){id=coords.length/3;unique.set(key,id);coords.push(...p);}remap[i]=id;}
    const positions=new Float32Array(coords), indices=Uint32Array.from(mesh.triVerts,index=>remap[index]);
    unique.clear();coords.length=0;
    const triangles=indices.length/3, vertices=positions.length/3;
    if(!triangles || triangles>LIMITS.triangles)throw new Error('The generated mesh is empty or exceeds the five-million-triangle limit at maximum precision.');
    // Numeric edge keys fit exactly in Float64 at the mesh limit and avoid a
    // million object/string allocations. Sorted pairs must face opposite ways.
    const edges=new Float64Array(indices.length), faces=new Set<string>(), parent=Uint32Array.from({length:vertices},(_,i)=>i);
    const find=(a:number):number=>{while(parent[a]!==a){parent[a]=parent[parent[a]];a=parent[a];}return a;};
    const stl=new ArrayBuffer(84+50*triangles), view=new DataView(stl);
    new Uint8Array(stl,0,80).set(new TextEncoder().encode('Robustthreed | mm | page120 base1.6 relief0.6 total2.2 | curve0.00001 | v2'));
    view.setUint32(80,triangles,true); let volume=0;
    for(let f=0;f<triangles;f++){
      const ids=Array.from(indices.subarray(f*3,f*3+3)), key=[...ids].sort((a,b)=>a-b).join(',');
      if(new Set(ids).size!==3 || faces.has(key))throw new Error('Mesh validation found a collapsed or repeated face. The SVG needs contour cleanup.');faces.add(key);
      const [a,b,c]=ids.map(id=>Array.from(positions.subarray(id*3,id*3+3)));
      const ab=b.map((v,j)=>v-a[j]), ac=c.map((v,j)=>v-a[j]);
      const normal=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]], magnitude=Math.hypot(...normal);
      if(!Number.isFinite(magnitude) || magnitude<=1e-12)throw new Error('A detail is too small to survive STL precision. Enlarge or clean up that detail in the SVG.');
      volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
      const offset=84+50*f;
      normal.forEach((v,j)=>view.setFloat32(offset+j*4,v/magnitude,true));
      [a,b,c].forEach((point,i)=>point.forEach((v,j)=>view.setFloat32(offset+12+i*12+j*4,v,true)));
      for(let j=0;j<3;j++){const u=ids[j],v=ids[(j+1)%3];edges[f*3+j]=2*(Math.min(u,v)*vertices+Math.max(u,v))+(u<v?0:1);parent[find(u)]=find(v);}
    }
    edges.sort();
    const closedError=()=>new Error('The STL failed the closed-solid check. Clean up intersecting or touching contours in the SVG.');
    if(edges.length%2)throw closedError();
    for(let i=0;i<edges.length;i+=2)if(edges[i]%2!==0 || edges[i+1]!==edges[i]+1)throw closedError();
    const root=find(0);
    for(let i=1;i<vertices;i++)if(find(i)!==root)throw closedError();
    const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<positions.length;i++){const j=i%3;low[j]=Math.min(low[j],positions[i]);high[j]=Math.max(high[j],positions[i]);}
    const dimensions=high.map((v,j)=>v-low[j]) as [number,number,number];
    const expected=baseArea*PRESET.base+artworkArea*PRESET.relief;
    if(volume<=0 || Math.abs(volume-expected)>Math.max(.01,expected*1e-5) || Math.abs(dimensions[2]-PRESET.total)>1e-5 || Math.abs(low[2])>1e-6 || dimensions[0]>120.004 || dimensions[1]>120.004)throw new Error('The mesh did not pass the locked dimensions and volume checks. Export was stopped.');
    return {positions,indices,stl,dimensions,volume,triangles,vertices,baseArea,artworkArea,checks:{watertight:true,connectedSolids:1,winding:true,dimensions:true}};
  } finally {resources.reverse().forEach(object=>object.delete());}
}
