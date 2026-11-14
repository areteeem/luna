import { useEffect, useRef } from "react";

/** Frost the live scene at the app layer, outside Dockview's isolated shells. */
export default function FrostedBackdrop() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const layer = ref.current;
    const app = layer?.parentElement;
    if (!layer || !app) return;
    let frame = 0;
    let previous = "";
    const update = () => {
      frame = 0;
      const active = document.documentElement.dataset.mapGlassActive === "true";
      const boxes = active ? Array.from(app.querySelectorAll<HTMLElement>(".panel-scroll, .analysis-panel, .chat-panel, .dv-tabs-and-actions-container, .unified-header, .project-tabs, .statusbar, .map-tools, .map-info, .map-model-note")).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(element).visibility === "hidden") return [];
        return [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height, radius: getComputedStyle(element).borderRadius }];
      }) : [];
      const signature = JSON.stringify(boxes);
      if (signature === previous) return;
      previous = signature;
      layer.replaceChildren(...boxes.map((box) => {
        const pane = document.createElement("div");
        pane.className = "live-frost-pane";
        Object.assign(pane.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, borderRadius: box.radius });
        return pane;
      }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const changes = new MutationObserver((records) => {
      if (records.some((record) => !layer.contains(record.target))) schedule();
    });
    changes.observe(app, { subtree: true, childList: true, attributes: true, attributeFilter: ["style", "class"] });
    const theme = new MutationObserver(schedule);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-map-glass-active", "data-theme"] });
    const resize = new ResizeObserver(schedule); resize.observe(app);
    window.addEventListener("resize", schedule);
    schedule();
    return () => { cancelAnimationFrame(frame); changes.disconnect(); theme.disconnect(); resize.disconnect(); window.removeEventListener("resize", schedule); };
  }, []);
  return <div id="frosted-scene-layer" ref={ref} aria-hidden="true" />;
}
