import { CONFIG } from './config.js';

export const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vWorldPos;
  varying vec4 vScreenPos; 
  attribute float aWindow; 
  varying float vWindow; 
  attribute vec3 barycentric; 
  varying vec3 vBarycentric;

  void main() {
    vPosition = position;
    vBarycentric = barycentric; 
    vWindow = aWindow; 
    
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(normalMatrix * normal);
    
    gl_Position = projectionMatrix * viewMatrix * worldPos;
    vScreenPos = gl_Position; 
  }
`;

export const fragmentShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vWorldPos;
  varying vec4 vScreenPos;
  varying float vWindow; 
  varying vec3 vBarycentric;
  
  uniform float uTime;
  uniform sampler2D uSceneTex; 
  
  uniform vec3 uPulseOrigins[${CONFIG.interaction.maxPulses}];
  uniform float uPulseTimers[${CONFIG.interaction.maxPulses}];

  float hash(vec3 p) {
      p = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                     mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                     mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  float getWireframe() {
    float closestEdge = min(vBarycentric.x, min(vBarycentric.y, vBarycentric.z));
    return 1.0 - smoothstep(0.0, 0.02, closestEdge);
  }

  void main() {
    vec3 V = normalize(cameraPosition - vWorldPos);
    
    // 1. THE SAFE NORMAL
    // We strictly use the geometric normal. No math additions! No black holes!
    vec3 N = normalize(vNormal); 
    float NdotV = max(dot(N, V), 0.001);
    float roughMask = 1.0 - vWindow;
    
    // 2. OPTICAL STRIATIONS (Visual Illusion Only)
    float warp = noise(vPosition * 2.5) * 0.4;
    // Map to 0.0 -> 1.0 so we don't calculate negative light
    float striations = sin((vPosition.x + warp) * 50.0) * 0.5 + 0.5;

    // 3. REFRACTION & DISPERSION
    vec2 screenUV = vScreenPos.xy / vScreenPos.w * 0.5 + 0.5;
    
    // We bend the light offset using the normal PLUS the striation pattern.
    // This fakes the physical ridges perfectly without breaking shading.
    vec2 baseOffset = N.xy * ${CONFIG.optics.refractStrength};
    vec2 microOffset = vec2(striations * 0.04 * roughMask);
    vec2 offset = baseOffset + microOffset; 
    
    float disp = ${CONFIG.optics.dispersion} * roughMask; 
    
    // Safely clamp UVs to prevent edge tearing
    vec2 uvR = clamp(screenUV + offset * (1.0 - disp), 0.002, 0.998);
    vec2 uvG = clamp(screenUV + offset, 0.002, 0.998);
    vec2 uvB = clamp(screenUV + offset * (1.0 + disp), 0.002, 0.998);

    vec3 refrColor;
    refrColor.r = texture2D(uSceneTex, uvR).r;
    refrColor.g = texture2D(uSceneTex, uvG).g;
    refrColor.b = texture2D(uSceneTex, uvB).b;

    // 4. HEAVY ABSORPTION
    float distFromAxis = length(vPosition.xz);
    float thickness = max(0.0, 1.3 - distFromAxis); 
    thickness = mix(thickness + (1.0 - NdotV) * 0.5, 0.1, vWindow);
    
    vec3 absorptionCoef = vec3(${CONFIG.optics.absorption.join(',')});
    vec3 transmission = exp(-absorptionCoef * thickness * 2.5); 
    
    vec3 finalCrystal = refrColor * transmission;

    // 5. SEPARATED GLINTS (Magic look)
    vec3 lightDir = normalize(vec3(5.0, 10.0, 10.0));
    vec3 H = normalize(lightDir + V);
    
    // Smooth base shine
    float baseSpec = pow(max(dot(N, H), 0.0), 60.0);
    // Razor sharp ridge shine (multiplied by the striation pattern)
    float ridgeSpec = pow(max(dot(N, H), 0.0), 150.0) * striations * 2.0;
    
    finalCrystal += vec3(1.0) * (baseSpec + ridgeSpec) * roughMask;

    // 6. INTERACTION PULSE
    float waveEffect = 0.0;
    for(int i = 0; i < ${CONFIG.interaction.maxPulses}; i++) {
        float d = distance(vPosition, uPulseOrigins[i]);
        float radius = uPulseTimers[i] * ${CONFIG.interaction.pulseSpeed.toFixed(1)};
        float wave = smoothstep(0.2, 0.0, abs(d - radius));
        float decay = smoothstep(${CONFIG.interaction.pulseDecay.toFixed(1)}, 0.0, radius);
        waveEffect = max(waveEffect, wave * decay);
    }

    float lineBrightness = getWireframe() * waveEffect * 2.5;
    vec3 lineColor = vec3(${CONFIG.colors.skinLine.join(',')});
    finalCrystal += (lineColor * lineBrightness) * roughMask;

    // 7. FRESNEL RIM
    float F0 = pow((1.0 - ${CONFIG.optics.ior}) / (1.0 + ${CONFIG.optics.ior}), 2.0);
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 3.0);
    finalCrystal += vec3(0.6, 0.7, 0.8) * fresnel * 0.5 * roughMask;

    gl_FragColor = vec4(finalCrystal, 1.0);
  }
`;