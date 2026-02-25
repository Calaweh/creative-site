import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass }from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { CONFIG } from './config.js';
import { vertexShader, fragmentShader } from './shaders.js';
import { createIceShard } from './geometry.js';

const canvasContainer = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(CONFIG.scene.bgColor, 0.015); 

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, CONFIG.scene.cameraZ);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
const dpr = Math.min(window.devicePixelRatio, 2);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(dpr);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(CONFIG.scene.bgColor, 1);
canvasContainer.appendChild(renderer.domElement);

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// Refraction Target
const renderTarget = new THREE.WebGLRenderTarget(
  window.innerWidth * dpr, 
  window.innerHeight * dpr, 
  { format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
);

// Uniforms
const pulseOrigins = new Float32Array(CONFIG.interaction.maxPulses * 3);
const pulseTimers = new Float32Array(CONFIG.interaction.maxPulses).fill(100.0);

const uniforms = {
  uTime:         { value: 0.0 },
  uSceneTex:     { value: null },
  uPulseOrigins: { value: pulseOrigins }, 
  uPulseTimers:  { value: pulseTimers },
};

// Objects
const mainGroup = new THREE.Group();
scene.add(mainGroup);

// 1. Core
const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.3 });
const coreMesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.2), coreMat);
mainGroup.add(coreMesh);

// 2. Ice
const shardGeo = createIceShard();
const shardMat = new THREE.ShaderMaterial({
  vertexShader, fragmentShader, uniforms, transparent: true, side: THREE.DoubleSide
});
const iceShard = new THREE.Mesh(shardGeo, shardMat);
mainGroup.add(iceShard);

// 3. Background Dust (Crucial for refraction visibility!)
const dustGeo = new THREE.BufferGeometry();
const count = 1000;
const dustPos = new Float32Array(count * 3);
for(let i=0; i<count*3; i++) dustPos[i] = (Math.random() - 0.5) * 25;
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.04, transparent: true, opacity: 0.4 });
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

mainGroup.rotation.x = 0.1;
mainGroup.rotation.y = 0.3;

// Post-Processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), CONFIG.bloom.strength, CONFIG.bloom.radius, CONFIG.bloom.threshold);
composer.addPass(bloom);

// Interaction
const targetRot = { x: 0.1, y: 0.3 };
let lastPulse = new THREE.Vector3(0,0,0), pulseIdx = 0;

window.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
  targetRot.y = 0.3 + mouse.x * 0.1; targetRot.x = 0.1 - mouse.y * 0.1;

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObject(iceShard);
  if (hits.length > 0) {
    const p = iceShard.worldToLocal(hits[0].point.clone());
    if (p.distanceTo(lastPulse) > 0.25) { 
      lastPulse.copy(p);
      uniforms.uPulseOrigins.value.set([p.x, p.y, p.z], pulseIdx * 3);
      uniforms.uPulseTimers.value[pulseIdx] = 0.0;
      pulseIdx = (pulseIdx + 1) % CONFIG.interaction.maxPulses;
    }
  }
});

function animate() {
  requestAnimationFrame(animate);
  uniforms.uTime.value += 0.01;
  for(let i=0; i<CONFIG.interaction.maxPulses; i++) uniforms.uPulseTimers.value[i] += 0.01;

  mainGroup.rotation.x += (targetRot.x - mainGroup.rotation.x) * 0.05;
  mainGroup.rotation.y += (targetRot.y - mainGroup.rotation.y) * 0.05;
  mainGroup.position.y = Math.sin(uniforms.uTime.value * 0.5) * 0.05;
  
  coreMesh.rotation.y = uniforms.uTime.value * 0.2;
  coreMesh.rotation.x = Math.sin(uniforms.uTime.value * 0.3) * 0.1;
  dust.rotation.y += 0.001;

  // Refraction Pass
  iceShard.visible = false;
  renderer.setRenderTarget(renderTarget);
  renderer.clear();
  renderer.render(scene, camera);
  
  // Main Pass
  iceShard.visible = true;
  uniforms.uSceneTex.value = renderTarget.texture;
  renderer.setRenderTarget(null);
  
  composer.render();
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  renderTarget.setSize(window.innerWidth * dpr, window.innerHeight * dpr);
});