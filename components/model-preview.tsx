"use client";

import { ContactShadows, OrbitControls } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { LocalRoomEnvironment } from "@/components/local-room-environment";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import {
  buildMedalGroup,
  disposeObject3D,
  updateMedalGroupHighlight,
} from "@/lib/model-builder";
import {
  HOME_PREVIEW_ROTATION_X,
  HOME_PREVIEW_ROTATION_Y,
} from "@/lib/preview-pose";
import type { MedalSettings } from "@/lib/types";

interface ModelPreviewProps {
  isLayoutTransitioning?: boolean;
  svgText: string;
  settings: MedalSettings;
  highlightedPathIndex: number | null;
}

interface ModelBuildInput {
  settings: MedalSettings;
  svgText: string;
}

function MedalModel({
  svgText,
  settings,
  highlightedPathIndex,
}: ModelPreviewProps) {
  const invalidate = useThree((state) => state.invalidate);
  const group = useMemo(
    () => buildMedalGroup(svgText, settings),
    [settings, svgText],
  );

  useEffect(() => {
    updateMedalGroupHighlight(group, highlightedPathIndex);
    invalidate();
  }, [group, highlightedPathIndex, invalidate]);

  useEffect(() => {
    return () => disposeObject3D(group);
  }, [group]);

  return <primitive object={group} />;
}

function AnimatedCameraResizer({ active }: { active: boolean }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    if (!active) return undefined;
    const element = gl.domElement.closest(".model-preview-slot");
    if (!element) return undefined;
    let frame = 0;

    const resize = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (camera instanceof THREE.PerspectiveCamera) {
            camera.aspect = rect.width / rect.height;
            camera.updateProjectionMatrix();
          }
          invalidate();
        }
      });
    };

    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [active, camera, gl, invalidate]);

  return null;
}

function FloorGrid() {
  return (
    <gridHelper
      args={[8, 16, "#4a5462", "#242d38"]}
      position={[0, 0, -0.56]}
      rotation={[Math.PI / 2, 0, 0]}
    />
  );
}

function CanvasSettingsInvalidator({
  backgroundColor,
  showGrid,
  showShadows,
}: {
  backgroundColor: string;
  showGrid: boolean;
  showShadows: boolean;
}) {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
    const frame = window.requestAnimationFrame(() => invalidate());
    return () => window.cancelAnimationFrame(frame);
  }, [backgroundColor, invalidate, showGrid, showShadows]);

  return null;
}

export function ModelPreview(props: ModelPreviewProps) {
  const modelSettings = useMemo<MedalSettings>(
    () => ({
      modelSize: props.settings.modelSize,
      canvas: DEFAULT_SETTINGS.canvas,
      dome: props.settings.dome,
      quality: props.settings.quality,
      shapeSettings: props.settings.shapeSettings,
    }),
    [
      props.settings.dome,
      props.settings.modelSize,
      props.settings.quality,
      props.settings.shapeSettings,
    ],
  );
  const [buildInput, setBuildInput] = useState<ModelBuildInput>(
    () => ({
      settings: modelSettings,
      svgText: props.svgText,
    }),
  );
  const latestBuildInputRef = useRef<ModelBuildInput>(buildInput);
  const buildFrameRef = useRef<number | null>(null);

  useEffect(() => {
    latestBuildInputRef.current = {
      settings: modelSettings,
      svgText: props.svgText,
    };

    if (buildFrameRef.current !== null) {
      return;
    }

    buildFrameRef.current = window.requestAnimationFrame(() => {
      buildFrameRef.current = null;
      const nextInput = latestBuildInputRef.current;
      setBuildInput((current) =>
        current.settings === nextInput.settings &&
        current.svgText === nextInput.svgText
          ? current
          : nextInput,
      );
    });
  }, [modelSettings, props.svgText]);

  useEffect(
    () => () => {
      if (buildFrameRef.current !== null) {
        window.cancelAnimationFrame(buildFrameRef.current);
        // Strict Mode replays this cleanup before mounting the effect again.
        buildFrameRef.current = null;
      }
    },
    [],
  );

  const shadowKey = useMemo(
    () => `${buildInput.svgText}\n${JSON.stringify(buildInput.settings)}`,
    [buildInput],
  );

  return (
    <div className="canvas-wrap">
      <Canvas
        camera={{ position: [0, -7, 5.2], fov: 38 }}
        dpr={[1, 2]}
        frameloop={props.isLayoutTransitioning ? "always" : "demand"}
        gl={{ antialias: true }}
        resize={{ offsetSize: true }}
        shadows={props.settings.canvas.showShadows}
        style={{ height: "100%", width: "100%" }}
      >
        <CanvasSettingsInvalidator
          backgroundColor={props.settings.canvas.backgroundColor}
          showGrid={props.settings.canvas.showGrid}
          showShadows={props.settings.canvas.showShadows}
        />
        <color attach="background" args={[props.settings.canvas.backgroundColor]} />
        <ambientLight intensity={0.62} />
        <directionalLight
          intensity={2.2}
          position={[4.5, -5.5, 8]}
        />
        <directionalLight intensity={0.65} position={[-5, 3, 4]} />
        <AnimatedCameraResizer active={Boolean(props.isLayoutTransitioning)} />
        <group rotation={[HOME_PREVIEW_ROTATION_X, HOME_PREVIEW_ROTATION_Y, 0]}>
          <MedalModel
            highlightedPathIndex={props.highlightedPathIndex}
            settings={buildInput.settings}
            svgText={buildInput.svgText}
          />
        </group>
        <LocalRoomEnvironment />
        {props.settings.canvas.showShadows ? (
          <ContactShadows
            frames={1}
            key={shadowKey}
            opacity={0.34}
            position={[0, 0, -0.54]}
            scale={8}
            blur={2.4}
            far={4}
          />
        ) : null}
        {props.settings.canvas.showGrid ? <FloorGrid /> : null}
        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          minDistance={2.5}
          maxDistance={12}
        />
      </Canvas>
    </div>
  );
}
