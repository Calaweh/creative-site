export const CONFIG = {
  scene: {
    bgColor: 0xa6b0bd,
    cameraZ: 8.5,
  },
  bloom: {
    strength: 0.5, // Increased slightly to catch the new sharp edges
    radius: 0.4,
    threshold: 0.85, 
  },
  iceShape: {
    detailX: 100,             
    detailY: 200, // Very high vertical resolution required
    detailZ: 100,
    width: 2.0,            
    height: 5.2,            
    depth: 2.0,           
    
    // NEW: PHYSICAL RIDGE PARAMETERS
    ridgeScale: 2.5,        // How clustered the lines are
    ridgeDensity: 15.0,     // Vertical stretching (High = long lines)
    ridgeDepth: 0.08,       // Physical depth of the cuts
    
    fractureScale: 1.3,        
    windowSize: 0.9,          
  },
  optics: {
    ior: 1.31,              
    refractStrength: 0.4,   
    dispersion: 0.04,       
    absorption: [0.6, 0.2, 0.05] // Deep Blue/Green absorption
  },
  colors: {
    skinLine:[0.3, 0.9, 1.0], 
  },
  interaction: {
    maxPulses: 40,          
    pulseSpeed: 2.0,        
    pulseDecay: 6.0,        
    spawnDistance: 0.15,     
    timerSpeed: 0.01,      
    rotationLerp: 0.05      
  }
};