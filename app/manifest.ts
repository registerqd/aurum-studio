import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MOLDA",
    short_name: "MOLDA",
    description: "Turn SVG and bitmap artwork into printable 3D medals.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#04121a",
    theme_color: "#04121a",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
