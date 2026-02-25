import { CONFIG } from './config.js';

export const vertexShader = `
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vWorldPos;
  varying vec4 vScreenPos; 
  
  attribute float aDisp; 
  varying float vDisp; // Depth of the ridges

  attribute vec3 barycentric; 
  varying vec3 vBarycentric;

  void main() {
    vPosition = position;
    vBarycentric = barycentric; 
    vDisp = aDisp; 
    
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
  varying float vDisp; 
  varying vec3 vBarycentric;
  
  uniform float uTime;
  uniform sampler2D uSceneTex; 
  
  uniform vec3 uPulseOrigins[${CONFIG.interaction.maxPulses}];
  uniform float uPulseTimers[${CONFIG.interaction.maxPulses}];

  float getWireframe() {
    float closestEdge = min(vBarycentric.x, min(vBarycentric.y, vBarycentric.z));
    return 1.0 - smoothstep(0.0, 0.008, closestEdge);
  }

  void main() {
    // 1. PERTURB NORMAL (The Key Fix)
    // Instead of painting color, we warp the normal based on the ridge depth.
    // This creates physical light bending at the edges of the lines.
    vec3 N = normalize(vNormal);
    N.x += vDisp * 2.0; // Warp normal horizontally based on ridge depth
    N = normalize(N);

    vec3 V = normalize(cameraPosition - vWorldPos);
    float NdotV = max(dot(N, V), 0.0);

    float isWindow = smoothstep(0.95, 1.0, vNormal.z); // Use original normal for window detection

    // 2. REFRACTION & DISPERSION
    float ior = ${CONFIG.optics.ior};
    vec2 screenUV = (vScreenPos.xy / vScreenPos.w) * 0.5 + 0.5;
    
    // The ridges cause MORE refraction distortion
    float activeRefract = ${CONFIG.optics.refractStrength} * (1.0 - isWindow);
    // Add ridge depth to refraction offset
    vec2 offset = (N.xy + vec2(vDisp * 5.0, 0.0)) * activeRefract; 

    float disp = ${CONFIG.optics.dispersion} * (1.0 - isWindow);
    
    vec3 refrColor;
    refrColor.r = texture2D(uSceneTex, screenUV + offset * (1.0 - disp)).r;
    refrColor.g = texture2D(uSceneTex, screenUV + offset).g;
    refrColor.b = texture2D(uSceneTex, screenUV + offset * (1.0 + disp)).b;

    // 3. INTERNAL ABSORPTION (Natural Darkening)
    float distFromAxis = length(vPosition.xz);
    float coreMask = smoothstep(1.5, 0.0, distFromAxis) * (1.0 - isWindow * 0.9); 
    
    // Valleys (negative vDisp) act thicker, absorbing more light -> darker
    float thickness = (1.0 / max(NdotV, 0.1)) * 0.5 + coreMask * 3.0 - (vDisp * 10.0);
    
    vec3 absorptionCoef = vec3(${CONFIG.optics.absorption.join(',')});
    vec3 tint = vec3(0.9, 0.95, 1.0) * exp(-absorptionCoef * thickness);

    vec3 physicalIce = refrColor * tint;

    // 4. SPECULAR HIGHLIGHTS (Diamond Sparkle)
    vec3 lightDir = normalize(vec3(5.0, 10.0, 10.0));
    vec3 H = normalize(lightDir + V);
    
    // Sharp specular on the ridge edges
    float spec = pow(max(dot(N, H), 0.0), 128.0);
    
    // Glints appear on the high points of the ridges
    physicalIce += vec3(1.0) * spec * (1.0 - isWindow) * 1.5;

    // 5. FRESNEL RIM
    float F0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
    float fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);
    physicalIce = mix(physicalIce, vec3(0.9, 0.95, 1.0), fresnel * 0.6);

    // 6. WAVES
    float totalWave = 0.0;
    for(int i = 0; i < ${CONFIG.interaction.maxPulses}; i++) {
        float d = distance(vPosition, uPulseOrigins[i]);
        float radius = uPulseTimers[i] * ${CONFIG.interaction.pulseSpeed.toFixed(1)};
        float wave = smoothstep(0.4, 0.0, abs(d - radius));
        float decay = smoothstep(${CONFIG.interaction.pulseDecay.toFixed(1)}, 0.0, radius);
        totalWave += wave * decay;
    }
    float glow = clamp(totalWave, 0.0, 1.2);

    // 7. TRIANGLE SKIN
    float wireframe = getWireframe();
    float lineBrightness = (wireframe * 0.01 + wireframe * glow * 1.5) * (1.0 - isWindow);
    vec3 lineColor = vec3(${CONFIG.colors.skinLine.join(',')});

    vec3 finalColor = physicalIce + (lineColor * lineBrightness);
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;