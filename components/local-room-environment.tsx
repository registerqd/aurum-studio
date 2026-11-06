"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

export function LocalRoomEnvironment() {
  const getThreeState = useThree((state) => state.get);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const { gl, scene } = getThreeState();
    const previousEnvironment = scene.environment;
    const generator = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const renderTarget = generator.fromScene(room, 0.04);

    room.dispose();
    room.clear();
    generator.dispose();
    scene.environment = renderTarget.texture;
    invalidate();

    return () => {
      if (scene.environment === renderTarget.texture) {
        scene.environment = previousEnvironment;
      }
      renderTarget.dispose();
      invalidate();
    };
  }, [getThreeState, invalidate]);

  return null;
}
