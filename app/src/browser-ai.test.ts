import { describe, it, expect, vi, beforeEach } from "vitest";
const calls = vi.hoisted(() => ({
  create: vi.fn(),
  resetChat: vi.fn(),
  unload: vi.fn(),
  factory: vi.fn(),
}));
vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: calls.factory,
  prebuiltAppConfig: { model_list: [] },
}));
import { loadBrowserModel, browserChat, DEFAULT_AI } from "./ai";
beforeEach(() => {
  calls.create.mockReset();
  calls.resetChat.mockResolvedValue(undefined);
  calls.unload.mockResolvedValue(undefined);
  calls.factory.mockResolvedValue({
    chat: { completions: { create: calls.create } },
    resetChat: calls.resetChat,
    unload: calls.unload,
  });
  vi.stubGlobal("navigator", { gpu: {} });
});
describe("browser-local inference interoperability", () => {
  it("recovers from a grammar backend failure and preserves validated actions", async () => {
    await loadBrowserModel("test-local", () => {}, 8192);
    calls.create
      .mockRejectedValueOnce(
        new Error(
          "GrammarMatcherInitError: Cannot pass non-string to std::string",
        ),
      )
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content:
                '{"reply":"Opening map","actions":[{"type":"open_panel","panel":"map"}]}',
            },
          },
        ],
      });
    const reply = await browserChat("test-local", "Open map", DEFAULT_AI);
    expect(reply.actions).toEqual([{ type: "open_panel", panel: "map" }]);
    expect(reply.format_warning).toContain("grammar");
    expect(calls.resetChat).toHaveBeenCalled();
    expect(calls.factory.mock.calls.at(-1)?.[2].context_window_size).toBe(8192);
  });
  it("does not turn malformed model output into app actions", async () => {
    await loadBrowserModel("test-local", () => {});
    calls.create.mockResolvedValue({
      choices: [
        { message: { content: "This is a plain-language explanation." } },
      ],
    });
    const reply = await browserChat(
      "test-local",
      "Explain the study",
      DEFAULT_AI,
    );
    expect(reply.actions).toEqual([]);
    expect(reply.reply).toContain("plain-language");
  });
});
