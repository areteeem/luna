import OfflinePanel from "./OfflinePanel";
import AISettingsPanel from "./AISettings";
import { useEffect, useState } from "react";
import type { Preferences, ReportOptions } from "./preferences";
import { useWorkspace } from "./WorkspaceContext";
import RangeSlider from "./RangeSlider";
import ReportPreviewInfo from "./ReportPreviewInfo";
import { HexColorPicker } from "react-colorful";
import { isLowPerformanceDevice } from "./preferences";
const shortcutGroups = [
  ["save", "Save projects"], ["open", "Open project"], ["new", "New project"], ["undo", "Undo"], ["redo", "Redo"],
  ["help", "Open help"], ["preferences", "Open preferences"], ["runTour", "Run tour"], ["exportPdf", "Export report"],
  ["map", "Open lunar map"], ["explorer", "Open project explorer"], ["inspector", "Open study properties"], ["analysis", "Open geometry & timeline"],
  ["mission", "Open mission plan"], ["table", "Open geometry table"], ["science", "Open mission analysis"], ["tasks", "Open tasks"], ["chat", "Open AI assistant"],
  ["pan", "Map: navigate"], ["site", "Map: set study point"], ["point", "Map: add note"], ["line", "Map: draw traverse"], ["polygon", "Map: draw study region"], ["measure", "Map: measure distance"],
  ["exportJson", "Export study JSON"], ["exportWorkspace", "Export workspace"], ["exportCsv", "Export geometry CSV"], ["exportGeojson", "Export GeoJSON"], ["exportKml", "Export KML"], ["exportMissionCsv", "Export mission CSV"], ["exportCalendar", "Export mission calendar"], ["exportSvg", "Export geometry chart"], ["exportPng", "Export map image"],
  ["duplicateProject", "Duplicate project"], ["closeProject", "Close active project"], ["focusStudy", "Focus study point"], ["fitMoon", "Fit whole Moon"],
  ["layoutMapping", "Mapping workspace"], ["layoutPlanning", "Mission planning layout"], ["layoutAnalysis", "Analysis layout"], ["layoutComparison", "Scenario comparison layout"], ["layoutFocus", "Focus map layout"],
  ["view3d", "Map view: 3D"], ["view2d", "Map view: 2D"], ["viewOblique", "Map view: oblique"],
] as const;
function ShortcutCapture({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [recording, setRecording] = useState(false);
  const label = recording ? "Press shortcut…" : value.replace("Mod", navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl");
  return (
    <button
      className={`shortcut-capture ${recording ? "recording" : ""}`}
      aria-label={recording ? "Press shortcut now" : `Shortcut ${label}. Click to change`}
      onClick={() => setRecording(true)}
      onKeyDown={(event) => {
        if (!recording) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") { setRecording(false); return; }
        if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return;
        const key = event.key === "," ? "Comma" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
        const modifiers = [event.metaKey || event.ctrlKey ? "Mod" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : ""].filter(Boolean);
        onChange([...modifiers, key].join("+"));
        setRecording(false);
      }}
      onBlur={() => setRecording(false)}
    >
      {label}
    </button>
  );
}
export function PreferencesPanel({
  initial = "appearance",
}: {
  initial?: string;
}) {
  const { preferences: p, setPreferences: set, notify } = useWorkspace();
  const [tab, setTab] = useState(initial);
  const [accentDraft, setAccentDraft] = useState(p.report.accent);
  useEffect(() => setAccentDraft(p.report.accent), [p.report.accent]);
  const edit = (patch: Partial<Preferences>) => set({ ...p, ...patch });
  const report = (patch: Partial<ReportOptions>) =>
    edit({ report: { ...p.report, ...patch, maps: true } });
  return (
    <div className="settings-layout">
      <nav aria-label="Preference sections">
        {[
          ["appearance", "Appearance"],
          ["general", "General"],
          ["report", "Report setup"],
          ["offline", "Offline maps"],
          ["ai", "AI & models"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      <main>
        {tab === "appearance" ? (
          <>
            <h2>Appearance</h2>
            <p>Choose a readable workspace for your environment.</p>
            <label className="field">
              Theme
              <select
                value={p.theme}
                onChange={(e) =>
                  edit({ theme: e.target.value as Preferences["theme"] })
                }
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">Match system</option>
              </select>
            </label>
            <label className="field">
              Workspace material
              <select
                value={p.appearance}
                onChange={(e) =>
                  edit({
                    appearance: e.target.value as Preferences["appearance"],
                  })
                }
              >
                <option value="solid">Solid engineering workspace</option>
                <option value="glass">Frosted glass</option>
              </select>
            </label>
            <details className="terrain-preferences" open>
              <summary>Lunar surface & performance</summary>
              <label className="field">Rendering mode
                <select value={p.terrainMode} onChange={(e) => edit({ terrainMode: e.target.value as Preferences["terrainMode"] })}>
                  <option value="auto">Auto · adapt to this device</option><option value="terrain">3D terrain · real elevation</option><option value="image">Image map · lowest graphics load</option>
                </select>
              </label>
              <label className="field">Terrain detail
                <select value={p.terrainQuality} onChange={(e) => edit({ terrainQuality: e.target.value as Preferences["terrainQuality"] })}>
                  <option value="low">Low · save memory and battery</option><option value="balanced">Balanced</option><option value="high">High · finer mesh and sharper rendering</option>
                </select>
              </label>
              <label className="field">Elevation exaggeration · {p.terrainExaggeration.toFixed(1)}×
                <RangeSlider label="Elevation exaggeration" min={1} max={5} step={0.1} value={p.terrainExaggeration} onChange={(terrainExaggeration) => edit({ terrainExaggeration })} />
              </label>
              <Check label="Reduce detail automatically when navigation is slow" value={p.adaptiveTerrain} onChange={(adaptiveTerrain) => edit({ adaptiveTerrain })} />
              <Check label="Show 3D spacecraft models and orbit animation" value={p.hardware3d} onChange={(hardware3d) => edit({ hardware3d })} />
              <Check label="Pause 3D models automatically on lower-performance devices" value={p.performanceGuard} onChange={(performanceGuard) => edit({ performanceGuard })} />
              <Check label="Enable WASD lunar navigation" value={p.wasdNavigation} onChange={(wasdNavigation) => edit({ wasdNavigation })} />
              <p className="hint">{isLowPerformanceDevice() ? "This device reports limited memory or CPU capacity. 3D models and orbit animation are paused while the performance guard is on." : "3D models and orbit movement use additional graphics resources. The performance guard can pause them when this device reports limited resources."} Use View → Moon walk to enter keyboard navigation; WASD moves and Shift increases speed.</p>
              <p className="hint">1× shows actual height. Exaggeration changes the display only. NASA LOLA global elevation is about 1.9 km per pixel; loaded south-pole data adds 80 m regional and 5 m Site04 detail where covered. Image mode uses a flat map. Auto may choose it on slower devices.</p>
            </details>
            <Check
              label="Enable backdrop blur"
              value={p.blur}
              onChange={(blur) => edit({ blur })}
            />
            <Check
              label="Map-responsive glass UI"
              value={p.mapGlass}
              onChange={(mapGlass) => edit({ mapGlass })}
            />
            <Check
              label="Compact desktop menus"
              value={p.compact}
              onChange={(compact) => edit({ compact })}
            />
            <Check
              label="Camera animations"
              value={p.animations}
              onChange={(animations) => edit({ animations })}
            />
            <p className="hint">
              Blur applies across menus, tabs, panels, and map overlays. Turn
              on map-responsive glass to expand the lunar map behind the full
              workspace and frost the UI while the map is visible.
            </p>
          </>
        ) : null}
        {tab === "general" ? (
          <>
            <h2>General</h2>
            <Check
              label="Show explanatory hints"
              value={p.showHints}
              onChange={(showHints) => edit({ showHints })}
            />
            <label className="field">
              Pinch zoom sensitivity
              <RangeSlider
                label="Pinch zoom sensitivity"
                min={0.25}
                max={3}
                step={0.25}
                value={p.pinchSensitivity}
                onChange={(pinchSensitivity) => edit({ pinchSensitivity })}
              />
            </label>
            <label className="field">
              Save delay (milliseconds)
              <input
                type="number"
                min="250"
                max="10000"
                value={p.autosaveMs}
                onChange={(e) =>
                  edit({
                    autosaveMs: Math.max(
                      250,
                      Math.min(10000, Number(e.target.value)),
                    ),
                  })
                }
              />
            </label>
            <p>
              Project coordinates use east-positive lunar degrees. Dates use
              UTC, independent of your computer timezone.
            </p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(location.origin);
                notify("Local app address copied");
              }}
            >
              Copy app address
            </button>
            <section className="shortcut-settings">
              <details>
                <summary>Keyboard shortcuts</summary>
                <p className="hint">Click a shortcut, then press its replacement. Mod means Command on Mac and Ctrl on Windows or Linux. Press Escape to cancel.</p>
                {shortcutGroups.map(([key, title]) => (
                  <label className="shortcut-row" key={key}>
                    <span>{title}</span>
                    <ShortcutCapture
                      value={p.shortcuts[key] || ""}
                      onChange={(value) => {
                        const conflict = Object.entries(p.shortcuts).find(
                          ([otherKey, shortcut]) => otherKey !== key && shortcut === value,
                        );
                        if (conflict) {
                          notify(`That shortcut is already assigned to ${shortcutGroups.find(([id]) => id === conflict[0])?.[1] || conflict[0]}.`);
                          return;
                        }
                        edit({ shortcuts: { ...p.shortcuts, [key]: value } });
                      }}
                    />
                  </label>
                ))}
              </details>
            </section>
          </>
        ) : null}
        {tab === "report" ? (
          <>
            <div className="report-title-row">
              <h2>Report setup</h2>
              <ReportPreviewInfo label="Full report" />
            </div>
            <p>
              Controls apply to the next PDF export. Your project data stays
              editable.
            </p>
            <label className="field">
              Report heading
              <input
                value={p.report.title}
                onChange={(e) =>
                  report({ title: e.target.value.slice(0, 120) })
                }
              />
            </label>
            <label className="field">
              Prepared by
              <input
                value={p.report.author}
                onChange={(e) =>
                  report({ author: e.target.value.slice(0, 120) })
                }
              />
            </label>
            <div className="field-pair">
              <label className="field">
                Paper
                <select
                  value={p.report.pageSize}
                  onChange={(e) =>
                    report({
                      pageSize: e.target.value as ReportOptions["pageSize"],
                    })
                  }
                >
                  <option value="a4">A4</option>
                  <option value="letter">US Letter</option>
                </select>
              </label>
              <label className="field">
                Body font size
                <input
                  type="number"
                  min="8"
                  max="14"
                  value={p.report.fontSize}
                  onChange={(e) =>
                    report({
                      fontSize: Math.max(
                        8,
                        Math.min(14, Number(e.target.value)),
                      ),
                    })
                  }
                />
              </label>
            </div>
            <div className="report-accent-field">
              <span>Accent color</span>
              <div className="report-accent-control">
                <HexColorPicker aria-label="Report accent color" color={p.report.accent} onChange={(accent) => report({ accent })} />
                <div className="report-accent-options">
                  <label>HEX<input aria-label="Report accent HEX value" value={accentDraft} maxLength={7} onChange={(e) => { const value = e.target.value; if (/^#[\da-f]{0,6}$/i.test(value)) { setAccentDraft(value); if (value.length === 7) report({ accent: value }); } }} onBlur={() => { if (!/^#[\da-f]{6}$/i.test(accentDraft)) setAccentDraft(p.report.accent); }} /></label>
                  <div className="report-color-swatches" aria-label="Suggested report accent colors">
                    {["#285e99", "#3e7f63", "#9c5d36", "#7454a6", "#a33d4d", "#263746"].map((color) => <button key={color} type="button" aria-label={`Use ${color}`} title={color} style={{ backgroundColor: color }} onClick={() => report({ accent: color })} />)}
                  </div>
                  <span className="report-accent-preview" style={{ backgroundColor: p.report.accent }}>Report accent preview</span>
                </div>
              </div>
            </div>
            {(
              [
                ["extraViews", "Additional map views"],
                ["coordinates", "Coordinates and site details"],
                ["mission", "Mission plan"],
                ["science", "Science analysis"],
                ["includeComparison", "Include comparison B"],
                ["assumptions", "Hardware / syntax-colored JSON"],
                ["recommendations", "Site recommendations"],
                ["annotations", "Map annotations"],
                ["sources", "Scientific sources"],
                ["bullets", "Bullet lists"],
                ["syntax", "Color code by language"],
              ] as const
            ).map(([key, label]) => (
              <div className="report-option-row" key={key}>
                <Check
                  label={label}
                  value={p.report[key]}
                  onChange={(v) => report({ [key]: v })}
                />
              </div>
            ))}
            <p className="hint">
              Every PDF includes a site image and mission geometry chart. If the
              live lunar map is unavailable, a labeled coordinate schematic is
              included instead; it never stands in for terrain imagery. Unknown
              results are labeled; no flight clearance is issued.
            </p>
          </>
        ) : null}
        {tab === "offline" ? <OfflinePanel /> : null}
        {tab === "ai" ? <AISettingsPanel /> : null}
        {tab === "help" ? (
          <>
            <h2>Preferences help</h2>
            <p>
              Theme changes colors. Glass controls transparency; blur softens
              content behind transparent surfaces. Report setup selects the
              sections and images included in exported PDFs. General settings
              control navigation and autosave. Offline maps manage downloaded
              imagery separately from the science kernels and DEMs.
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}
export function Check({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check-row">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}
