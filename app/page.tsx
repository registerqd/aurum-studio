"use client";

import dynamic from "next/dynamic";

const MedalWorkbench = dynamic(
  () => import("@/components/medal-workbench").then((mod) => mod.MedalWorkbench),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          display: "grid",
          placeItems: "center",
          height: "100vh",
          backgroundColor: "#070a0f",
          color: "#2ee6c5",
          fontFamily: "ui-monospace, monospace",
          fontSize: "13px",
          letterSpacing: "0.1em",
        }}
      >
        MOLDA STUDIO · INITIALIZING WORKBENCH...
      </div>
    ),
  },
);

export default function Home() {
  return <MedalWorkbench />;
}
