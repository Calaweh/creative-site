import * as THREE from 'three';
import { CrystalGrowthEngine } from './simulation.js';

export class Catalyst {
  constructor(seed = 42, params = {}, sourceTex = null) {
    this.seed = seed;
    this.params = params;
    this.group = new THREE.Group();

    // 1. GENERATE
    const engine = new CrystalGrowthEngine(seed, params);
    const result = engine.generate();
    this.geometry = result.geometry;
    
    this.surfaceTexture = new THREE.CanvasTexture(result.texture);
    this.surfaceTexture.wrapS = this.surfaceTexture.wrapT = THREE.RepeatWrapping;

    // 2. MASK & SOURCE (For Pen Tool)
    this.maskCanvas = document.createElement('canvas');
    this.maskCanvas.width = this.maskCanvas.height = 512;
    this.maskCtx = this.maskCanvas.getContext('2d');
    this.maskCtx.fillStyle = 'black';
    this.maskCtx.fillRect(0,0,512,512);
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);

    // 3. REFRACTION
    this.refractionRT = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);

    // 4. MATERIAL
    this.material = this.createShader(params, sourceTex);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.parentCatalyst = this; // Important for raycasting
    this.group.add(this.mesh);

    this.internalIP = this.createInternalIP();
    this.internalScene = new THREE.Scene();
    this.internalScene.add(this.internalIP);
  }

  paint(uv, radius = 30) {
    this.maskCtx.fillStyle = 'white';
    this.maskCtx.beginPath();
    this.maskCtx.arc(uv.x * 512, (1 - uv.y) * 512, radius, 0, Math.PI * 2);
    this.maskCtx.fill();
    this.maskTex.needsUpdate = true;
  }

  createShader(p, sourceTex) {
    return new THREE.ShaderMaterial({
      // We no longer need the derivatives extension!
      uniforms: {
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uEnvMap: { value: null },                    
        uRefractionTex: { value: this.refractionRT.texture }, 
        uViewportSize: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        uIOR: { value: p.uIOR || 1.31 },
        uDispersion: { value: p.uDispersion || 0.018 },
        uAbsorption: { value: p.uAbsorption || 0.05 },
        uRefractStrength: { value: p.uRefractStrength || 0.12 },
        uIsSelected: { value: 0.0 }
      },
      vertexShader: `
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vWindow;
        attribute float aWindow; 

        void main() {
          vWindow = aWindow;
          vPosition = position;
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        varying vec3 vPosition;
        varying float vWindow;

        uniform vec3 uCameraPos;
        uniform samplerCube uEnvMap;
        uniform sampler2D uRefractionTex;
        uniform vec2 uViewportSize;
        uniform float uIOR, uDispersion, uAbsorption, uRefractStrength, uIsSelected;

        // --- 1. RANDOM HASH ---
        vec3 hash33(vec3 p) {
            p = vec3(dot(p,vec3(127.1,311.7, 74.7)),
                     dot(p,vec3(269.5,183.3,246.1)),
                     dot(p,vec3(113.5,271.9,124.6)));
            return fract(sin(p)*43758.5453123);
        }

        // --- 2. VORONOI NOISE (For tidy, distributed pits/bumps) ---
        float voronoi(vec3 x) {
            vec3 p = floor(x);
            vec3 f = fract(x);
            float res = 100.0;
            // Searches neighboring grid cells to find the closest random point
            for(int k=-1; k<=1; k++)
            for(int j=-1; j<=1; j++)
            for(int i=-1; i<=1; i++) {
                vec3 b = vec3(float(i), float(j), float(k));
                vec3 r = vec3(b) - f + hash33(p + b);
                float d = dot(r, r); // Distance squared creates perfect bowl shapes
                res = min(res, d);
            }
            return res; 
        }

        // --- 3. MICRO BUMP GENERATOR ---
        float getMicroBumps(vec3 pos) {
            // "pos * 30.0" controls the DENSITY of the bumps. Higher = smaller/more dense.
            float pits = voronoi(pos * 30.0);
            
            // To make them CONVEX (pimples/droplets), use: return (1.0 - pits) * 0.03;
            // To make them CONCAVE (holes/hammered ice), use:
            return pits * 0.03; 
        }

        // --- 4. FINITE DIFFERENCE NORMAL (The Secret to No Aliasing/Static) ---
        vec3 calculatePerfectNormal(vec3 pos, vec3 baseNormal) {
            // We sample the 3D space slightly offset in X, Y, and Z
            vec2 e = vec2(0.005, 0.0); // 0.005 controls the sharpness of the bump edge
            
            // Exactly calculate the slope without relying on screen pixels
            float dx = getMicroBumps(pos + e.xyy) - getMicroBumps(pos - e.xyy);
            float dy = getMicroBumps(pos + e.yxy) - getMicroBumps(pos - e.yxy);
            float dz = getMicroBumps(pos + e.yyx) - getMicroBumps(pos - e.yyx);
            
            vec3 bumpGradient = vec3(dx, dy, dz) / (2.0 * e.x);
            return normalize(baseNormal - bumpGradient);
        }

        void main() {
          vec3 V = normalize(uCameraPos - vWorldPos);
          vec3 baseNormal = normalize(vNormal);
          float roughMask = 1.0 - vWindow;

          // Calculate our perfect, artifact-free bumpy normal!
          vec3 N = baseNormal;
          if (roughMask > 0.0) {
              N = calculatePerfectNormal(vWorldPos, baseNormal);
              // Blend the bump strength based on the window mask
              N = normalize(mix(baseNormal, N, roughMask)); 
          }

          // --- SCREEN SPACE REFRACTION ---
          vec2 screenUV = gl_FragCoord.xy / uViewportSize;
          vec2 offset = N.xy * uRefractStrength;
          float disp = uDispersion * roughMask;
          
          vec3 refr = vec3(
            texture2D(uRefractionTex, screenUV + offset * (1.0 - disp)).r,
            texture2D(uRefractionTex, screenUV + offset).g,
            texture2D(uRefractionTex, screenUV + offset * (1.0 + disp)).b
          );

          // --- COLOR & ABSORPTION ---
          float thickness = (2.0 - length(vPosition.xz)) * 2.0;
          vec3 iceColor = vec3(0.70, 0.75, 0.82); // Frosty slate blue
          vec3 absorption = iceColor * exp(-uAbsorption * max(thickness, 0.1));
          if(vWindow > 0.5) absorption = vec3(1.0); 

          // --- FRESNEL & REFLECTION ---
          vec3 refl = textureCube(uEnvMap, reflect(-V, N)).rgb;
          float rim = 1.0 - max(dot(N, V), 0.0);
          float F0 = pow((1.0 - uIOR) / (1.0 + uIOR), 2.0);
          float F = F0 + (1.0 - F0) * pow(rim, 5.0);
          
          // Boost reflection on the bumpy surface so the pits catch the light
          float finalF = mix(F, clamp(F * 1.5, 0.0, 1.0), roughMask);
          vec3 finalColor = mix(refr * absorption, refl, finalF);

          // --- SPECULAR HIGHLIGHTS ---
          vec3 halfVec = normalize(V + normalize(vec3(0.5, 1.0, 0.5)));
          float spec = pow(max(dot(N, halfVec), 0.0), 120.0); // Tighter specular to see the dimples
          finalColor += vec3(1.0) * spec * roughMask * 1.2;

          if(uIsSelected > 0.5) finalColor += vec3(0.1, 0.3, 0.5) * pow(rim, 3.0);

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
    });
  }

  createInternalIP() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, 512, 512); // Transparent background

    // Draw Hexagon Frame
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 20;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        let angle = (i * Math.PI) / 3 + Math.PI/2;
        let px = 256 + 180 * Math.cos(angle);
        let py = 256 + 180 * Math.sin(angle);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.font = 'bold 150px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('IP', 256, 256);

    const tex = new THREE.CanvasTexture(canvas);
    const plane = new THREE.PlaneGeometry(1.5, 1.5);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: THREE.AdditiveBlending, // Makes it glow internally
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const ipMesh = new THREE.Mesh(plane, mat);
    // Note: removed Math.PI rotation. .lookAt() handles orientation automatically.
    return ipMesh;
  }

  setupRefraction(renderer, camera, envMap) {
this.material.uniforms.uEnvMap.value = envMap;
    this.internalScene.background = envMap; 
    this.material.uniforms.uRefractionTex.value = this.refractionRT.texture;
  }
  update(renderer, camera, time) {
// Update uTime uniform
    this.material.uniforms.uTime.value = time;
    
    this.material.uniforms.uCameraPos.value.copy(camera.position);
    this.material.uniforms.uViewportSize.value.set(
      renderer.domElement.width,
      renderer.domElement.height
    );
    this.internalIP.lookAt(camera.position.x, this.internalIP.position.y, camera.position.z);

    renderer.setRenderTarget(this.refractionRT);
    renderer.render(this.internalScene, camera);
    renderer.setRenderTarget(null);
  }
  getObject() { return this.group; }

  rebuild() {
    // Re-run simulation with ALL current params stored in this instance
    const engine = new CrystalGrowthEngine(this.seed, this.params);
    const result = engine.generate();
    
    this.mesh.geometry.dispose();
    this.mesh.geometry = result.geometry;
    
    this.surfaceTexture.dispose();
    this.surfaceTexture = new THREE.CanvasTexture(result.texture);
    this.material.uniforms.uSurfaceTex.value = this.surfaceTexture;
  }
}