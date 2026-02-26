import * as THREE from 'three';

// --- 1. 基础辅助函数 ---
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// --- 2. 增强型 SEEDED RNG ---
class RNG {
  constructor(seed) { this.s = seed >>> 0 || 1; }
  next() {
    this.s ^= this.s << 13; this.s ^= this.s >>> 17; this.s ^= this.s << 5;
    return (this.s >>> 0) / 0xFFFFFFFF;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b)   { return Math.floor(this.range(a, b + 1)); }
}

// --- 3. 增强型噪声引擎 (修复 fbm 和 ridged 缺失问题) ---
class NoiseEngine {
  constructor(rng) {
    this.P = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 512; i++) this.P[i] = p[i & 255];
  }
  fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  lerp(a, b, t) { return a + t * (b - a); }
  grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y, v = h < 4 ? y : h === 12 || h === 14 ? x : z;
    return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
  }
  noise(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = this.fade(x), v = this.fade(y), w = this.fade(z);
    const P = this.P;
    const A = P[X]+Y, AA = P[A]+Z, AB = P[A+1]+Z;
    const B = P[X+1]+Y, BA = P[B]+Z, BB = P[B+1]+Z;
    return this.lerp(
      this.lerp(
        this.lerp(this.grad(P[AA], x, y, z),     this.grad(P[BA], x-1, y, z),   u),
        this.lerp(this.grad(P[AB], x, y-1, z),   this.grad(P[BB], x-1, y-1, z), u), v),
      this.lerp(
        this.lerp(this.grad(P[AA+1], x, y, z-1), this.grad(P[BA+1], x-1, y, z-1), u),
        this.lerp(this.grad(P[AB+1], x, y-1, z-1),this.grad(P[BB+1], x-1, y-1,z-1),u), v), w);
  }
  // --- 关键修复：添加 fbm ---
  fbm(x, y, z, oct = 5) {
    let v = 0, a = 0.5, f = 1;
    for (let i = 0; i < oct; i++) { v += a * this.noise(x*f, y*f, z*f); f *= 2.02; a *= 0.5; }
    return v;
  }
  // --- 关键修复：添加 ridged ---
  ridged(x, y, z, oct = 6) {
    let v = 0, a = 0.6, prev = 1, f = 1;
    for (let i = 0; i < oct; i++) {
      let n = Math.abs(this.noise(x*f, y*f, z*f));
      n = (1 - n); n = n * n * prev;
      v += a * n; prev = n; f *= 2.15; a *= 0.38;
    }
    return v;
  }
}

// --- 4. 晶体生长逻辑 ---
export class CrystalGrowthEngine {
  constructor(seed, params) {
    this.seed = seed;
    this.rng = new RNG(seed);
    this.N = new NoiseEngine(this.rng);
    this.p = params;
  }

  generate() {
    this.nucleate();
    this.buildGeometry();
    this.buildTexture();
    return { geometry: this.geometry, texture: this.textureCanvas };
  }

  nucleate() {
    const temp = this.p.temperature || -12;
    const tNorm = (Math.abs(temp) - 1) / 39; 
    const dendriticZone = 1 - Math.abs(tNorm * 2 - 0.5) * 2; 
    this.habitMix = Math.max(0, Math.min(1, dendriticZone * (this.p.anisotropy||0.5) + (this.p.habit||0.5)));
    this.latticeTilt = { x: this.rng.range(-0.15, 0.15), z: this.rng.range(-0.15, 0.15) };
  }

  // simulation.js - update buildGeometry() loop
  buildGeometry() {
    const p = this.p;
    
    // 1. HABIT: Changes the aspect ratio of the base box
    // Low habit = short and fat. High habit = tall and thin.
    const h = p.habit || 0.5;
    const W = 3.5 - (h * 1.5); 
    const H = 2.5 + (h * 2.5); 
    const D = 2.0 - (h * 0.8);

    // Keep segment count moderate so it generates quickly
    const segW = 32, segH = 48, segD = 32; 
    const geo = new THREE.BoxGeometry(W, H, D, segW, segH, segD);
    const pos = geo.attributes.position;
    const N = this.N;
    const windowMaskData = new Float32Array(pos.count);

    const smoothstep = (min, max, value) => {
        const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
        return x * x * (3 - 2 * x);
    };

    // Parameter Modifiers
    let turb = (p.turbulence || 0.22) * 2.5;
    let pitting = (p.pitting || 0.5) * 0.5;
    let tempWobble = Math.abs(p.temperature || -12) / 40.0; 
    let sat = p.supersaturation || 0.35;

    for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);

        // 2. SUPERSATURATION: Shrinks the clear window as it increases
        let isFront = z > 0;
        let windowRadius = 1.0 - (sat * 0.5); 
        let hexDist = Math.max(Math.abs(x), Math.abs(x)*0.5 + Math.abs(y)*0.866);
        let windowMask = isFront ? 1.0 - smoothstep(windowRadius - 0.25, windowRadius + 0.2, hexDist) : 0.0;

        // 3. TURBULENCE & TEMPERATURE: Modifies macro wavy shape
        let shapeNoise = N.fbm(x * turb, y * turb, z * turb, 3);
        let disp = (shapeNoise - 0.5) * (0.1 + tempWobble * 0.4); 
        
        // 4. PITTING: Modifies the depth of the sharp chips
        let rawPit = Math.abs(N.noise(x * 1.8, y * 1.8, z * 1.8));
        let pitNoise = Math.pow(rawPit, 2.0);
        disp -= pitNoise * pitting;

        // Apply displacement radially
        let finalDisp = disp * (1.0 - windowMask); 
        let len = Math.sqrt(x*x + y*y + z*z) || 1;
        
        let newX = x + (x/len) * finalDisp;
        let newY = y + (y/len) * finalDisp;
        let newZ = z + (z/len) * finalDisp;

        // Flatten the clear window
        if (windowMask > 0.0) {
             let targetZ = D/2 + 0.1; 
             newZ = newZ * (1.0 - windowMask) + targetZ * windowMask;
             newX = newX * (1.0 - windowMask) + x * windowMask;
             newY = newY * (1.0 - windowMask) + y * windowMask;
        }

        pos.setXYZ(i, newX, newY, newZ);
        windowMaskData[i] = windowMask;
    }

    geo.computeVertexNormals(); 
    geo.setAttribute('aWindow', new THREE.BufferAttribute(windowMaskData, 1));
    this.geometry = geo;
  }

  buildTexture() {
    const sz = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = sz;
    const ctx = cv.getContext('2d');
    const p = this.p;
    
    const img = ctx.createImageData(sz, sz);
    const d = img.data;
    
    // Generate a grayscale "frost" noise map to feed into the shader
    for (let i = 0; i < d.length; i += 4) {
        const px = (i/4) % sz, py = Math.floor(i/4/sz);
        const turbOffset = this.N.noise(px * 0.05, py * 0.05, 10.0) * ((p.turbulence||0.2) * 20.0);
        const n2 = this.N.noise((px + turbOffset) * 0.02, py * 0.02, 5.0);
        
        // High frequency "cracks" based on supersaturation
        const crack = Math.pow(Math.abs(n2), 3.0) * ((p.supersaturation||0.3) * 2.0);
        let val = Math.max(0, Math.min(255, 128 + crack * 255));
        
        d[i] = d[i+1] = d[i+2] = val; // Grayscale
        d[i+3] = 255; // Alpha
    }
    ctx.putImageData(img, 0, 0);
    this.textureCanvas = cv;
  }

  buildTexture() {
    const sz = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = sz;
    const ctx = cv.getContext('2d');
    const p = this.p;
    
    const img = ctx.createImageData(sz, sz);
    const d = img.data;
    
    // Generate a grayscale "frost" noise map to feed into the shader
    for (let i = 0; i < d.length; i += 4) {
        const px = (i/4) % sz, py = Math.floor(i/4/sz);
        const turbOffset = this.N.noise(px * 0.05, py * 0.05, 10.0) * ((p.turbulence||0.2) * 20.0);
        const n2 = this.N.noise((px + turbOffset) * 0.02, py * 0.02, 5.0);
        
        // High frequency "cracks" based on supersaturation
        const crack = Math.pow(Math.abs(n2), 3.0) * ((p.supersaturation||0.3) * 2.0);
        let val = Math.max(0, Math.min(255, 128 + crack * 255));
        
        d[i] = d[i+1] = d[i+2] = val; // Grayscale
        d[i+3] = 255; // Alpha
    }
    ctx.putImageData(img, 0, 0);
    this.textureCanvas = cv;
  }
}