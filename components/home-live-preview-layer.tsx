"use client";

import {
  forwardRef,
  type RefObject,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { buildMedalGroup, disposeObject3D } from "@/lib/model-builder";
import {
  HOME_PREVIEW_INTRO_ROTATION_X,
  HOME_PREVIEW_ROTATION_X,
  HOME_PREVIEW_ROTATION_Y,
  HOME_PREVIEW_SPIN_RADIANS,
  HOME_PREVIEW_ZOOM_DURATION_MS,
} from "@/lib/preview-pose";
import type { WorkDocument } from "@/lib/types";
import { getPrimarySvgAsset } from "@/lib/work-document";

export interface HomePreviewRotation {
  x: number;
  y: number;
}

interface HomeLivePreviewWork {
  id: string;
  updatedAt: string;
}

export interface HomeLivePreviewRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

export interface HomeLivePreviewZoom {
  fromRect: HomeLivePreviewRect;
  phase: "opening" | "closing";
  startedAt: number;
  workId: string;
}

interface HomeLivePreviewLayerProps {
  documents: Record<string, WorkDocument>;
  onReady: (workId: string) => void;
  onUnavailable: () => void;
  preview: HomeLivePreviewZoom | null;
  rotations: Record<string, HomePreviewRotation>;
  viewportRef: RefObject<HTMLDivElement | null>;
  works: HomeLivePreviewWork[];
}

export interface HomeLivePreviewLayerHandle {
  requestRender: () => void;
  setRotation: (workId: string, rotation: HomePreviewRotation) => void;
}

interface PreviewEntry {
  group: THREE.Group;
  introStart: number | null;
  scene: THREE.Scene;
  updatedAt: string;
  wrapper: THREE.Group;
}

interface RendererState {
  camera: THREE.PerspectiveCamera;
  dimCamera: THREE.OrthographicCamera;
  dimGeometry: THREE.PlaneGeometry;
  dimMaterial: THREE.MeshBasicMaterial;
  dimScene: THREE.Scene;
  environment: THREE.Texture;
  pmremGenerator: THREE.PMREMGenerator;
  renderer: THREE.WebGLRenderer;
  roomEnvironment: RoomEnvironment;
}

const INTRO_DURATION = 1250;
const ZOOM_BACKGROUND_DIM_OPACITY = 0.72;
const MAX_DEVICE_PIXEL_RATIO = 2;
const DEFAULT_ROTATION: HomePreviewRotation = {
  x: HOME_PREVIEW_ROTATION_X,
  y: HOME_PREVIEW_ROTATION_Y,
};

function createRendererState(canvas: HTMLCanvasElement): RendererState {
  let renderer: THREE.WebGLRenderer | null = null;
  let pmremGenerator: THREE.PMREMGenerator | null = null;
  let roomEnvironment: RoomEnvironment | null = null;
  let environment: THREE.Texture | null = null;
  let dimScene: THREE.Scene | null = null;
  let dimGeometry: THREE.PlaneGeometry | null = null;
  let dimMaterial: THREE.MeshBasicMaterial | null = null;

  try {
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: "high-performance",
    });
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, -7, 5.2);
    camera.lookAt(0, 0, 0);

    pmremGenerator = new THREE.PMREMGenerator(renderer);
    roomEnvironment = new RoomEnvironment();
    environment = pmremGenerator.fromScene(roomEnvironment).texture;
    dimScene = new THREE.Scene();
    const dimCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
    dimGeometry = new THREE.PlaneGeometry(2, 2);
    dimMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      depthTest: false,
      depthWrite: false,
      opacity: 0,
      transparent: true,
    });
    const dimMesh = new THREE.Mesh(dimGeometry, dimMaterial);
    dimScene.add(dimMesh);

    return {
      camera,
      dimCamera,
      dimGeometry,
      dimMaterial,
      dimScene,
      environment,
      pmremGenerator,
      renderer,
      roomEnvironment,
    };
  } catch (error) {
    dimGeometry?.dispose();
    dimMaterial?.dispose();
    dimScene?.clear();
    environment?.dispose();
    roomEnvironment?.dispose();
    pmremGenerator?.dispose();

    if (renderer) {
      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch {
        // The renderer can be only partially initialized after a WebGL failure.
      }
    }

    throw error;
  }
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function lerp(start: number, end: number, value: number) {
  return start + (end - start) * value;
}

function lerpRect(
  fromRect: HomeLivePreviewRect,
  toRect: HomeLivePreviewRect,
  value: number,
): HomeLivePreviewRect {
  return {
    height: lerp(fromRect.height, toRect.height, value),
    left: lerp(fromRect.left, toRect.left, value),
    top: lerp(fromRect.top, toRect.top, value),
    width: lerp(fromRect.width, toRect.width, value),
  };
}

function getZoomTargetRect(width: number, height: number): HomeLivePreviewRect {
  const size = Math.min(width * 0.8, height * 0.8);

  return {
    height: size,
    left: (width - size) / 2,
    top: (height - size) / 2,
    width: size,
  };
}

function createScene(document: WorkDocument, environment: THREE.Texture) {
  const asset = getPrimarySvgAsset(document);
  const group = buildMedalGroup(asset.text, document.scene.settings);
  const scene = new THREE.Scene();
  const wrapper = new THREE.Group();

  wrapper.rotation.x = HOME_PREVIEW_INTRO_ROTATION_X;
  wrapper.rotation.y = HOME_PREVIEW_ROTATION_Y - HOME_PREVIEW_SPIN_RADIANS;
  wrapper.add(group);
  scene.environment = environment;
  scene.add(wrapper);
  scene.add(new THREE.AmbientLight(0xffffff, 0.62));

  const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(4.5, -5.5, 8);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xffffff, 0.65);
  fillLight.position.set(-5, 3, 4);
  scene.add(fillLight);

  return {
    group,
    introStart: null,
    scene,
    updatedAt: document.document.updatedAt,
    wrapper,
  };
}

function disposeEntry(entry: PreviewEntry) {
  disposeObject3D(entry.group);
  entry.scene.environment = null;
  entry.scene.clear();
}

function isRectVisible(rect: DOMRect, rootRect: DOMRect) {
  return (
    rect.right > rootRect.left &&
    rect.left < rootRect.right &&
    rect.bottom > rootRect.top &&
    rect.top < rootRect.bottom &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function updateCameraAspect(
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
) {
  const aspect = width / height;

  if (Math.abs(camera.aspect - aspect) <= 1e-6) {
    return;
  }

  camera.aspect = aspect;
  camera.updateProjectionMatrix();
}

export const HomeLivePreviewLayer = forwardRef<
  HomeLivePreviewLayerHandle,
  HomeLivePreviewLayerProps
>(function HomeLivePreviewLayer(
  {
    documents,
    onReady,
    onUnavailable,
    preview,
    rotations,
    viewportRef,
    works,
  },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<RendererState | null>(null);
  const entriesRef = useRef<Map<string, PreviewEntry>>(new Map());
  const framesByIdRef = useRef<Map<string, HTMLElement>>(new Map());
  const renderRef = useRef<(now: number) => void>(() => {
    return undefined;
  });
  const renderFrameRef = useRef<number | null>(null);
  const contextLossTimerRef = useRef<number | null>(null);
  const readyWorkIdsRef = useRef<Set<string>>(new Set());
  const worksRef = useRef(works);
  const previewRef = useRef(preview);
  const rotationsRef = useRef(rotations);
  const rotationOverridesRef = useRef<Map<string, HomePreviewRotation>>(
    new Map(),
  );
  const onReadyRef = useRef(onReady);
  const onUnavailableRef = useRef(onUnavailable);
  const workOrderKey = useMemo(
    () => works.map((work) => `${work.id}\t${work.updatedAt}`).join("\n"),
    [works],
  );

  useEffect(() => {
    worksRef.current = works;
  }, [works]);

  const requestRender = useCallback(() => {
    if (renderFrameRef.current !== null) {
      return;
    }

    renderFrameRef.current = window.requestAnimationFrame((now) => {
      renderFrameRef.current = null;
      renderRef.current(now);
    });
  }, []);

  const setRotation = useCallback(
    (workId: string, rotation: HomePreviewRotation) => {
      rotationOverridesRef.current.set(workId, rotation);
      requestRender();
    },
    [requestRender],
  );

  useImperativeHandle(
    ref,
    () => ({ requestRender, setRotation }),
    [requestRender, setRotation],
  );

  useEffect(() => {
    const framesById = new Map<string, HTMLElement>();

    viewportRef.current
      ?.querySelectorAll<HTMLElement>("[data-live-preview-id]")
      .forEach((element) => {
        const workId = element.dataset.livePreviewId;
        if (workId) {
          framesById.set(workId, element);
        }
      });
    framesByIdRef.current = framesById;
    requestRender();
  }, [requestRender, viewportRef, workOrderKey]);

  useEffect(() => {
    previewRef.current = preview;
    requestRender();
  }, [preview, requestRender]);

  useEffect(() => {
    rotationsRef.current = rotations;
    rotationOverridesRef.current.clear();
    requestRender();
  }, [requestRender, rotations]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    onUnavailableRef.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    renderRef.current = (now: number) => {
      const state = stateRef.current;
      const canvas = canvasRef.current;
      const viewport = viewportRef.current;

      if (!state || !canvas || !viewport) {
        return;
      }

      const rootRect = viewport.getBoundingClientRect();
      const width = Math.max(1, rootRect.width);
      const height = Math.max(1, rootRect.height);
      const pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        MAX_DEVICE_PIXEL_RATIO,
      );

      if (
        canvas.width !== Math.round(width * pixelRatio) ||
        canvas.height !== Math.round(height * pixelRatio)
      ) {
        state.renderer.setPixelRatio(pixelRatio);
        state.renderer.setSize(width, height, false);
      }

      const framesById = framesByIdRef.current;

      state.renderer.setScissorTest(false);
      state.renderer.clear();
      state.renderer.setScissorTest(true);

      let needsNextFrame = false;
      const previewState = previewRef.current;

      for (const work of worksRef.current) {
        if (previewState?.workId === work.id) {
          continue;
        }

        const entry = entriesRef.current.get(work.id);
        const frame = framesById.get(work.id);

        if (!entry || !frame) {
          continue;
        }

        const rect = frame.getBoundingClientRect();
        if (!isRectVisible(rect, rootRect)) {
          continue;
        }

        const rotation =
          rotationOverridesRef.current.get(work.id) ??
          rotationsRef.current[work.id] ??
          DEFAULT_ROTATION;
        if (entry.introStart === null) {
          entry.introStart = now;
        }

        const progress = Math.min(
          Math.max((now - entry.introStart) / INTRO_DURATION, 0),
          1,
        );
        const eased = easeOutCubic(progress);

        entry.wrapper.rotation.x = THREE.MathUtils.lerp(
          HOME_PREVIEW_INTRO_ROTATION_X,
          rotation.x,
          eased,
        );
        entry.wrapper.rotation.y =
          rotation.y + THREE.MathUtils.lerp(-HOME_PREVIEW_SPIN_RADIANS, 0, eased);

        if (progress < 1) {
          needsNextFrame = true;
        }

        const left = rect.left - rootRect.left;
        const top = rect.top - rootRect.top;
        const viewportWidth = rect.width;
        const viewportHeight = rect.height;
        const bottom = height - top - viewportHeight;

        updateCameraAspect(state.camera, viewportWidth, viewportHeight);
        state.renderer.setViewport(left, bottom, viewportWidth, viewportHeight);
        state.renderer.setScissor(left, bottom, viewportWidth, viewportHeight);
        state.renderer.clearDepth();
        state.renderer.render(entry.scene, state.camera);

        if (!readyWorkIdsRef.current.has(work.id)) {
          readyWorkIdsRef.current.add(work.id);
          onReadyRef.current(work.id);
        }
      }

      if (previewState) {
        const entry = entriesRef.current.get(previewState.workId);
        const rawProgress = Math.min(
          Math.max(
            (now - previewState.startedAt) / HOME_PREVIEW_ZOOM_DURATION_MS,
            0,
          ),
          1,
        );
        const progress = easeOutCubic(rawProgress);
        const dimOpacity =
          previewState.phase === "opening"
            ? progress * ZOOM_BACKGROUND_DIM_OPACITY
            : (1 - progress) * ZOOM_BACKGROUND_DIM_OPACITY;

        state.renderer.setScissorTest(false);
        state.renderer.setViewport(0, 0, width, height);
        state.dimMaterial.opacity = dimOpacity;
        state.renderer.render(state.dimScene, state.dimCamera);
        state.renderer.setScissorTest(true);

        if (entry) {
          const targetRect = getZoomTargetRect(width, height);
          const rect =
            previewState.phase === "opening"
              ? lerpRect(previewState.fromRect, targetRect, progress)
              : lerpRect(targetRect, previewState.fromRect, progress);
          const rotation =
            rotationOverridesRef.current.get(previewState.workId) ??
            rotationsRef.current[previewState.workId] ?? DEFAULT_ROTATION;
          const spin =
            previewState.phase === "opening"
              ? -HOME_PREVIEW_SPIN_RADIANS * (1 - progress)
              : HOME_PREVIEW_SPIN_RADIANS * progress;

          entry.wrapper.rotation.x = rotation.x;
          entry.wrapper.rotation.y = rotation.y + spin;

          const viewportWidth = rect.width;
          const viewportHeight = rect.height;
          const bottom = height - rect.top - viewportHeight;

          updateCameraAspect(state.camera, viewportWidth, viewportHeight);
          state.renderer.setViewport(
            rect.left,
            bottom,
            viewportWidth,
            viewportHeight,
          );
          state.renderer.setScissor(
            rect.left,
            bottom,
            viewportWidth,
            viewportHeight,
          );
          state.renderer.clearDepth();
          state.renderer.render(entry.scene, state.camera);

          if (rawProgress < 1) {
            needsNextFrame = true;
          }
        }

        state.renderer.setScissorTest(false);

        if (needsNextFrame) {
          requestRender();
        }

        return;
      }

      state.renderer.setScissorTest(false);

      if (needsNextFrame) {
        requestRender();
      }
    };
  }, [requestRender, viewportRef]);

  useEffect(() => {
    const pendingContextLossTimer = contextLossTimerRef.current;
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    let state: RendererState;

    try {
      state = createRendererState(canvas);
    } catch (error) {
      console.warn("Unable to initialize home live previews.", error);
      onUnavailableRef.current();
      return undefined;
    }

    if (pendingContextLossTimer !== null) {
      window.clearTimeout(pendingContextLossTimer);
      if (contextLossTimerRef.current === pendingContextLossTimer) {
        contextLossTimerRef.current = null;
      }
    }

    const {
      camera,
      dimCamera,
      dimGeometry,
      dimMaterial,
      dimScene,
      environment,
      pmremGenerator,
      renderer,
      roomEnvironment,
    } = state;
    stateRef.current = state;
    requestRender();

    const resizeObserver = new ResizeObserver(() => requestRender());
    if (viewportRef.current) {
      resizeObserver.observe(viewportRef.current);
    }

    const entries = entriesRef.current;
    const readyWorkIds = readyWorkIdsRef.current;
    const rotationOverrides = rotationOverridesRef.current;

    return () => {
      resizeObserver.disconnect();
      if (renderFrameRef.current !== null) {
        window.cancelAnimationFrame(renderFrameRef.current);
        renderFrameRef.current = null;
      }

      for (const entry of entries.values()) {
        disposeEntry(entry);
      }
      entries.clear();
      framesByIdRef.current.clear();
      rotationOverrides.clear();
      readyWorkIds.clear();
      dimGeometry.dispose();
      dimMaterial.dispose();
      dimScene.clear();
      environment.dispose();
      roomEnvironment.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      const contextLossTimer = window.setTimeout(() => {
        renderer.forceContextLoss();

        if (contextLossTimerRef.current === contextLossTimer) {
          contextLossTimerRef.current = null;
        }
      }, 0);
      contextLossTimerRef.current = contextLossTimer;
      stateRef.current = null;
    };
  }, [requestRender, viewportRef]);

  useEffect(() => {
    const state = stateRef.current;
    if (!state) {
      return;
    }

    const knownWorkIds = new Set(works.map((work) => work.id));

    for (const [workId, entry] of entriesRef.current.entries()) {
      const document = documents[workId];

      if (
        !knownWorkIds.has(workId) ||
        !document ||
        document.document.updatedAt !== entry.updatedAt
      ) {
        disposeEntry(entry);
        entriesRef.current.delete(workId);
        readyWorkIdsRef.current.delete(workId);
      }
    }

    for (const work of works) {
      const document = documents[work.id];
      if (!document || entriesRef.current.has(work.id)) {
        continue;
      }

      const entry = createScene(document, state.environment);
      entriesRef.current.set(work.id, entry);
    }

    requestRender();
  }, [documents, requestRender, workOrderKey, works]);

  return (
    <div
      className={
        preview ? "home-live-preview-layer zooming" : "home-live-preview-layer"
      }
      aria-hidden="true"
    >
      <canvas ref={canvasRef} />
    </div>
  );
});
