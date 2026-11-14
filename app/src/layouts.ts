import type { DockviewApi } from "dockview-react";
export function arrange(api: DockviewApi, preset: string) {
  api.clear();
  const panel = (
    id: string,
    title: string,
    reference?: string,
    direction?: "left" | "right" | "below" | "above",
    width?: number,
  ) =>
    api.addPanel({
      id,
      component: id,
      title,
      position: reference
        ? { referencePanel: reference, direction }
        : undefined,
      initialWidth: width,
    });
  panel("map", "Lunar map");
  if (preset === "mapping") {
    panel("explorer", "Project explorer", "map", "left", 220);
    panel("inspector", "Study properties", "map", "right", 280);
    panel("analysis", "Geometry & timeline", "map", "below");
  } else if (preset === "planning") {
    panel("mission", "Mission plan", "map", "right", 480);
    panel("tasks", "Tasks", "mission", "below");
    panel("analysis", "Geometry & timeline", "map", "below");
  } else if (preset === "analysis") {
    panel("science", "Mission analysis", "map", "right", 600);
    panel("analysis", "Geometry & timeline", "map", "below");
  } else if (preset === "comparison") {
    panel("inspector", "Study properties", "map", "left", 300);
    panel("science", "Mission analysis", "map", "right", 480);
    panel("analysis", "Geometry & timeline", "map", "below");
  }
  api
    .getPanel(
      preset === "planning"
        ? "mission"
        : preset === "analysis"
          ? "science"
          : "map",
    )
    ?.api.setActive();
}
