import { hosted } from "./runtime";
import { useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { aiAPI, browserModels, loadBrowserModel } from "./ai";
import type { AISettings, AIStatus } from "./ai";
import { Check } from "./PreferencesPanel";
export default function AISettingsPanel() {
  const w = useWorkspace(),
    cfg = w.preferences.ai;
  const edit = (patch: Partial<AISettings>) =>
    w.setPreferences({ ...w.preferences, ai: { ...cfg, ...patch } });
  const [status, setStatus] = useState<AIStatus>(),
    [key, setKey] = useState(""),
    [connection, setConnection] = useState("auto"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [downloadProgress, setDownloadProgress] = useState<number | null>(null),
    [local, setLocal] = useState("qwen2.5:0.5b"),
    [browserList, setBrowserList] = useState<{ id: string; ram_gb: number }[]>(
      [],
    ),
    [ack, setAck] = useState(false);
  const [downloadedBrowserModels, setDownloadedBrowserModels] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("luna-browser-models-v1") || "[]"); }
    catch { return []; }
  });
  const [consoleEntries, setConsoleEntries] = useState<string[]>([]);
  const [latestMessages, setLatestMessages] = useState<{ role: string; content: string; sentAt?: string }[]>([]);
  const refreshConversation = () => {
    try {
      const threads = JSON.parse(localStorage.getItem(`luna-chats-${w.study.id}`) || "[]");
      if (!Array.isArray(threads)) return;
      const entries = threads.flatMap((thread) => {
        try {
          const saved = JSON.parse(localStorage.getItem(`luna-ai-activity-${w.study.id}-${thread.id}`) || "null");
          return Array.isArray(saved) ? saved : Array.isArray(thread.activity) ? thread.activity : [];
        } catch { return Array.isArray(thread.activity) ? thread.activity : []; }
      });
      setConsoleEntries(entries.slice(-40));
      setLatestMessages(threads.flatMap((thread) => Array.isArray(thread.messages) ? thread.messages : []).slice(-8));
    } catch {
      setConsoleEntries([]);
      setLatestMessages([]);
    }
  };
  useEffect(() => {
    refreshConversation();
    window.addEventListener("luna-ai-activity-updated", refreshConversation);
    window.addEventListener("storage", refreshConversation);
    return () => {
      window.removeEventListener("luna-ai-activity-updated", refreshConversation);
      window.removeEventListener("storage", refreshConversation);
    };
  }, [w.study.id]);
  const refresh = async () => {
    try {
      setStatus(await aiAPI<AIStatus>("status"));
    } catch (e) {
      setMessage(String(e));
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setMessage("Working…");
    setDownloadProgress(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };
  const poll = async (job: string) => {
    for (;;) {
      const state = await aiAPI<{
        status: string;
        message: string;
        progress: number;
        model?: string;
      }>("job/" + job);
      setMessage(`${state.message} · ${Math.round(state.progress * 100)}%`);
      setDownloadProgress(Math.max(0, Math.min(1, state.progress)));
      if (state.status === "complete") return state;
      if (state.status === "error" || state.status === "missing")
        throw new Error(state.message);
      await new Promise((r) => setTimeout(r, 1500));
    }
  };
  const prepareLocalAI = async () => {
    const result = await aiAPI<{ job: string; model: string }>("prepare", {
      model: recommended?.id,
    });
    const completed = await poll(result.job);
    const linked = await aiAPI<{ models: { id: string }[] }>("connect", {
      provider: "ollama",
    });
    const model = completed.model || result.model || linked.models[0]?.id || "";
    edit({ provider: "ollama", model, allowInsufficientMemory: false, allowEdits: true, autoApply: true });
    setMessage(`Local AI is ready with ${model}. You can ask it to run analysis, search sites, change the map, or export a report.`);
  };
  const detect = key.startsWith("AIza")
    ? "gemini"
    : key.startsWith("sk-proj-") ||
        key.startsWith("sk-svcacct-") ||
        /^sk-[A-Za-z0-9]{48}$/.test(key)
      ? "openai"
      : null;
  const customParameterCount = Number(local.match(/(?<!\d)(\d+(?:\.\d+)?)b(?:-|$)/i)?.[1]);
  const selected =
    cfg.provider === "browser"
      ? browserList.find((m) => m.id === cfg.model)
      : status?.catalog.find((m) => m.id === local) || (customParameterCount ? {
          id: local,
          ram_gb: Math.max(2, customParameterCount * 1.25 + 1),
          disk_gb: Math.max(1, customParameterCount * 0.65),
        } : undefined);
  const required = selected?.ram_gb;
  const available = status?.resources.available_ram_gb;
  const insufficient =
    required !== undefined &&
    available !== null &&
    available !== undefined &&
    available < required;
  const selectedActive = status?.providers.ollama?.models.find(
    (m) => m.id === cfg.model,
  );
  const activeBudget = Math.max(
    2,
    ((selectedActive?.bytes || 0) / 2 ** 30) * 1.25 + 1,
  );
  const activeInsufficient =
    cfg.provider === "ollama" &&
    selectedActive &&
    available !== null &&
    available !== undefined &&
    activeBudget > available;
  const recommended = status?.catalog
    .filter((model) =>
      (available == null || model.ram_gb <= available * 0.65) &&
      model.disk_gb <= status.resources.disk_free_gb * 0.8,
    )
    .at(-1);
  return (
    <div className="ai-settings-panel">
      <header className="ai-settings-heading"><h2>AI & models</h2><span>{cfg.model ? "Model selected" : "Choose a model"}</span></header>
      <details className="ai-console" open>
        <summary>Latest AI console · {consoleEntries.length} activity events</summary>
        <div className="ai-console-messages" aria-label="Latest AI conversation messages">
          {latestMessages.length ? latestMessages.map((entry, index) => <article key={index}><strong>{entry.role === "user" ? "You" : "Assistant"}</strong><time>{entry.sentAt ? new Date(entry.sentAt).toLocaleTimeString() : "Earlier"}</time><p>{entry.content}</p></article>) : <p>No AI messages for this project yet.</p>}
        </div>
        <div className="ai-console-events" aria-label="AI action and activity log">
          {consoleEntries.length ? consoleEntries.map((entry, index) => { const [time, ...text] = entry.split(" "); return <div key={index}><time>{new Date(time).toLocaleTimeString()}</time><span>{text.join(" ")}</span></div>; }) : <p>AI requests and completed actions will appear here.</p>}
        </div>
      </details>
      <nav className="ai-provider-options" aria-label="AI provider">
        {([['ollama', 'Ollama', 'Local runtime'], ['browser', 'WebGPU', 'Runs in this browser'], ['openai', 'OpenAI', 'Cloud API'], ['gemini', 'Gemini', 'Cloud API']] as const).filter(([provider]) => !hosted || provider === "ollama" || provider === "browser").map(([provider, title, detail]) => <button key={provider} type="button" aria-pressed={cfg.provider === provider} onClick={() => { edit({ provider, model: "" }); setAck(false); }}><strong>{title}</strong><small>{detail}</small></button>)}
      </nav>
      {hosted ? <p className="hint">WebGPU and Ollama use this device. OpenAI and Gemini are available in the installed editor.</p> : <>
      <p className="hint">Cloud providers receive the study context and files you choose to share. Web searches originate from this computer; search results and opened page text are sent to the selected AI provider. Ollama and WebGPU run locally on this device. Review proposed AI changes and computed assumptions before relying on them.</p>
      <p>
        Connect a cloud provider, use Ollama, or download a WebGPU model
        directly into this browser. Cloud requests send the context and
        attachments you select to that provider. Keys stay in the local server's
        memory and must be re-entered after a restart.
      </p>
      </>}
      <label className="field">
        Active provider
        <select
          value={cfg.provider}
          onChange={(e) => {
            edit({
              provider: e.target.value as AISettings["provider"],
              model: "",
            });
            setAck(false);
          }}
        >
          {!hosted && <option value="openai">OpenAI API</option>}
          {!hosted && <option value="gemini">Gemini API</option>}
          <option value="ollama">Ollama · local runtime</option>
          <option value="browser">Browser-local · WebLLM / WebGPU</option>
        </select>
      </label>
      {!hosted && ["openai", "gemini"].includes(cfg.provider) && (
        <>
          <label className="field">
            Credential provider
            <select
              value={connection}
              onChange={(e) => setConnection(e.target.value)}
            >
              <option value="auto">Detect from credential prefix</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label className="field">
            API key
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter here, never in chat"
            />
          </label>
          <p className="hint">
            {detect
              ? `Recognized format: ${detect}. It will only be sent to that provider.`
              : "Unknown formats require an explicit provider choice; credentials are never probed across services."}
          </p>
          <button
            disabled={busy || !key.trim()}
            onClick={() =>
              run(async () => {
                const result = await aiAPI<{
                  provider: AISettings["provider"];
                  models: { id: string }[];
                }>("connect", { provider: connection, key });
                edit({
                  provider: result.provider,
                  model:
                    result.models.find((m) => /^(gpt-|gemini-)/.test(m.id))
                      ?.id ||
                    result.models[0]?.id ||
                    "",
                });
                setKey("");
                setMessage(
                  "Connected; model list discovered from this credential.",
                );
              })
            }
          >
            Connect & discover models
          </button>
          <button
            onClick={() =>
              run(async () => {
                await aiAPI("disconnect", { provider: cfg.provider });
                setMessage(
                  "Disconnected and credential removed from server memory.",
                );
              })
            }
          >
            Disconnect
          </button>
        </>
      )}
      {hosted && cfg.provider === "ollama" && (
        <>
          <p>Start Ollama on this device and add <code>{window.location.origin}</code> to <code>OLLAMA_ORIGINS</code>. Keep the listener on loopback and allow local network access if your browser asks.</p>
          <button disabled={busy} onClick={() => run(async () => {
            const result = await aiAPI<{ models: { id: string }[] }>("connect", { provider: "ollama" });
            edit({ model: result.models[0]?.id || "" });
            setMessage(result.models.length ? "Ollama connected." : "No local models found. Install a model with Ollama or use WebGPU.");
          })}>Connect / refresh installed models</button>
          <button type="button" onClick={() => { edit({ provider: "browser", model: "" }); setMessage(""); }}>Use WebGPU</button>
        </>
      )}
      {!hosted && cfg.provider === "ollama" && (
        <>
          <p>
            Ollama endpoint: 127.0.0.1:11434. No cloud key or custom remote
            endpoint is used.
          </p>
          <p className="hint">
            Candidate terrain-image review runs only through this local Ollama
            runtime and requires a model with vision capability. Text-only
            models remain available for chat and will be declined for image
            review; map-image observations are qualitative, not DEM measurements.
          </p>
          <p className="hint">
            One-click setup starts the local server, installs Ollama with
            Homebrew on macOS if needed, and downloads a model sized for this
            computer. First setup may take several minutes and use model-storage
            space.
          </p>
          <button className="primary" disabled={busy} onClick={() => run(prepareLocalAI)}>
            Set up and start local AI
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await aiAPI<{ models: { id: string }[] }>(
                  "connect",
                  { provider: "ollama" },
                );
                edit({ model: result.models[0]?.id || "" });
                setMessage("Ollama connected.");
              })
            }
          >
            Connect / refresh installed models
          </button>
          <button
            disabled={busy || !status?.resources.ollama_installed}
            onClick={() =>
              run(async () => {
                const result = await aiAPI<{ job: string }>("start", {});
                await poll(result.job);
              })
            }
          >
            Start local runtime
          </button>
          <details>
            <summary>Install Ollama runtime</summary>
            <p>
              On macOS with Homebrew, this installs the official Ollama package
              and starts a local runtime. It downloads software and may take
              several minutes. Model weights are a separate download.
            </p>
            <button
              disabled={busy || !status?.resources.brew_available}
              onClick={() =>
                run(async () => {
                  const result = await aiAPI<{ job: string }>("install", {});
                  await poll(result.job);
                })
              }
            >
              Install Ollama through Homebrew
            </button>
            <a
              href="https://ollama.com/download"
              target="_blank"
              rel="noreferrer"
            >
              Official installer for other systems ↗
            </a>
          </details>
          <label className="field">
            Download a local model
            <select
              value={local}
              onChange={(e) => {
                setLocal(e.target.value);
                setAck(false);
              }}
            >
              {status?.catalog.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id} · about {m.ram_gb} GB RAM / {m.disk_gb} GB disk budget{recommended?.id === m.id ? " · recommended for this computer" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Or enter an Ollama model tag
            <input
              value={local}
              aria-label="Ollama model tag"
              placeholder="example: qwen3:30b"
              onChange={(e) => { setLocal(e.target.value.trim()); setAck(false); }}
            />
          </label>
        </>
      )}
      {cfg.provider === "browser" && (
        <>
          <p>
            Inference runs in this browser with WebGPU. First load downloads
            weights and runtime files; keep the browser's model cache for
            offline use. Text/JSON/CSV attachments work; this text-model flow
            does not accept images.
          </p>
          <p className="hint">If this device has no usable WebGPU, LUNA can retry text requests through a connected local Ollama model. Ollama uses the hardware backends available on macOS and other systems, with CPU inference as a slower fallback. PDF and data exports do not need an AI model.</p>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const list = await browserModels();
                setBrowserList(list);
                edit({
                  model:
                    list.find((m) => m.id.includes("0.5B"))?.id ||
                    list[0]?.id ||
                    "",
                });
                setMessage(
                  "Browser models listed. Select one and review resource estimates.",
                );
              })
            }
          >
            List browser models
          </button>
        </>
      )}
      {status && (
        <div className="resource-summary">
          <strong>Computer resources</strong>
          <p>
            {status.resources.platform} {status.resources.architecture} · total
            RAM {status.resources.ram_gb?.toFixed(1) ?? "unknown"} GB ·
            estimated available{" "}
            {status.resources.available_ram_gb?.toFixed(1) ?? "unknown"} GB ·
            free disk {status.resources.disk_free_gb.toFixed(1)} GB
          </p>
          {cfg.provider === "ollama" && (
            <p className={status.resources.ollama_running ? "hint" : "warning"}>
              Local server {status.resources.ollama_running ? "is running" : "is stopped"} · {status.resources.ollama_installed ? "Ollama installed" : "Ollama not installed"}
            </p>
          )}
          <p className="hint">{status.resources.estimate_note}</p>
        </div>
      )}
      {["browser", "ollama"].includes(cfg.provider) && (
        <>
          <p className={insufficient ? "warning" : "hint"}>
            {insufficient
              ? `Resources may be insufficient: estimated ${required?.toFixed(1)} GB RAM needed, ${available?.toFixed(1)} GB available.`
              : required
                ? `Estimated RAM budget ${required.toFixed(1)} GB; inference speed and GPU compatibility are not guaranteed.`
                : "Resource requirements unknown. Refresh the model list before downloading."}
          </p>
          {insufficient && (
            <Check
              label="I understand the resource warning; allow this download"
              value={ack}
              onChange={setAck}
            />
          )}
        </>
      )}
      <label className="field">
        Model
        <select
          value={cfg.model}
          onChange={(e) => {
            edit({ model: e.target.value, allowInsufficientMemory: false });
            setAck(false);
          }}
        >
          <option value="">Select a discovered model</option>
          {cfg.model && !(cfg.provider === "browser" ? browserList : status?.providers[cfg.provider]?.models || []).some((model) => model.id === cfg.model) && <option value={cfg.model}>{cfg.model} · selected</option>}
          {(cfg.provider === "browser"
            ? browserList
            : status?.providers[cfg.provider]?.models || []
          ).map((m) => (
            <option key={m.id} value={m.id}>
              {m.id}
            </option>
          ))}
        </select>
      </label>
      {activeInsufficient && (
        <div className="warning">
          <p>
            The selected model {cfg.model} may need {activeBudget.toFixed(1)} GB
            RAM, with about {available?.toFixed(1)} GB available. Choose a
            smaller model for reliable use.
          </p>
          <Check
            label="Allow this model despite the memory warning"
            value={cfg.allowInsufficientMemory}
            onChange={(allowInsufficientMemory) =>
              edit({ allowInsufficientMemory })
            }
          />
        </div>
      )}
      {!hosted && cfg.provider === "ollama" && (
        <p className="hint">
          {recommended
            ? `Suggested for this computer: ${recommended.id}. This leaves memory headroom; GPU support and speed still vary.`
            : "No listed model fits current available memory and disk with headroom. You can still review estimates before choosing."}
        </p>
      )}
      {!hosted && cfg.provider === "ollama" && (
        <button
          disabled={busy || (insufficient && !ack)}
          onClick={() =>
            run(async () => {
              const result = await aiAPI<{ job: string }>("pull", {
                model: local,
                acknowledge_warning: ack,
              });
              await poll(result.job);
              const result2 = await aiAPI<{ models: { id: string }[] }>(
                "connect",
                { provider: "ollama" },
              );
              edit({
                model:
                  result2.models.find((m) => m.id === local)?.id ||
                  result2.models[0]?.id ||
                  "",
              });
            })
          }
        >
          Download selected Ollama model
        </button>
      )}
      {cfg.provider === "browser" && (
        <button
          disabled={busy || !cfg.model || (insufficient && !ack)}
          onClick={() =>
            run(async () => {
              const current = await aiAPI<AIStatus>("status");
              setStatus(current);
              const availableNow = current.resources.available_ram_gb;
              const estimate = browserList.find(
                (m) => m.id === cfg.model,
              )?.ram_gb;
              if (
                availableNow !== null &&
                estimate !== undefined &&
                availableNow < estimate &&
                !ack
              )
                throw new Error(
                  "Available memory changed; review and acknowledge the resource warning before downloading.",
                );
              await loadBrowserModel(cfg.model, (text) => {
                setMessage(text);
                const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
                if (percent) setDownloadProgress(Number(percent[1]) / 100);
              }, cfg.contextTokens);
              setDownloadedBrowserModels((existing) => {
                const next = [...new Set([...existing, cfg.model])];
                localStorage.setItem("luna-browser-models-v1", JSON.stringify(next));
                return next;
              });
              setMessage("Browser model loaded and ready.");
            })
          }
        >
          Download / load browser model
        </button>
      )}
      <p className="ai-progress" role="status">
        {busy && <span className="inline-loader" aria-hidden="true" />} {message}
      </p>
      {busy && (
        <progress
          className="ai-task-progress"
          max={1}
          value={downloadProgress ?? undefined}
          aria-label={downloadProgress === null ? "AI model download in progress" : "AI model download progress"}
        />
      )}
      {cfg.provider === "browser" && (
        <section className="downloaded-models" aria-label="Downloaded models">
          <h3>Downloaded models</h3>
          {downloadedBrowserModels.length ? (
            downloadedBrowserModels.map((model) => (
              <button key={model} className="text-button" onClick={() => edit({ model })}>
                {model}{model === cfg.model ? " · selected" : ""}
              </button>
            ))
          ) : <p className="hint">Models appear here after download.</p>}
        </section>
      )}
      <details className="ai-advanced">
        <summary>Assistant behavior & advanced settings</summary>
        <label className="field">
          Temperature · local / Gemini
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={cfg.temperature}
            onChange={(e) =>
              edit({
                temperature: Math.max(0, Math.min(2, Number(e.target.value))),
              })
            }
          />
        </label>
        <div className="field-pair">
          <label className="field">
            Maximum output tokens
            <input
              type="number"
              min="128"
              max="12000"
              value={cfg.maxTokens}
              onChange={(e) =>
                edit({
                  maxTokens: Math.max(
                    128,
                    Math.min(12000, Number(e.target.value)),
                  ),
                })
              }
            />
          </label>
          <label className="field">
            Local context tokens
            <input
              type="number"
              min="2048"
              max="16384"
              value={cfg.contextTokens}
              onChange={(e) =>
                edit({
                  contextTokens: Math.max(
                    2048,
                    Math.min(16384, Number(e.target.value)),
                  ),
                })
              }
            />
          </label>
        </div>
        <label className="field">
          Ollama model keep-alive
          <select
            value={cfg.keepAlive}
            onChange={(e) =>
              edit({ keepAlive: e.target.value as AISettings["keepAlive"] })
            }
          >
            {["0", "1m", "5m", "15m"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <div className="field">
          Tool follow-up limit
          <span className="hint">Up to three web searches or page reads per answer. Stop generation at any time.</span>
        </div>
        <label className="field">
          Response style
          <textarea
            maxLength={4000}
            value={cfg.system}
            onChange={(e) => edit({ system: e.target.value })}
          />
        </label>
        <Check
          label="Include current study inputs"
          value={cfg.shareStudy}
          onChange={(shareStudy) => edit({ shareStudy })}
        />
        <Check
          label="Include calculated A/B summaries"
          value={cfg.shareResults}
          onChange={(shareResults) => edit({ shareResults })}
        />
        {!hosted && <Check
          label="Allow web browsing (search from this computer)"
          value={cfg.allowWebBrowsing}
          onChange={(allowWebBrowsing) => edit({ allowWebBrowsing })}
        />}
        <Check
          label="Allow reversible app edits"
          value={cfg.allowEdits}
          onChange={(allowEdits) => edit({ allowEdits })}
        />
        <Check
          label="Apply reversible edits automatically (otherwise review first)"
          value={cfg.autoApply}
          onChange={(autoApply) => edit({ autoApply })}
        />
        <Check
          label="Keep chat history on this device"
          value={cfg.keepHistory}
          onChange={(keepHistory) => edit({ keepHistory })}
        />
      </details>
      <button className="primary" onClick={() => w.showPanel("chat")}>
        Open movable AI assistant tab
      </button>
    </div>
  );
}
