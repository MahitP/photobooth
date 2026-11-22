import { bindings, defineConfig } from "cf/config";

// QR download links: a phone scans the QR and gets the file. Files live in KV with a 24 h TTL, then vanish.
export default defineConfig({
  worker: {
    name: "holdit-share",
    entrypoint: "./src/index.js",
    compatibilityDate: "2026-11-01",
    env: {
      FILES: bindings.kv({ id: "dc1c7599ed6b4870983a88458fc4b22b" }), // "holdit-share-files", entries expire after 24 h
    },
  },
});
