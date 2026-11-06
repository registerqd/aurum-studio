"use client";

import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildMedalGroup, disposeObject3D } from "@/lib/model-builder";
import {
  HOME_PREVIEW_ROTATION_X,
  HOME_PREVIEW_ROTATION_Y,
} from "@/lib/preview-pose";
import {
  getSnapshotSourceSignature,
  SNAPSHOT_HEIGHT,
  SNAPSHOT_WIDTH,
} from "@/lib/snapshot-metadata";
import type { WorkDocument, WorkSnapshot } from "@/lib/types";
import { getPrimarySvgAsset } from "@/lib/work-document";

const SNAPSHOT_CAMERA_FOV = 38;
const SNAPSHOT_RESOURCE_IDLE_MS = 30_000;

interface SnapshotRenderResources {
  canvas: HTMLCanvasElement;
  environment: THREE.WebGLRenderTarget;
  pmremGenerator: THREE.PMREMGenerator;
  renderer: THREE.WebGLRenderer;
  roomEnvironment: RoomEnvironment;
}

let sharedResources: SnapshotRenderResources | null = null;
let snapshotRenderQueue = Promise.resolve();
let hasPageHideListener = false;
let idleDisposalTimer: number | null = null;
let queuedRenderCount = 0;

export {
  getSnapshotSourceSignature,
  needsSnapshot,
  SNAPSHOT_HEIGHT,
  SNAPSHOT_RENDER_VERSION,
  SNAPSHOT_WIDTH,
} from "@/lib/snapshot-metadata";

export function generateWorkSnapshot(
  document: WorkDocument,
): Promise<WorkSnapshot> {
  cancelIdleDisposal();
  queuedRenderCount += 1;
  const pending = snapshotRenderQueue.then(
    () => renderWorkSnapshot(document),
    () => renderWorkSnapshot(document),
  );

  snapshotRenderQueue = pending.then(
    finishQueuedRender,
    finishQueuedRender,
  );

  return pending;
}

function finishQueuedRender() {
  queuedRenderCount = Math.max(0, queuedRenderCount - 1);

  if (queuedRenderCount === 0) {
    scheduleIdleDisposal();
  }
}

async function renderWorkSnapshot(
  document: WorkDocument,
): Promise<WorkSnapshot> {
  const resources = getSnapshotRenderResources();
  const { canvas, environment, renderer } = resources;
  const scene = new THREE.Scene();
  scene.environment = environment.texture;
  const asset = getPrimarySvgAsset(document);
  const group = buildMedalGroup(asset.text, document.scene.settings);
  let key: THREE.DirectionalLight | null = null;

  try {
    group.rotation.set(HOME_PREVIEW_ROTATION_X, HOME_PREVIEW_ROTATION_Y, 0);
    group.updateMatrixWorld(true);
    tuneSnapshotMaterials(group);
    scene.add(group);

    const ambient = new THREE.AmbientLight(0xffffff, 0.9);
    key = new THREE.DirectionalLight(0xffffff, 3.05);
    key.position.set(4.5, -5.5, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.00014;
    key.shadow.normalBias = 0.018;
    key.shadow.radius = 3.5;
    const fill = new THREE.DirectionalLight(0xffffff, 1.16);
    fill.position.set(-5, 3, 4);
    const rim = new THREE.DirectionalLight(0xffffff, 0.68);
    rim.position.set(-3.5, 4.4, 3.4);
    const keyTarget = new THREE.Object3D();
    scene.add(ambient, key, fill, rim, keyTarget);

    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    keyTarget.position.copy(center);
    key.target = keyTarget;

    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const cameraDistance =
      (Math.max(sphere.radius, 0.1) /
        Math.sin(THREE.MathUtils.degToRad(SNAPSHOT_CAMERA_FOV) / 2)) *
      0.78;
    const cameraDirection = new THREE.Vector3(0, -7, 5.2).normalize();
    const camera = new THREE.PerspectiveCamera(
      SNAPSHOT_CAMERA_FOV,
      SNAPSHOT_WIDTH / SNAPSHOT_HEIGHT,
      0.01,
      Math.max(cameraDistance + sphere.radius * 4, 100),
    );
    camera.position
      .copy(center)
      .add(cameraDirection.multiplyScalar(cameraDistance));
    camera.up.set(0, 1, 0);
    camera.lookAt(center.x, center.y, center.z);
    camera.updateProjectionMatrix();
    const shadowExtent = Math.max(size.x, size.y, 1) * 0.64;
    key.shadow.camera.left = -shadowExtent;
    key.shadow.camera.right = shadowExtent;
    key.shadow.camera.top = shadowExtent;
    key.shadow.camera.bottom = -shadowExtent;
    key.shadow.camera.near = 0.01;
    key.shadow.camera.far = 24;
    key.shadow.camera.updateProjectionMatrix();

    renderer.render(scene, camera);
    const dataUrl = await canvasToDataUrl(canvas);

    return {
      id: "snapshot_front_png",
      kind: "model-front-png",
      mediaType: "image/png",
      width: SNAPSHOT_WIDTH,
      height: SNAPSHOT_HEIGHT,
      dataUrl,
      sourceSignature: getSnapshotSourceSignature(document),
      createdAt: new Date().toISOString(),
    };
  } finally {
    scene.clear();
    key?.shadow.map?.dispose();
    disposeObject3D(group);
  }
}

function getSnapshotRenderResources() {
  if (sharedResources) {
    return sharedResources;
  }

  const canvas = document.createElement("canvas");
  canvas.width = SNAPSHOT_WIDTH;
  canvas.height = SNAPSHOT_HEIGHT;
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    canvas,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(SNAPSHOT_WIDTH, SNAPSHOT_HEIGHT, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const roomEnvironment = new RoomEnvironment();
  const environment = pmremGenerator.fromScene(roomEnvironment, 0.04);

  sharedResources = {
    canvas,
    environment,
    pmremGenerator,
    renderer,
    roomEnvironment,
  };

  if (!hasPageHideListener) {
    window.addEventListener("pagehide", disposeSnapshotRenderResources);
    hasPageHideListener = true;
  }

  return sharedResources;
}

function disposeSnapshotRenderResources() {
  cancelIdleDisposal();

  if (!sharedResources) {
    return;
  }

  const resources = sharedResources;
  sharedResources = null;
  resources.environment.dispose();
  resources.pmremGenerator.dispose();
  resources.roomEnvironment.dispose();
  resources.roomEnvironment.clear();
  resources.renderer.dispose();
  resources.renderer.forceContextLoss();
}

function scheduleIdleDisposal() {
  cancelIdleDisposal();
  idleDisposalTimer = window.setTimeout(() => {
    idleDisposalTimer = null;

    if (queuedRenderCount === 0) {
      disposeSnapshotRenderResources();
    }
  }, SNAPSHOT_RESOURCE_IDLE_MS);
}

function cancelIdleDisposal() {
  if (idleDisposalTimer === null) {
    return;
  }

  window.clearTimeout(idleDisposalTimer);
  idleDisposalTimer = null;
}

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  return new Promise<string>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to encode snapshot"));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read snapshot"));
      reader.onload = () => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }

        reject(new Error("Unable to read snapshot"));
      };
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

function tuneSnapshotMaterials(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.envMapIntensity = 1.55;
        material.needsUpdate = true;
      }
    }
  });
}
