import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye } from "@phosphor-icons/react";
import { useWorkspace } from "./WorkspaceContext";
import { exportPDF } from "./exports";
import type { ReportOptions } from "./preferences";

export default function ReportPreviewInfo({ label, section }: { label: string; section?: keyof ReportOptions }) {
  const w = useWorkspace();
  const previewId = useId();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 80, left: 80 });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let objectUrl = "";
    const options = { ...w.preferences.report };
    if (section && typeof options[section] === "boolean") {
      for (const key of ["maps", "extraViews", "coordinates", "mission", "science", "assumptions", "recommendations", "annotations", "sources"] as const)
        options[key] = key === section;
      if (section === "extraViews") options.maps = true;
      Object.assign(options, { [section]: true });
    }
    void (async () => {
      const screenshot = options.maps ? await w.mapActions.current?.readyScreenshot() : undefined;
      return exportPDF(w.study, w.geometry, w.compare, screenshot, options);
    })().then((blob) => {
      if (disposed) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch((e) => { if (!disposed) setError(String(e)); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [open, section, w.study, w.geometry, w.compare, w.preferences.report]);
  const show = () => {
    clearTimeout(timer.current);
    if (open) return;
    timer.current = setTimeout(() => {
      const rect = button.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(12, Math.min(rect.right + 12, window.innerWidth - 440)), top: Math.max(12, Math.min(rect.top - 80, window.innerHeight - 570)) });
      setUrl(""); setError(""); setOpen(true);
    }, 220);
  };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 180); };
  return <>
    <button ref={button} type="button" className="report-preview-info" aria-label={`Preview ${label} as printed`} title={`Hover to preview ${label}`} aria-expanded={open} aria-controls={open ? previewId : undefined} aria-haspopup="dialog" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} onClick={() => { clearTimeout(timer.current); setUrl(""); setError(""); setOpen((value) => !value); }}><Eye size={16} weight="regular" /></button>
    {open && createPortal(<aside id={previewId} role="dialog" className="report-hover-preview" onFocusCapture={() => clearTimeout(timer.current)} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); button.current?.focus(); } }} style={position} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide} aria-label={`${label} PDF preview`}>
      <header><strong>{label}</strong><button onClick={() => setOpen(false)} aria-label="Close preview">×</button></header>
      <p>Current project · actual PDF layout · {w.preferences.report.pageSize.toUpperCase()}</p>
      {url ? <iframe title={`${label} as printed in the PDF`} src={`${url}#toolbar=0&navpanes=0&view=FitH`} /> : <p role="status">{error || "Rendering PDF preview…"}</p>}
    </aside>, document.body)}
  </>;
}
