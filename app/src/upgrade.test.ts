import { describe, it, expect, vi } from "vitest";
import { createStudy, isStudy } from "./study";
import { moveActivity, reorderActivities, recommendPlan } from "./planning";
import { DEFAULT_PREFERENCES, loadPreferences } from "./preferences";
import { actionsForCurrentUserTurn, executeActions, summarizeActionResults } from "./aiTools";
import type { AIAction } from "./ai";
import type { WorkspaceValue } from "./WorkspaceContext";
describe("mission editing and AI action boundaries", () => {
  it("clamps timeline drops to the study and preserves activity durations", () => {
    const s = createStudy();
    const event = s.events.find((e) => e.duration > 0)!;
    const moved = moveActivity(s, event.id, 999);
    const result = moved.find((e) => e.id === event.id)!;
    expect(result.duration).toBe(event.duration);
    expect(result.offset + result.duration).toBe(s.duration);
    expect(isStudy({ ...s, events: moved })).toBe(true);
  });
  it("resequences dropped rows and rejects schedules too long to fit", () => {
    const s = createStudy();
    s.events = s.events
      .slice(0, 2)
      .map((e, i) => ({ ...e, offset: i, duration: 1 }));
    const reordered = reorderActivities(s, s.events[1].id, s.events[0].id)!;
    expect(reordered[0].id).toBe(s.events[1].id);
    expect(reordered.map((e) => e.offset)).toEqual([0, 1]);
    expect(
      reorderActivities({ ...s, duration: 1 }, s.events[1].id, s.events[0].id),
    ).toBeNull();
  });
  it("does not fabricate a mission recommendation before analysis", () => {
    expect(recommendPlan(createStudy()).events).toEqual([]);
  });
  it("runs requested tools once and blocks follow-up tool loops", () => {
    const actions: AIAction[] = [
      { type: "run_analysis" },
      { type: "run_analysis" },
      { type: "export_file", format: "pdf" },
    ];
    const analysis = actionsForCurrentUserTurn(actions, 0, "Run mission analysis for Scenario A.");
    expect(analysis).toEqual([{ type: "run_analysis" }]);
    expect(actionsForCurrentUserTurn(actions, 1, "Run mission analysis for Scenario A.")).toEqual([]);
    expect(actionsForCurrentUserTurn(actions, 0, "Export the study report as a PDF.")).toEqual([
      { type: "export_file", format: "pdf" },
    ]);
    expect(actionsForCurrentUserTurn(
      [{ type: "run_analysis" }], 0, "I don't see the download; try again.",
    )).toEqual([{ type: "export_file", format: "pdf" }]);
    expect(actionsForCurrentUserTurn(
      [{ type: "set_analysis", patch: { base_load_w: 100 } }],
      0,
      "Set usable battery capacity to 2,500 Wh.",
    )).toEqual([{ type: "set_analysis", patch: { battery_wh: 2500 } }]);
  });
  it("summarizes mission analysis and exports from actual tool results", () => {
    const summary = summarizeActionResults(
      [{ type: "run_analysis" }],
      [{
        type: "run_analysis",
        result: {
          available: true,
          inputs: { battery_wh: 2000 },
          power: {
            minimum_soc_nominal: 0.4,
            minimum_soc_conservative: 0.3,
            generated_nominal_wh: 1234.5,
          },
          access: { station: "DSS-14", available_hours_at_samples: 8, unknown_terrain_hours: 2 },
        },
      }],
    );
    expect(summary).toContain("1,234.5 Wh");
    expect(summary).toContain("40% nominal / 30% conservative");
    expect(summary).toContain("sampled DSS-14 access was 8 h");
    expect(summary).toContain("unknown for 2 h");
    expect(summarizeActionResults(
      [{ type: "export_file", format: "pdf" }],
      [{ type: "export_file", status: "complete" }],
    )).toContain("required site image and mission geometry figure");
    expect(summarizeActionResults(
      [{ type: "set_analysis", patch: { battery_wh: 2500 } }],
      [{ type: "set_analysis", status: "complete" }],
    )).toContain("usable battery capacity: 2,500 Wh");
  });
  it("validates optional tasks and display switches in imported studies", () => {
    const s = createStudy();
    expect(
      isStudy({
        ...s,
        tasks: [{ id: "t", title: "Review", note: "", done: false }],
        stars: true,
      }),
    ).toBe(true);
    expect(
      isStudy({
        ...s,
        tasks: [{ id: "t", title: "Review", note: "", done: "yes" }],
      }),
    ).toBe(false);
    expect(isStudy({ ...s, stars: "yes" })).toBe(false);
    expect(isStudy({ ...s, siteSearch: { candidates: [null] } })).toBe(false);
  });
  it("AI app edits reject invalid coordinates and unknown execution tools", async () => {
    const s = createStudy(),
      update = vi.fn();
    const workspace = { study: s, update } as unknown as WorkspaceValue;
    const result = await executeActions(
      [{ type: "set_study", patch: { site: { ...s.site, lat: 100 } } }],
      workspace,
      s,
      () => {},
    );
    expect(update).not.toHaveBeenCalled();
    expect(JSON.stringify(result.results)).toContain("failed");
    const second = await executeActions(
      [{ type: "execute_shell", command: "no" }],
      workspace,
      s,
      () => {},
    );
    expect(JSON.stringify(second.results)).toContain("Unknown action");
  });
  it("AI accepts validated reversible changes and refuses stale proposals", async () => {
    const s = createStudy(),
      update = vi.fn();
    const workspace = { study: s, update } as unknown as WorkspaceValue;
    await executeActions(
      [{ type: "set_map", patch: { view: "2d", stars: true } }],
      workspace,
      s,
      () => {},
    );
    expect(update).toHaveBeenCalledWith({ view: "2d", stars: true });
    await expect(
      executeActions([], workspace, { ...s, name: "stale" }, () => {}),
    ).rejects.toThrow("Study changed");
  });
  it("AI export actions call the workspace exporter and return failures", async () => {
    const s = createStudy(), exportFile = vi.fn().mockRejectedValue(new Error("PDF needs both calculated scenarios"));
    const workspace = { study: s, exportFile } as unknown as WorkspaceValue;
    const result = await executeActions(
      [{ type: "export_file", format: "pdf" }], workspace, s, () => {},
    );
    expect(exportFile).toHaveBeenCalledWith("pdf");
    expect(JSON.stringify(result.results)).toContain("PDF needs both calculated scenarios");
    expect(JSON.stringify(result.results)).toContain("failed");
  });
  it("preferences merge old documents without losing new defaults", () => {
    const saved = { theme: "dark", report: { maps: false } };
    vi.stubGlobal("localStorage", { getItem: () => JSON.stringify(saved) });
    const p = loadPreferences();
    expect(p.report.maps).toBe(true);
    expect(p.report.syntax).toBe(true);
    expect(p.ai.provider).toBe(DEFAULT_PREFERENCES.ai.provider);
    vi.unstubAllGlobals();
  });
});
