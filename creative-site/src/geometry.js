import * as THREE from 'three';
import { SimpleNoise } from './noise.js';
import { CONFIG } from './config.js';

const noiseGen = new SimpleNoise();

export function createIceShard() {
  const { width, height, depth, windowSize } = CONFIG.geometry;

  // 1. BASE TOPOLOGY: THE DIGITAL CLAY
  // We switch from BoxGeometry to IcosahedronGeometry.
  // radius = 1, detail = 60 (high res, uniform triangles, no corners to fight)
  let geometry = new THREE.IcosahedronGeometry(1.0, 60); 
  
  const pos = geometry.attributes.position;
  const vertex = new THREE.Vector3();
  const windowMaskArray = new Float32Array(pos.count);

  // Define the cutting plane for the window (Z axis)
  // This ensures the window is MATHEMATICALLY FLAT, not just "kind of flat"
  const windowZ = 0.6 * depth; 

  for (let i = 0; i < pos.count; i++) {
    vertex.fromBufferAttribute(pos, i);

    // 2. SCULPTING: STRETCH INTO SHARD
    vertex.x *= width * 0.6;
    vertex.y *= height * 0.5;
    vertex.z *= depth * 0.6;

    // 3. EROSION: 3D NOISE DISPLACEMENT
    // We add noise to every axis to make it look like raw chipped stone
    const noiseFreq = 1.5;
    const n = noiseGen.noise(vertex.x * noiseFreq, vertex.y * noiseFreq, vertex.z * noiseFreq);
    const erosion = 1.0 + (n * 0.15); // Vary the volume by +/- 15%
    
    vertex.x *= erosion;
    vertex.y *= erosion;
    vertex.z *= erosion;

    // 4. THE WINDOW CUT (The "Plane Clip" Algorithm)
    // Instead of using smoothstep to blend, we check if the vertex protrudes 
    // past the window plane. If it does, we flatten it HARD.
    
    // Check if vertex is in the "Window Zone" (Front face, middle height)
    const distFromCenterY = Math.abs(vertex.y);
    const distFromCenterX = Math.abs(vertex.x);
    
    // Define the oval shape of the cut
    const isWindowZone = (vertex.z > 0.2) && 
                         (distFromCenterY < height * 0.35) && 
                         (distFromCenterX < width * 0.35);

    let isWindow = 0.0;

    if (isWindowZone) {
      // INTERPOLATE TO FLATNESS
      // We physically move the vertex to the flat plane Z-coordinate.
      // smoothstep creates a curved transition (beveled edge) into the flat glass.
      const bevel = Math.max(distFromCenterY / (height*0.35), distFromCenterX / (width*0.35));
      const cutMask = 1.0 - Math.pow(bevel, 6.0); // Sharp transition curve

      // Blend between natural rock Z and perfectly flat Window Z
      vertex.z = vertex.z * (1.0 - cutMask) + windowZ * cutMask;
      
      // Also flatten X slightly to remove the sphere curvature
      vertex.x = vertex.x * (1.0 - cutMask * 0.3);
      
      isWindow = cutMask;
    }

    windowMaskArray[i] = isWindow;
    pos.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }

  // 5. FINAL TEXTURE GENERATION
  // We must re-compute normals because we violently reshaped the sphere
  geometry.computeVertexNormals();
  geometry.setAttribute('aWindow', new THREE.BufferAttribute(windowMaskArray, 1));

  // 6. GENERATE BARYCENTRIC COORDS (For Wireframe Skin)
  // We use the non-indexed geometry trick to enable the tech-lines
  geometry = geometry.toNonIndexed(); 
  const count = geometry.attributes.position.count;
  const bary = new Float32Array(count * 3);
  for (let i = 0; i < count; i+=3) {
    bary.set([1,0,0, 0,1,0, 0,0,1], i*3);
  }
  geometry.setAttribute('barycentric', new THREE.BufferAttribute(bary, 3));

  return geometry;
}