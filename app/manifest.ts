import type { MetadataRoute } from "next";
import { asset } from "@/lib/basePath";

// Lets students install the site to their home screen from Chrome or Safari
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Licensing Bro's",
    short_name: "Licensing Bro's",
    description: "Contractor licensing exam prep: AI tutor, mock exams, games and flashcards for all 50 states.",
    start_url: asset("/app/"),
    scope: asset("/"),
    display: "standalone",
    background_color: "#1d1f1c",
    theme_color: "#1d1f1c",
    icons: [
      { src: asset("/icon-192.png"), sizes: "192x192", type: "image/png" },
      { src: asset("/icon-512.png"), sizes: "512x512", type: "image/png" },
      { src: asset("/icon-maskable-512.png"), sizes: "512x512", type: "image/png", purpose: "maskable" }
    ]
  };
}
