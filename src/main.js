import './style.css';
import Lenis from 'lenis';
import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

// Register GSAP ScrollTrigger
gsap.registerPlugin(ScrollTrigger);

// --- 1. SETUP SMOOTH SCROLLING (Lenis) ---
const lenis = new Lenis();
function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// --- 2. SETUP 3D WORLD (Three.js) ---
const canvasContainer = document.getElementById('canvas-container');
const scene = new THREE.Scene();

// Camera setup
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

// Renderer setup
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); // alpha: true makes background transparent
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
canvasContainer.appendChild(renderer.domElement);

// Create a 3D Object (Icosahedron - a cool geometric shape)
const geometry = new THREE.IcosahedronGeometry(2, 1);
const material = new THREE.MeshNormalMaterial({ wireframe: true }); 
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Handle Window Resize properly
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 3. ANIMATION LOOP ---
function animate() {
  requestAnimationFrame(animate);
  
  // Base continuous slow rotation
  mesh.rotation.x += 0.002;
  mesh.rotation.y += 0.002;

  renderer.render(scene, camera);
}
animate();

// --- 4. SYNC 3D WITH SCROLL (GSAP) ---
// When scrolling to the second section, move the 3D object to the right and scale it
gsap.to(mesh.position, {
  x: 3, // Move right
  z: 1, // Move slightly closer to camera
  scrollTrigger: {
    trigger: ".content", 
    start: "top bottom",
    end: "bottom top",
    scrub: 1, // 'scrub' binds the animation to your scrollbar
  }
});

// Spin the object a full circle based on scroll
gsap.to(mesh.rotation, {
  y: Math.PI * 2, 
  scrollTrigger: {
    trigger: ".content",
    start: "top bottom",
    end: "bottom top",
    scrub: 1,
  }
});