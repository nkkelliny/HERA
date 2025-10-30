// /renderer/threeHead.js
import * as THREE from "./libs/three.module.js";
import { GLTFLoader } from "./libs/GLTFLoader.js";

let scene, camera, renderer;
let headRoot, headMesh;
let mouthShapes = {};

const BASE_SCALE = 0.05;
const BASE_Y = 0.89;

let canvasEl;
let hudEl;

// transform state
let currentScale = BASE_SCALE;
let headPos = new THREE.Vector3(-0.05, BASE_Y, 0);
let headRot = { yaw: -3.14, pitch: 1.3 };

// interaction state
let isDragging = false;
let dragMode = "pan"; // pan or rotate
let dragStartScreen = { x: 0, y: 0 };
let dragStartPos = { x: 0, y: 0 };
let dragStartRot = { yaw: 0, pitch: 0 };
let rotateHotkeyDown = false;

const PAN_SENSITIVITY = 0.005;
const ROTATE_SENSITIVITY = 0.005;
const SCALE_STEP = 0.1;

export async function initHead({ canvas }) {
  console.log("[RENDERER] initHead start");

  canvasEl = canvas;
  hudEl = document.getElementById("headDebugHUD");

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(
    35,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    100
  );
  camera.position.set(0, 1.4, 2.2);

  const keyLight = new THREE.DirectionalLight(0xffffff, 2);
  keyLight.position.set(1, 1, 1);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
  fillLight.position.set(-1, 0.5, 1);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 1);
  rimLight.position.set(0, 1, -1);
  scene.add(rimLight);

  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);

  try {
    const loader = new GLTFLoader();
    await new Promise((resolve, reject) => {
      loader.load(
        "../assets/head.glb",
        (gltf) => {
          console.log("[RENDERER] head.glb loaded");

          headRoot = gltf.scene;
          headRoot.scale.set(BASE_SCALE, BASE_SCALE, BASE_SCALE);
          headRoot.position.set(headPos.x, headPos.y, headPos.z);
          headRoot.rotation.set(0, 0, 0);

          scene.add(headRoot);

          headMesh =
            headRoot.getObjectByProperty("type", "SkinnedMesh") ||
            headRoot.getObjectByProperty("type", "Mesh") ||
            headRoot.children[0];

          if (headMesh && headMesh.morphTargetDictionary) {
            mouthShapes = headMesh.morphTargetDictionary;
            console.log("[RENDERER] morph targets:", mouthShapes);
          } else {
            console.warn("[RENDERER] no morphTargetDictionary found");
          }

          resolve();
        },
        undefined,
        (err) => {
          console.error("[RENDERER] failed to load head.glb", err);
          reject(err);
        }
      );
    });
  } catch (e) {
    console.warn("[RENDERER] Using fallback cube instead of HERA head.");

    const geo = new THREE.BoxGeometry(1,1,1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x8844ff });
    headMesh = new THREE.Mesh(geo, mat);

    headRoot = new THREE.Group();
    headRoot.add(headMesh);

    currentScale = BASE_SCALE * 0.7;
    headRoot.scale.set(currentScale, currentScale, currentScale);
    headPos.set(0, BASE_Y + 0.3, 0);
    headRoot.position.set(headPos.x, headPos.y, headPos.z);
    headRoot.rotation.set(0, 0, 0);

    scene.add(headRoot);
  }

  // input controls
  window.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") rotateHotkeyDown = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.key === "r" || e.key === "R") rotateHotkeyDown = false;
  });

  canvasEl.addEventListener("mousedown", (e) => {
    if (e.button === 2 || rotateHotkeyDown) {
      dragMode = "rotate";
    } else {
      dragMode = "pan";
    }

    isDragging = true;
    dragStartScreen.x = e.clientX;
    dragStartScreen.y = e.clientY;
    dragStartPos.x = headPos.x;
    dragStartPos.y = headPos.y;
    dragStartRot.yaw = headRot.yaw;
    dragStartRot.pitch = headRot.pitch;
  });

  window.addEventListener("mouseup", () => {
    isDragging = false;
  });

  canvasEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging || !headRoot) return;

    const dx = e.clientX - dragStartScreen.x;
    const dy = e.clientY - dragStartScreen.y;

    if (dragMode === "pan") {
      headPos.x = dragStartPos.x + dx * PAN_SENSITIVITY;
      headPos.y = dragStartPos.y - dy * PAN_SENSITIVITY;
    } else {
      headRot.yaw   = dragStartRot.yaw   + dx * ROTATE_SENSITIVITY;
      headRot.pitch = dragStartRot.pitch + dy * ROTATE_SENSITIVITY;
      const MAX_PITCH = 0.7;
      headRot.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, headRot.pitch));
    }

    applyTransform();
  });

  canvasEl.addEventListener("wheel", (e) => {
    if (!headRoot) return;
    if (e.deltaY > 0) {
      currentScale = Math.max(0.1, currentScale - SCALE_STEP);
    } else {
      currentScale = currentScale + SCALE_STEP;
    }
    applyTransform();
  });

  function renderFrame() {
    requestAnimationFrame(renderFrame);
    renderer.render(scene, camera);
  }
  renderFrame();

  window.addEventListener("resize", () => {
    camera.aspect = canvas.clientWidth / canvas.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    applyTransform();
  });

  applyTransform();

  console.log("[RENDERER] initHead done");

  return {
    setMouthShape
  };
}

function applyTransform() {
  if (!headRoot) return;

  headRoot.position.set(headPos.x, headPos.y, headPos.z);
  headRoot.rotation.set(headRot.pitch, headRot.yaw, 0);
  headRoot.scale.set(currentScale, currentScale, currentScale);

  updateHUD();
}

function updateHUD() {
  if (!hudEl) return;
  function r(v) { return Number(v).toFixed(2); }

  const posStr = `(${r(headPos.x)}, ${r(headPos.y)}, ${r(headPos.z)})`;
  const rotStr = `pitch ${r(headRot.pitch)} rad, yaw ${r(headRot.yaw)} rad`;
  const scaleStr = `${r(currentScale)}`;

  hudEl.innerText =
    `pos: ${posStr}\nrot: ${rotStr}\nscale: ${scaleStr}`;
}

// animate mouth visemes
function setMouthShape(shapeName, strength) {
  if (!headMesh) return;

  if (headMesh.morphTargetInfluences && headMesh.morphTargetDictionary) {
    for (const s in mouthShapes) {
      const idx = mouthShapes[s];
      headMesh.morphTargetInfluences[idx] = 0;
    }
    if (shapeName && mouthShapes[shapeName] !== undefined) {
      const idx = mouthShapes[shapeName];
      headMesh.morphTargetInfluences[idx] = strength;
    }
  } else {
    // fallback: pulse mesh size
    const base = 1;
    if (!shapeName) {
      headMesh.scale.set(base, base, base);
    } else {
      const bump = base + strength * 0.15;
      headMesh.scale.set(bump, bump, bump);
    }
  }
}

// pick which viseme is "active" at a timestamp
export function driveVisemesFrame(controller, visemes, elapsedSec) {
  let current = null;
  for (let i = 0; i < visemes.length; i++) {
    if (visemes[i].t <= elapsedSec) {
      current = visemes[i];
    } else {
      break;
    }
  }
  if (!current) {
    controller.setMouthShape(null, 0);
  } else {
    controller.setMouthShape(current.shape, current.strength);
  }
}
