import type { JarvisApi } from "../../preload/index";

declare global {
  interface Window {
    aiOS: JarvisApi;
  }
}

export {};
