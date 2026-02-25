import * as THREE from 'three';
import { SimpleNoise } from './noise.js';
import { CONFIG } from './config.js';

const noiseGen = new SimpleNoise();

function smoothstep(min, max, value) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

export function createIceShard() {
  const { width, height, depth, detailX, detailY, detailZ, ridgeScale, ridgeDensity, ridgeDepth, fractureScale, windowSize } = CONFIG.iceShape;
  
  let geometry = new THREE.BoxGeometry(width, height, depth, detailX, detailY, detailZ); 
  const pos = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const dispArray = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);
    
    const isTopBottom = Math.abs(vertex.y) >= (height / 2) - 0.01;
    const absY = Math.abs(vertex.y) / (height / 2); 
    let finalDisp = 0;

    // --- 1. SIDES: CRYSTALLINE RIDGES (Not Sine Waves) ---
    if (!isTopBottom) {
      // We stretch the noise heavily on the Y axis (vertex.y * ridgeScale)
      // We compress it on X/Z to create vertical lines
      
      // Layer 1: Macro Structure
      let n1 = noiseGen.noise(vertex.x * ridgeDensity, vertex.y * ridgeScale, vertex.z * ridgeDensity);
      
      // Layer 2: Micro Detail
      let n2 = noiseGen.noise(vertex.x * ridgeDensity * 3.0, vertex.y * ridgeScale * 3.0, vertex.z * ridgeDensity * 3.0);
      
      // RIDGED NOISE MATH: 1.0 - abs(noise) creates sharp peaks
      let ridges = (1.0 - Math.abs(n1)) * 0.7 + (1.0 - Math.abs(n2)) * 0.3;
      
      // Invert so we get sharp valleys
      ridges = (ridges - 0.5) * 2.0; 
      
      finalDisp = ridges * ridgeDepth;

      // Mask: Fade out at top/bottom
      finalDisp *= smoothstep(1.0, 0.7, absY);

      // Apply to sides
      const isFrontBack = Math.abs(vertex.z) >= (depth / 2) - 0.01;
      if (isFrontBack) vertex.z += Math.sign(vertex.z) * finalDisp;
      else vertex.x += Math.sign(vertex.x) * finalDisp;
    }

    // --- 2. TOP/BOTTOM FRACTURES ---
    if (isTopBottom) {
      const n1 = Math.abs(noiseGen.noise(vertex.x * 2.0, vertex.y, vertex.z * 2.0));
      const n2 = Math.abs(noiseGen.noise(vertex.x * 5.0, vertex.y, vertex.z * 5.0));
      const fracture = (n1 * 0.6 + n2 * 0.4) * fractureScale;
      vertex.y += Math.sign(vertex.y) * fracture;
      
      // Splay outwards
      vertex.x *= 1.0 + fracture * 0.2;
      vertex.z *= 1.0 + fracture * 0.2;
    }

    // --- 3. FRONT WINDOW ---
    if (vertex.z > 0 && !isTopBottom) {
      const dist = Math.sqrt(vertex.x*vertex.x + vertex.y*vertex.y);
      const winMask = smoothstep(windowSize, 0.0, dist);
      
      const flatZ = (depth / 2) - 0.05; 
      vertex.z = vertex.z * (1.0 - winMask) + flatZ * winMask;
      if(winMask > 0.1) vertex.x *= 0.98;
      
      // Smooth displacement in window
      finalDisp *= (1.0 - winMask);
    }

    // Pass displacement to shader for optical calculation
    dispArray[i] = finalDisp;
    pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  
  geometry.setAttribute('aDisp', new THREE.BufferAttribute(dispArray, 1));
  geometry.computeVertexNormals();
  geometry = geometry.toNonIndexed(); 
  
  // Barycentric
  const count = geometry.attributes.position.count;
  const bary = new Float32Array(count * 3);
  for (let i = 0; i < count; i+=3) {
    bary.set([1,0,0, 0,1,0, 0,0,1], i*3);
  }
  geometry.setAttribute('barycentric', new THREE.BufferAttribute(bary, 3));
  
  return geometry;
}