import { describe, expect, it } from "vitest";
import { DEFAULT_AI, normalizeAIReply } from "./ai";
import { assistantContext } from "./aiTools";
import { createStudy } from "./study";

describe("AI web browsing controls", () => {
  it("enables browsing by default and exposes both read-only tools", () => {
    expect(DEFAULT_AI.allowWebBrowsing).toBe(true);
    const context = assistantContext(createStudy(), undefined, undefined, true, true, DEFAULT_AI.allowWebBrowsing);
    expect(context.actions.map((action) => action.type)).toContain("web_search");
    expect(context.actions.map((action) => action.type)).toContain("web_open");
  });

  it("removes web tools from the model context when browsing is disabled", () => {
    const context = assistantContext(createStudy(), undefined, undefined, true, true, false);
    expect(context.actions.map((action) => action.type)).not.toContain("web_search");
    expect(context.actions.map((action) => action.type)).not.toContain("web_open");
  });

  it("preserves model-requested browse tools for the host orchestrator", () => {
    expect(normalizeAIReply(JSON.stringify({
      reply: "Searching for current sources.",
      actions: [{ type: "web_search", query: "NASA Artemis schedule" }],
    })).actions).toEqual([{ type: "web_search", query: "NASA Artemis schedule" }]);
  });
});
