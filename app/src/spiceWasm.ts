type WasmModule = {
  FS: { writeFile(path: string, data: Uint8Array, options?: { canOwn: boolean }): void };
  HEAPF64: Float64Array;
  cwrap(name: string, result: string | null, args: string[]): (...args: (string | number)[]) => unknown;
};
export async function loadSpice() {
  const script = new URL("/browser-spice/spice.mjs", self.location.origin).href;
  const { default: factory } = await import(/* @vite-ignore */ script) as { default(): Promise<WasmModule> };
  const m = await factory();
  const s = "string", n = "number";
  const c = m.cwrap.bind(m);
  const error = c("last_error", s, []);
  const pointer = c("result", n, []);
  const check = () => { const message = error(); if (message) throw new Error(String(message)); };
  const call = (fn: string, args: string[], count: number) => {
    const invoke = c(fn, null, args);
    return (...values: (string | number)[]) => {
      invoke(...values); check();
      const offset = Number(pointer()) / 8;
      return Array.from(m.HEAPF64.subarray(offset, offset + count));
    };
  };
  c("configure", null, [])();
  check();
  const readEt = c("time_et", n, [s]);
  const load = c("load_kernel", null, [s]);
  const loaded = new Set<string>();
  return {
    stageKernel(name: string, bytes: Uint8Array) { m.FS.writeFile("/" + name, bytes, { canOwn: true }); },
    loadKernel(name: string) {
      if (loaded.has(name)) return;
      load("/" + name); check(); loaded.add(name);
    },
    et(utc: string) { const value = readEt(utc); check(); return value; },
    frame: call("frame_transform", [s, s, n], 9),
    frameTimes: call("frame_transform_times", [s, s, n, n], 9),
    position: call("position", [s, n, s, s, s], 4),
    observerState: call("observer_state", [s, n, s, s, s, n, n, n, s, s], 7),
    geodetic: call("geodetic", [n, n, n, n, n], 3),
  };
}
