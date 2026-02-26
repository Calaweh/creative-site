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
      uniforms: {
        uTime: { value: 0 },
        uCameraPos: { value: new THREE.Vector3() },
        uEnvMap: { value: null },                    
        uRefractionTex: { value: this.refractionRT.texture }, 
        uViewportSize: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
        
        // Base Material
        uIOR: { value: p.uIOR || 1.31 },
        uDispersion: { value: p.uDispersion || 0.018 },
        uAbsorption: { value: p.uAbsorption || 0.05 },
        uRefractStrength: { value: p.uRefractStrength || 0.12 },
        uIsSelected: { value: 0.0 },
        
        // NEW: Micro-Frost Uniforms
        uPatchScale: { value: p.uPatchScale || 2.5 },
        uMicroScale: { value: p.uMicroScale || 250.0 },
        uBumpIntensity: { value: p.uBumpIntensity || 0.015 },

        uVerticalStretch: { value: p.uVerticalStretch || 20.0 }

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
        uniform float uPatchScale, uMicroScale, uBumpIntensity, uVerticalStretch; 

        // --- NOISE ---
        vec3 hash3(vec3 p) {
            p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
                     dot(p, vec3(269.5, 183.3, 246.1)),
                     dot(p, vec3(113.5, 271.9, 124.6)));
            return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
        }

        float noise3D(vec3 p) {
            vec3 i = floor(p);
            vec3 f = fract(p);
            vec3 u = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)), 
                               dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                           mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)), 
                               dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
                       mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)), 
                               dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                           mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)), 
                               dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
        }

        // --- CHUNKY / WIDE LINE GENERATOR ---
        float getIceScratches(vec3 pos) {
            // 1. PATCH MASK
            float maskNoise = noise3D(pos * vec3(uPatchScale, uPatchScale * 0.2, uPatchScale));
            float unevenMask = smoothstep(0.1, 0.6, maskNoise * 0.5 + 0.5); 

            // 2. THE SCRATCHES
            vec3 p = pos * uMicroScale; 
            
            // --- CHANGE 1: WIDEN THE SPACING ---
            // Multiplying X and Z by 0.4 stretches the noise horizontally,
            // making the columns appear 2.5x wider.
            p.x *= 0.4; 
            p.z *= 0.4;
            
            // Extreme vertical stretch
            p.y /= (uVerticalStretch * 1.5); 
            
            float scratches = 0.0;
            float amp = 1.0;
            
            for(int i = 0; i < 3; i++) {
                // Break up straight lines slightly
                float breakUp = noise3D(p * 0.15) * 2.0; 
                float n = noise3D(vec3(p.x + breakUp, p.y, p.z));
                
                // Razor sharp ridges
                scratches += pow(1.0 - abs(n), 4.0) * amp;
                
                // --- CHANGE 2: SLOWER DETAILING ---
                // Reduced multiplier from 2.5 to 1.8. 
                // This keeps the "chunks" large instead of adding too much tiny noise.
                p *= vec3(1.8, 1.0, 1.8); 
                amp *= 0.6;
            }

            return scratches * unevenMask * uBumpIntensity; 
        }

        vec3 calculateNormal(vec3 pos, vec3 baseNormal) {
            // Updated sampling offset to match the new scale
            vec3 e = vec3(0.001, 0.01, 0.0); 
            
            float base = getIceScratches(pos);
            float dx = getIceScratches(pos + vec3(e.x, 0.0, 0.0)) - base;
            float dy = getIceScratches(pos + vec3(0.0, e.y, 0.0)) - base;
            float dz = getIceScratches(pos + vec3(0.0, 0.0, e.x)) - base;
            
            vec3 bumpGradient = vec3(dx/e.x, dy/e.y, dz/e.x);
            // Increased normal strength slightly to pop the wider ridges
            return normalize(baseNormal - bumpGradient * 3.0);
        }

        void main() {
          vec3 V = normalize(uCameraPos - vWorldPos);
          vec3 baseNormal = normalize(vNormal);
          float roughMask = 1.0 - vWindow;

          // 1. NORMALS
          vec3 N = baseNormal;
          float scratchValue = 0.0; 
          if (roughMask > 0.0) {
              scratchValue = getIceScratches(vWorldPos); 
              N = calculateNormal(vWorldPos, baseNormal);
              N = normalize(mix(baseNormal, N, roughMask)); 
          }

          // 2. REFRACTION
          vec2 screenUV = gl_FragCoord.xy / uViewportSize;
          vec2 offset = N.xy * uRefractStrength;
          
          // Jitter offset for blurry ice look
          offset += (vec2(hash3(vWorldPos).x, hash3(vWorldPos).y) * 0.005 * scratchValue * 50.0);

          float disp = uDispersion * roughMask;
          vec3 refr = vec3(
            texture2D(uRefractionTex, screenUV + offset * (1.0 - disp)).r,
            texture2D(uRefractionTex, screenUV + offset).g,
            texture2D(uRefractionTex, screenUV + offset * (1.0 + disp)).b
          );

          // 3. COLOR & FROST OPACITY
          float thickness = (2.0 - length(vPosition.xz)) * 2.0;
          vec3 iceColor = vec3(0.55, 0.60, 0.65); 
          vec3 absorption = iceColor * exp(-uAbsorption * max(thickness, 0.1));
          if(vWindow > 0.5) absorption = vec3(1.0); 

          // White frost opacity
          float opacity = smoothstep(0.0, 0.02, scratchValue); 
          vec3 frostColor = vec3(0.9, 0.95, 1.0); 
          vec3 finalBody = mix(refr * absorption, frostColor, opacity * 0.5 * roughMask);

          // 4. REFLECTION (MATTE)
          vec3 refl = textureCube(uEnvMap, reflect(-V, N)).rgb;
          float rim = 1.0 - max(dot(N, V), 0.0);
          float F = 0.05 + 0.95 * pow(rim, 5.0);
          float finalF = mix(F, F * 0.4, opacity);
          vec3 finalColor = mix(finalBody, refl, finalF);

          // 5. SPECULAR (Matte)
          vec3 halfVec = normalize(V + vec3(0.5, 1.0, 0.5));
          float spec = pow(max(dot(N, halfVec), 0.0), 40.0); 
          finalColor += vec3(1.0) * spec * roughMask * 0.5;

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