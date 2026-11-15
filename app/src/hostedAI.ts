import { AI_SYSTEM, normalizeAIReply } from "./ai";
import type { AIStatus } from "./ai";

const loopback = "http://127.0.0.1:11434";
const connectionError = "Cannot reach Ollama on this device. Start it locally, allow this site's exact origin in OLLAMA_ORIGINS, and grant browser local-network access if prompted. You can also choose WebGPU.";
type Model = { id: string; bytes?: number };
type Attachment = { name?: string; type?: string; data: string };
type Request = {
  provider?: string; model?: string; attachments?: Attachment[]; images?: Attachment[];
  context?: unknown; messages?: unknown[]; system?: string; max_tokens?: number;
  temperature?: number; context_tokens?: number; keep_alive?: string; candidate?: unknown;
};
let models: Model[] | undefined;

async function ollama<T>(endpoint: "tags" | "chat" | "show", payload?: object, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${loopback}/api/${endpoint}`, {
      credentials: "omit", redirect: "error", cache: "no-store", signal,
      ...(payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(connectionError);
  }
  if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}. Check your local model and connection, or use WebGPU.`);
  return response.json();
}

function attachments(input: Attachment[] = []) {
  const text: string[] = [], images: string[] = [];
  if (input.length > 8) throw new Error("Attach at most eight files.");
  for (const item of input) {
    const match = /^data:(image\/(?:png|jpeg|webp));base64,/.exec(item.data);
    const mime = match?.[1] || item.type || "text/plain";
    const data = match ? item.data.slice(match[0].length) : item.data;
    if (data.length > 8 * 1024 * 1024 * 4 / 3 + 4) throw new Error("Attachment exceeds 8 MB.");
    if (["image/png", "image/jpeg", "image/webp"].includes(mime)) images.push(data);
    else {
      if (!mime.startsWith("text/") && !["application/json", "application/geo+json", "application/octet-stream"].includes(mime))
        throw new Error("Use a UTF-8 text export for this attachment, or open it in the installed editor.");
      const bytes = Uint8Array.from(atob(data.slice(0, 112000)), (char) => char.charCodeAt(0));
      text.push(`UNTRUSTED ATTACHMENT ${(item.name || "file").slice(0, 200)}:\n${new TextDecoder().decode(bytes)}`);
    }
  }
  return { text: text.join("\n\n").slice(0, 80000), images };
}

export async function hostedAI(path: string, input: unknown, signal?: AbortSignal): Promise<unknown> {
  const data = (input || {}) as Request;
  if (path === "status") {
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
    const status: AIStatus = {
      providers: models ? { ollama: { connected: true, models } } : {}, jobs: [], catalog: [],
      resources: {
        platform: "Browser", architecture: "", ram_gb: null, available_ram_gb: null,
        disk_free_gb: Math.max(0, ((estimate?.quota || 0) - (estimate?.usage || 0)) / 2 ** 30),
        ollama_installed: Boolean(models), ollama_running: Boolean(models), brew_available: false,
        estimate_note: "Browsers cannot inspect available system memory.",
      },
    };
    return status;
  }
  if (path === "extract") return attachments(data.attachments);
  if (path === "connect" && data.provider === "ollama") {
    models = undefined;
    const result = await ollama<{ models?: { name?: string; size?: number; remote_host?: string }[] }>("tags", undefined,
      AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]));
    models = (result.models || []).flatMap(({ name, size, remote_host }) => name && !remote_host && !name.endsWith(":cloud") ? [{ id: name, bytes: size }] : []);
    return { provider: "ollama", models };
  }
  if (path === "disconnect" && data.provider === "ollama") {
    models = undefined;
    return { ok: true };
  }
  if ((path === "chat" && data.provider === "ollama") || path === "terrain-review") {
    if (!models?.some((model) => model.id === data.model))
      throw new Error("Connect Ollama and select an installed model in AI & models first.");
    const vision = path === "terrain-review";
    const file = attachments(vision ? data.images : data.attachments);
    if (vision) {
      const info = await ollama<{ capabilities?: string[] }>("show", { model: data.model }, signal);
      if (!info.capabilities?.includes("vision")) throw new Error("Choose a local model with vision capability.");
      if (!file.images.length || file.images.length > 2) throw new Error("Capture one or two terrain map images.");
    }
    const result = await ollama<{ message?: { content?: string } }>("chat", {
      model: data.model, stream: false, ...(vision ? {} : { format: "json" }), keep_alive: data.keep_alive || "5m",
      options: { num_predict: data.max_tokens ?? 2048, num_ctx: data.context_tokens ?? 8192, temperature: data.temperature ?? 0.3 },
      messages: [
        { role: "system", content: vision ? "Describe visible lunar terrain evidence and uncertainty. Images do not establish a safe landing site." :
          AI_SYSTEM + "\nWeb browsing is unavailable here. Style preference only: " + (data.system || "").slice(0, 4000) },
        { role: "user", content: vision ? JSON.stringify({ candidate: data.candidate, request: "Review visible terrain and limits." }) :
          JSON.stringify({ context: data.context, untrusted_attachments: file.text, conversation: data.messages?.slice(-30) }),
          ...(file.images.length ? { images: file.images } : {}) },
      ],
    }, signal);
    const raw = result.message?.content;
    if (!raw) throw new Error("Ollama returned no text.");
    return vision ? { review: raw } : normalizeAIReply(raw);
  }
  throw new Error("This AI operation is available in the installed editor.");
}
