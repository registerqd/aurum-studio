import type { MedalSettings } from "@/lib/types";

export function createCodeSnippet(
  svgText: string,
  settings: MedalSettings,
): string {
  const compactSettings = JSON.stringify(settings, null, 2);

  return `import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment } from "@react-three/drei";
import { buildMedalGroup } from "./lib/model-builder";

const svgText = String.raw\`${svgText.replaceAll("`", "\\`")}\`;
const settings = ${compactSettings};

function MedalModel() {
  const group = buildMedalGroup(svgText, settings);
  return <primitive object={group} />;
}

export function MedalCanvas() {
  return (
    <Canvas camera={{ position: [0, -7, 5], fov: 38 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, -5, 8]} intensity={2} />
      <MedalModel />
      <Environment preset="city" />
      <OrbitControls makeDefault />
    </Canvas>
  );
}`;
}
