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
        uBumpIntensity: { value: p.uBumpIntensity || 0.015 }
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
        
        // Declare uniforms here
        uniform float uIOR, uDispersion, uAbsorption, uRefractStrength, uIsSelected;
        uniform float uPatchScale, uMicroScale, uBumpIntensity;

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

        float getMicroBumps(vec3 pos) {
            // Replaced hard-coded 2.5 with uPatchScale
            float unevenMask = noise3D(pos * uPatchScale) * 0.5 + 0.5; 
            unevenMask = smoothstep(0.3, 0.7, unevenMask); 

            // Replaced hard-coded 250.0 with uMicroScale
            vec3 p = pos * uMicroScale; 
            float micro = 0.0;
            float amp = 0.5;
            
            for(int i = 0; i < 2; i++) {
                micro += noise3D(p) * amp;
                p *= 2.1;
                amp *= 0.5;
            }

            float pits = pow(abs(micro), 1.5);

            // Replaced hard-coded 0.015 with uBumpIntensity
            return pits * unevenMask * uBumpIntensity; 
        }

        vec3 calculatePerfectNormal(vec3 pos, vec3 baseNormal) {
            vec2 e = vec2(0.0005, 0.0); 
            float base = getMicroBumps(pos);
            float dx = getMicroBumps(pos + e.xyy) - base;
            float dy = getMicroBumps(pos + e.yxy) - base;
            float dz = getMicroBumps(pos + e.yyx) - base;
            
            vec3 bumpGradient = vec3(dx, dy, dz) / e.x;
            return normalize(baseNormal - bumpGradient * 1.2);
        }

        void main() {
          vec3 V = normalize(uCameraPos - vWorldPos);
          vec3 baseNormal = normalize(vNormal);
          float roughMask = 1.0 - vWindow;

          vec3 N = baseNormal;
          if (roughMask > 0.0) {
              N = calculatePerfectNormal(vWorldPos, baseNormal);
              N = normalize(mix(baseNormal, N, roughMask)); 
          }

          vec2 screenUV = gl_FragCoord.xy / uViewportSize;
          vec2 offset = N.xy * uRefractStrength;
          float disp = uDispersion * roughMask;
          
          vec3 refr = vec3(
            texture2D(uRefractionTex, screenUV + offset * (1.0 - disp)).r,
            texture2D(uRefractionTex, screenUV + offset).g,
            texture2D(uRefractionTex, screenUV + offset * (1.0 + disp)).b
          );

          float thickness = (2.0 - length(vPosition.xz)) * 2.0;
          vec3 iceColor = vec3(0.68, 0.72, 0.78); 
          vec3 absorption = iceColor * exp(-uAbsorption * max(thickness, 0.1));
          if(vWindow > 0.5) absorption = vec3(1.0); 

          vec3 refl = textureCube(uEnvMap, reflect(-V, N)).rgb;
          float rim = 1.0 - max(dot(N, V), 0.0);
          float F0 = pow((1.0 - uIOR) / (1.0 + uIOR), 2.0);
          float F = F0 + (1.0 - F0) * pow(rim, 5.0);
          
          float finalF = mix(F, clamp(F * 1.3, 0.0, 1.0), roughMask);
          vec3 finalColor = mix(refr * absorption, refl, finalF);

          vec3 halfVec = normalize(V + normalize(vec3(0.5, 1.0, 0.5)));
          
          // Apply uPatchScale to the specular highlight mask as well
          float unevenMask = smoothstep(0.3, 0.7, noise3D(vWorldPos * uPatchScale) * 0.5 + 0.5);
          float specPower = mix(300.0, 40.0, unevenMask * roughMask);
          float spec = pow(max(dot(N, halfVec), 0.0), specPower);
          
          float specIntensity = mix(1.0, 2.0, unevenMask * roughMask);
          finalColor += vec3(1.0) * spec * specIntensity;

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