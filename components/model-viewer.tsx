'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ConversionResult } from '@/lib/convert';

function frameModel(camera:THREE.PerspectiveCamera,controls:OrbitControls,view:'3d'|'top') {
  const scale=1/Math.min(1,camera.aspect);
  controls.target.set(0,0,1.1);
  camera.position.set(...(view==='top'?[0,-.01,230*scale]:[0,-115*scale,185*scale]) as [number,number,number]);
  controls.update();
}

export default function ModelViewer({model,view,resetKey}:{model:ConversionResult;view:'3d'|'top';resetKey:number}) {
  const host=useRef<HTMLDivElement>(null), controlsRef=useRef<OrbitControls|null>(null), cameraRef=useRef<THREE.PerspectiveCamera|null>(null);
  const viewRef=useRef(view);viewRef.current=view;
  const [error,setError]=useState('');
  useEffect(()=>{
    if(!host.current)return;
    const element=host.current;let renderer:THREE.WebGLRenderer;
    try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:true});} catch {setError('The 3D preview needs WebGL. Your validated STL is still available to download.');return;}
    setError(''); renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.setClearColor(0xe9eee7,0);element.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label','Interactive relief model. Drag to orbit and scroll to zoom. Use the Top and 3D buttons for preset views.');
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,1500);camera.up.set(0,0,1);cameraRef.current=camera;
    const controls=new OrbitControls(camera,renderer.domElement);controlsRef.current=controls;controls.enableDamping=true;controls.dampingFactor=.09;controls.minDistance=35;controls.maxDistance=450;controls.maxPolarAngle=Math.PI/2-.02;controls.target.set(0,0,1.1);controls.enablePan=true;
    camera.position.set(0,-110,175);controls.update();
    scene.add(new THREE.HemisphereLight(0xffffff,0x7b8680,2.5));
    const light=new THREE.DirectionalLight(0xffffff,3.2);light.position.set(-70,-80,180);scene.add(light);
    const fill=new THREE.DirectionalLight(0xffffff,1);fill.position.set(60,60,60);scene.add(fill);
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(model.positions,3));geometry.setIndex(new THREE.BufferAttribute(model.indices,1));geometry.computeVertexNormals();
    const material=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.78,metalness:0,flatShading:true});
    material.onBeforeCompile=shader=>{
      shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying float reliefZ;').replace('#include <begin_vertex>','#include <begin_vertex>\nreliefZ = position.z;');
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float reliefZ;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb *= reliefZ > 1.6001 ? vec3(0.019, 0.028, 0.026) : vec3(0.89, 0.91, 0.86);');
    };
    const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
    const grid=new THREE.GridHelper(120,12,0xafbeb0,0xd0dace);grid.rotation.x=Math.PI/2;grid.position.z=-.12;scene.add(grid);
    const planeGeometry=new THREE.PlaneGeometry(120,120),planeMaterial=new THREE.MeshBasicMaterial({color:0xe3e9df,transparent:true,opacity:.5});
    const plane=new THREE.Mesh(planeGeometry,planeMaterial);plane.position.z=-.15;scene.add(plane);
    const borderGeometry=new THREE.EdgesGeometry(planeGeometry),borderMaterial=new THREE.LineBasicMaterial({color:0xa8bba6});
    const border=new THREE.LineSegments(borderGeometry,borderMaterial);border.position.z=-.1;scene.add(border);
    const resize=new ResizeObserver(()=>{const {width,height}=element.getBoundingClientRect();if(!width||!height)return;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();frameModel(camera,controls,viewRef.current);});resize.observe(element);
    let frame=0,active=true;const draw=()=>{if(!active)return;controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(draw);};draw();
    const lost=(event:Event)=>{event.preventDefault();setError('The 3D preview was interrupted. Your STL is still available; reload the page to restore the preview.');};renderer.domElement.addEventListener('webglcontextlost',lost);
    return()=>{active=false;cancelAnimationFrame(frame);resize.disconnect();controls.dispose();geometry.dispose();material.dispose();planeGeometry.dispose();planeMaterial.dispose();borderGeometry.dispose();borderMaterial.dispose();grid.geometry.dispose();(Array.isArray(grid.material)?grid.material:[grid.material]).forEach(m=>m.dispose());renderer.domElement.removeEventListener('webglcontextlost',lost);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();controlsRef.current=null;cameraRef.current=null;};
  },[model]);
  useEffect(()=>{const camera=cameraRef.current,controls=controlsRef.current;if(!camera||!controls)return;frameModel(camera,controls,view);},[model,view,resetKey]);
  return <div className="model-canvas" ref={host}>{error&&<div className="viewer-error" role="status">{error}</div>}</div>;
}
