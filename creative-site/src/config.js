export const CONFIG = {
  scene: {
    bgColor: 0x8c94a0, 
    cameraZ: 8.5,
  },
  bloom: {
    strength: 1.0,
    radius: 0.4,
    threshold: 0.75, 
  },
  geometry: {
    // Note: Resolution is now automatic (Icosahedron)
    width: 2.5,            
    height: 5.0,            
    depth: 2.2,           
    windowSize: 0.8,          
  },
  optics: {
    ior: 1.65,              
    refractStrength: 0.3,   // Cleaner refraction
    dispersion: 0.08,       // Stronger rainbows
    absorption:[1.5, 1.1, 0.8] 
  },
  colors: {
    skinLine:[0.5, 0.8, 1.0], 
  },
  interaction: {
    maxPulses: 60,          
    pulseSpeed: 1.5,        
    pulseDecay: 3.5,        
    spawnDistance: 0.5,     
    timerSpeed: 0.01,      
    rotationLerp: 0.05      
  }
};