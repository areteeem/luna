// Keep Vite's Python proxy for local installations; hosted builds are explicit.
export const hosted = import.meta.env.MODE === "hosted";
