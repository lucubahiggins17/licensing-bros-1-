import type { CapacitorConfig } from "@capacitor/cli";

// The whole app is bundled inside the APK (built from the project root with NEXT_PUBLIC_TARGET=app).
// Practice exams, games, flashcards and calculators work offline; sign-in, syncing and the AI tutor
// connect to your Supabase project over the internet.
const config: CapacitorConfig = {
  appId: "com.licensingbros.app",
  appName: "Licensing Bro's",
  webDir: "../out",
  server: { androidScheme: "https" },
  android: {
    backgroundColor: "#1b1f3b",
    allowMixedContent: false
  }
};

export default config;
