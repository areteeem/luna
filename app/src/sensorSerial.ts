type Port = EventTarget & {
  open: (options: { baudRate: number }) => Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  close: () => Promise<void>;
};

export const serial = () => (navigator as Navigator & { serial?: { requestPort: () => Promise<Port> } }).serial;

export async function readSensor(onLine: (line: string) => void, signal: AbortSignal, connected: () => void) {
  const api = serial();
  if (!api) throw Error("Use desktop Chromium on localhost or HTTPS for USB serial.");
  const port = await api.requestPort();
  if (signal.aborted) return;
  await port.open({ baudRate: 115200 });
  try {
    if (signal.aborted) return;
    const reader = port.readable?.getReader();
    if (!reader) throw Error("The selected port has no readable stream.");
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener("abort",cancel);
    port.addEventListener("disconnect",cancel);
    try {
      connected();
      const decoder = new TextDecoder();
      let line = "";
      let oversized = false;
      while (!signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        for (const character of decoder.decode(chunk.value,{ stream:true })) {
          if (character === "\n") {
            if (!oversized && line.trim()) onLine(line);
            line = "";
            oversized = false;
          } else if (!oversized) {
            line += character;
            if (line.length > 4096) { line = ""; oversized = true; }
          }
        }
      }
    } finally {
      signal.removeEventListener("abort",cancel);
      port.removeEventListener("disconnect",cancel);
      reader.releaseLock();
    }
  } finally {
    await port.close().catch(() => {});
  }
}
