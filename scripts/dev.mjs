import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [
  path.join(root, ".venv/bin/python"),
  path.join(root, "../research-env/bin/python"),
];
const python = candidates.find(existsSync);
if (!python) {
  console.error(
    "Python environment missing. Run `uv sync --frozen` in the repository root, then `npm run dev` in app/.",
  );
  process.exit(1);
}
const children = [];
const run = (cmd, args, cwd = root) => {
  const child = spawn(cmd, args, { cwd, stdio: "inherit" });
  children.push(child);
  return child;
};
const onceExit = (child) =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Process exited with ${code}`)),
    );
  });
let ready = false;
try {
  const response = await fetch("http://127.0.0.1:8765/api/health");
  ready =
    response.ok &&
    (await response.json()).service === "Lunar Window local SPICE";
} catch {}
if (!ready) {
  if (!existsSync(path.join(root, "work/kernels/manifest.json")))
    await onceExit(run(python, ["scripts/setup_geometry.py"]));
  const geometry = run(python, ["scripts/geometry_server.py"]);
  for (let i = 0; i < 100; i++) {
    if (geometry.exitCode !== null)
      throw new Error("Geometry service failed to start");
    try {
      const response = await fetch("http://127.0.0.1:8765/api/health");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error("Geometry service did not start");
}
const vite = run(
  process.execPath,
  [
    path.join(root, "app/node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    ...process.argv.slice(2),
  ],
  path.join(root, "app"),
);
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", () => {
  stop();
  process.exit();
});
process.once("SIGTERM", () => {
  stop();
  process.exit();
});
vite.once("exit", () => {
  stop();
  process.exit(vite.exitCode || 0);
});
