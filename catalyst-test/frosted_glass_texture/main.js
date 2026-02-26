import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui'; 
import { Catalyst } from './catalyst.js';

// --- Scene Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 5, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// --- Environment ---
const loader = new THREE.CubeTextureLoader();
const envMap = loader.load([
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Park2/posx.jpg',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Park2/negx.jpg',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Park2/posy.jpg',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Park2/negy.jpg',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Park2/posz.jpg',
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/cube/Park2/negz.jpg',
]);
scene.background = new THREE.Color('#a1a7b3'); // Muted Grey-Blue 
scene.environment = envMap; // Still applies lighting/reflections globally

// --- State Management ---
const specimens = []; 
let selectedCatalyst = null; 
let extractedPenTex = null; 
let isDrawing = false;

const params = {
    seed: 42,
    temperature: -12,
    pitting: 0.5,
    // --- 补全缺失的参数 ---
    supersaturation: 0.35,
    habit: 0.5,
    turbulence: 0.22,
    // ----------------------
    uIOR: 1.31,
    uRefractStrength: 0.12,
    uDispersion: 0.018,
    uAbsorption: 0.05,
    autoRotate: true
};

// --- Functions ---

function spawnNew() {
    const seed = Math.random() * 9999;
    // Clone global params so the new object has its own data
    const localParams = { ...params }; 
    const cat = new Catalyst(seed, localParams, extractedPenTex);
    
    const group = cat.getObject();
    group.position.x = (specimens.length % 3 - 1) * 5;
    group.position.z = Math.floor(specimens.length / 3) * -5;
    
    scene.add(group);
    cat.setupRefraction(renderer, camera, envMap);
    
    // Explicitly link the mesh back to the catalyst instance for raycasting
    cat.mesh.parentCatalyst = cat; 
    specimens.push(cat);

    // Auto-select the new one
    selectSpecimen(cat);
}

function selectSpecimen(instance) {
    if (!instance) return;
    selectedCatalyst = instance;
    specimens.forEach(s => s.material.uniforms.uIsSelected.value = 0.0);
    selectedCatalyst.material.uniforms.uIsSelected.value = 1.0;
    
    syncGUIWithSelection(); // Replaces direct assignments
}

function refreshGUI() {
    // Force all folders to update their display based on the 'params' values we just updated
    selectionFolder.controllers.forEach(c => c.updateDisplay());
    selectionMatFolder.controllers.forEach(c => c.updateDisplay());
}

// --- Event Listeners ---

window.addEventListener('mousedown', (e) => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObjects(specimens.map(s => s.mesh));

    if (intersects.length > 0) {
        const hit = intersects[0];
        const cat = hit.object.parentCatalyst;

        if (e.altKey) {
            // EXTRACT mode
            extractedPenTex = cat.surfaceTexture;
            console.log("Texture Extracted!");
        } else {
            // SELECT mode
            selectSpecimen(cat);
            isDrawing = true;
        }
    }
});

window.addEventListener('mousemove', (e) => {
    if (!isDrawing || !extractedPenTex || !selectedCatalyst) return;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const intersects = raycaster.intersectObject(selectedCatalyst.mesh);
    if (intersects.length > 0) {
        // PAINT extracted DNA onto selected object
        selectedCatalyst.material.uniforms.uSourceTex.value = extractedPenTex;
        selectedCatalyst.material.uniforms.uHasSource.value = 1.0;
        selectedCatalyst.paint(intersects[0].uv);
    }
});

window.addEventListener('mouseup', () => { isDrawing = false; });

// --- GUI Setup ---
const gui = new GUI({ title: "Catalyst Workspace" });
gui.add({ spawn: spawnNew }, 'spawn').name("✚ ADD SPECIMEN");
gui.add({ clear: () => { specimens.forEach(s => scene.remove(s.getObject())); specimens.length = 0; } }, 'clear').name("✖ CLEAR ALL");

// SELECTED OBJECT FOLDERS
const selectionFolder = gui.addFolder("Selected: Shape");
const selectionMatFolder = gui.addFolder("Selected: Texture");

let rebuildTimer = null;
function debouncedRebuild() {
    if(rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
        if(selectedCatalyst) selectedCatalyst.rebuild();
    }, 150);
}

// 1. Shape Parameters (Using .onChange + Debounce)
selectionFolder.add(params, 'seed', 0, 9999).onChange(v => {
    if(selectedCatalyst) { selectedCatalyst.seed = v; debouncedRebuild(); }
});
selectionFolder.add(params, 'temperature', -40, -1).onChange(v => {
    if(selectedCatalyst) { selectedCatalyst.params.temperature = v; debouncedRebuild(); }
});
selectionFolder.add(params, 'supersaturation', 0, 1).onChange(v => {
    if(selectedCatalyst) { selectedCatalyst.params.supersaturation = v; debouncedRebuild(); }
});
selectionFolder.add(params, 'habit', 0, 1).onChange(v => {
    if(selectedCatalyst) { selectedCatalyst.params.habit = v; debouncedRebuild(); }
});
selectionFolder.add(params, 'turbulence', 0, 1).onChange(v => {
    if(selectedCatalyst) { selectedCatalyst.params.turbulence = v; debouncedRebuild(); }
});
selectionFolder.add(params, 'pitting', 0, 1).onChange(v => {
    if(selectedCatalyst) { selectedCatalyst.params.pitting = v; debouncedRebuild(); }
});

// 2. Texture Parameters (Update Uniforms directly - instant effect)
selectionMatFolder.add(params, 'uIOR', 1.0, 2.5).onChange(v => {
    if(selectedCatalyst) selectedCatalyst.material.uniforms.uIOR.value = v;
});
selectionMatFolder.add(params, 'uDispersion', 0, 0.1).onChange(v => {
    if(selectedCatalyst) selectedCatalyst.material.uniforms.uDispersion.value = v;
});
selectionMatFolder.add(params, 'uAbsorption', 0, 0.5).onChange(v => {
    if(selectedCatalyst) selectedCatalyst.material.uniforms.uAbsorption.value = v;
});

gui.add(params, 'autoRotate');

function syncGUIWithSelection() {
    if (!selectedCatalyst) return;

    params.seed = selectedCatalyst.seed;
    params.temperature = selectedCatalyst.params.temperature;
    params.pitting = selectedCatalyst.params.pitting;
    params.supersaturation = selectedCatalyst.params.supersaturation;
    params.habit = selectedCatalyst.params.habit;
    params.turbulence = selectedCatalyst.params.turbulence;

    params.uIOR = selectedCatalyst.material.uniforms.uIOR.value;
    params.uDispersion = selectedCatalyst.material.uniforms.uDispersion.value;
    params.uAbsorption = selectedCatalyst.material.uniforms.uAbsorption.value;

    selectionFolder.controllers.forEach(c => c.updateDisplay());
    selectionMatFolder.controllers.forEach(c => c.updateDisplay());
}

// --- Main Loop ---
function animate() {
    requestAnimationFrame(animate);
    const time = performance.now() * 0.001;
    controls.update();

    specimens.forEach(cat => {
        if (params.autoRotate) cat.getObject().rotation.y += 0.005;
        cat.update(renderer, camera, time);
    });

    renderer.render(scene, camera);
}

// Initial Spawn
spawnNew();
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});