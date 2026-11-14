import { DEFAULT_REPORT } from "./preferences";
import type { ReportOptions } from "./preferences";
import { SCIENCE_SOURCES } from "./science";
import { cursorTime, totals } from "./study";
import type { Geometry, Study } from "./study";
export function saveFile(content: Blob | string, type: string, name: string) {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const escapeXML = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const quoted = (s: unknown) => `"${String(s ?? "").replaceAll('"', '""')}"`;
export const fileName = (s: Study) =>
  s.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 70) || "lunar-study";
export function studyJSON(s: Study, geometry?: Geometry, compare?: Geometry) {
  return JSON.stringify(
    {
      format: "lunar-window-study-v2",
      study: s,
      results: { A: geometry, B: compare },
      provenance: {
        imagery: "NASA/GSFC/ASU LROC; NASA/JPL Moon Trek WMTS",
        body: "Moon",
        radius_m: 1737400,
        coordinates: "MOON_ME/DE421; east-positive selenographic degrees",
        geometry:
          "Local NASA SPICE DE440s + DE421 orientation; LT+S; optional coupled research models in results.analysis",
        satellites:
          "User-defined circular J2000 planning orbits, or explicitly selected NASA LRO definitive SPK; see individual source tags; not live telemetry",
      },
      science_sources: SCIENCE_SOURCES,
      exported_at: new Date().toISOString(),
    },
    null,
    2,
  );
}
export function geometryCSV(s: Study, a?: Geometry, b?: Geometry) {
  const rows = [
    "# Moon; MOON_ME/DE421; angles=degrees; positions=km; body-center angles; separate mission-analysis exports contain terrain/eclipse/resource screening; endpoint included; no live telemetry",
    "scenario,utc,elapsed_hours,body,id,azimuth_deg,elevation_deg,angular_radius_deg,x_km,y_km,z_km",
  ];
  for (const [scenario, g] of [
    ["A", a],
    ["B", b],
  ] as const) {
    for (const row of g?.rows || []) {
      for (const body of ["sun", "earth"] as const)
        rows.push(
          [
            scenario,
            row.time,
            row.elapsed,
            body,
            "",
            row[body].azimuth,
            row[body].elevation,
            row[body].radius,
            ...row[body].vector,
          ].join(","),
        );
      for (const [id, sat] of Object.entries(row.satellites))
        rows.push(
          [
            scenario,
            row.time,
            row.elapsed,
            "satellite",
            quoted(s.satellites.find((x) => x.id === id)?.name || id),
            "",
            sat.elevation,
            "",
            ...sat.position,
          ].join(","),
        );
    }
  }
  return rows.join("\n");
}
export function geoJSON(s: Study) {
  return {
    type: "FeatureCollection",
    planetary_reference: {
      body: "Moon",
      frame: "MOON_ME/DE421",
      radius_m: 1737400,
      units: "degrees east-positive; not terrestrial WGS84",
    },
    features: [
      ...(
        [
          ["A", s.site],
          ["B", s.compareSite],
        ] as const
      ).map(([id, site]) => ({
        type: "Feature",
        properties: {
          role: "study-point",
          scenario: id,
          name: site.name,
          height_m: site.height,
        },
        geometry: { type: "Point", coordinates: [site.lon, site.lat] },
      })),
      ...(s.missionStops ?? []).map((stop,index) => ({
        type: "Feature",
        properties: {role:"mission-stop", id:stop.id, name:stop.name || `Stop ${index+1}`, note:stop.description },
        geometry: {type:"Point", coordinates:stop.point},
      })),
      ...(s.prohibitedAreas ?? []).map((poly,index) => ({
        type: "Feature",
        properties: {role:"prohibited-area", name:`Prohibited area ${index+1}` },
        geometry: {type:"Polygon", coordinates:[[...poly,poly[0]]]},
      })),
      ...s.annotations.map((a) => ({
        type: "Feature",
        properties: { id: a.id, name: a.name, note: a.note, color: a.color, ...(a.route ? { route: a.route } : {}) },
        geometry:
          a.kind === "point"
            ? { type: "Point", coordinates: a.coordinates[0] }
            : a.kind === "line"
              ? { type: "LineString", coordinates: a.coordinates }
              : {
                  type: "Polygon",
                  coordinates: [[...a.coordinates, a.coordinates[0]]],
                },
      })),
    ],
  };
}
export function kml(s: Study) {
  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" hint="target=moon"><Document><name>${escapeXML(s.name)}</name><description>Moon, MOON_ME/DE421, R=1737400 m. Open in a Moon-configured viewer.</description>${geoJSON(
    s,
  )
    .features.map((f) => {
      const g = f.geometry;
      const coordinates =
        g.type === "Point"
          ? [g.coordinates]
          : g.type === "Polygon"
            ? (g.coordinates as number[][][])[0]
            : g.coordinates;
      const tag =
        g.type === "LineString"
          ? "LineString"
          : g.type === "Polygon"
            ? "Polygon"
            : "Point";
      const points = (coordinates as number[][])
        .map((c) => `${c[0]},${c[1]},0`)
        .join(" ");
      return `<Placemark><name>${escapeXML(f.properties.name)}</name><description>${escapeXML("note" in f.properties ? f.properties.note || "" : "Study point")}</description><${tag}>${tag === "Polygon" ? "<outerBoundaryIs><LinearRing>" : ""}<coordinates>${points}</coordinates>${tag === "Polygon" ? "</LinearRing></outerBoundaryIs>" : ""}</${tag}></Placemark>`;
    })
    .join("")}</Document></kml>`;
}
export function missionCSV(s: Study) {
  return [
    "name,type,start_utc,end_utc,offset_hours,duration_hours,status,notes",
    ...s.events.map((e) =>
      [
        e.name,
        e.type,
        new Date(Date.parse(s.start) + e.offset * 3600000).toISOString(),
        new Date(
          Date.parse(s.start) + (e.offset + e.duration) * 3600000,
        ).toISOString(),
        e.offset,
        e.duration,
        e.done ? "complete" : "planned",
        e.notes,
      ]
        .map(quoted)
        .join(","),
    ),
  ].join("\n");
}
export function missionICS(s: Study) {
  const time = (n: number) =>
    new Date(n)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const esc = (s: string) =>
    s
      .replaceAll("\\", "\\\\")
      .replaceAll("\n", "\\n")
      .replaceAll(",", "\\,")
      .replaceAll(";", "\\;");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lunar Window//Mission Plan//EN",
    ...s.events.flatMap((e) => [
      "BEGIN:VEVENT",
      `UID:${e.id}@lunar-window`,
      `DTSTAMP:${time(Date.now())}`,
      `DTSTART:${time(Date.parse(s.start) + e.offset * 3600000)}`,
      `DTEND:${time(Date.parse(s.start) + (e.offset + e.duration) * 3600000)}`,
      `SUMMARY:${esc(e.name)}`,
      `DESCRIPTION:${esc(e.notes)}`,
      `LOCATION:Moon ${s.site.lat} ${s.site.lon} E`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
export function chartSVG(s: Study, a?: Geometry, b?: Geometry) {
  const w = 1000,
    h = 320,
    l = 60,
    r = 25,
    t = 40,
    bottom = 50;
  const rows = [...(a?.rows || []), ...(b?.rows || [])];
  const min =
    Math.floor(
      Math.min(
        -5,
        ...rows.flatMap((x) => [x.sun.elevation, x.earth.elevation]),
      ) / 10,
    ) * 10;
  const max =
    Math.ceil(
      Math.max(
        5,
        ...rows.flatMap((x) => [x.sun.elevation, x.earth.elevation]),
      ) / 10,
    ) * 10;
  const y = (v: number) => t + ((max - v) / (max - min)) * (h - t - bottom);
  const x = (hours: number) => l + (hours / s.duration) * (w - l - r);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="white"/><text x="60" y="22" font-family="sans-serif" font-size="14">${escapeXML(s.name)} — Sun / Earth elevation (ideal 0° plane)</text>${Array.from(
    { length: 5 },
    (_, i) => {
      const v = min + ((max - min) * i) / 4;
      return `<line x1="${l}" x2="${w - r}" y1="${y(v)}" y2="${y(v)}" stroke="#ddd"/><text x="${l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11">${v.toFixed(0)}°</text>`;
    },
  ).join("")}${(
    [
      ["A", a],
      ["B", b],
    ] as const
  )
    .flatMap(([id, g]) =>
      (["sun", "earth"] as const).map(
        (body) =>
          `<polyline fill="none" stroke="${body === "sun" ? "#ac7408" : "#2467a1"}" stroke-width="2" ${id === "B" ? 'stroke-dasharray="6 4"' : ""} points="${(g?.rows || []).map((row) => `${x(s.alignment === "elapsed" ? row.elapsed : (Date.parse(row.time) - Date.parse(s.start)) / 3600000)},${y(row[body].elevation)}`).join(" ")}"/>`,
      ),
    )
    .join(
      "",
    )}<text x="60" y="305" font-family="sans-serif" font-size="11">Amber: Sun · Blue: Earth · Solid: A · Dashed: B · Alignment: ${s.alignment} · SPICE / MOON_ME</text></svg>`;
}
async function reportFigureFromSvg(svg: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 384;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not render the report chart image.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
function reportChartFallback(s: Study, a?: Geometry, b?: Geometry): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not create the required mission chart image.");
  const left = 76, right = 28, top = 58, bottom = 62;
  const min = Math.floor(Math.min(-5, ...(a?.rows || []).flatMap((r) => [r.sun.elevation, r.earth.elevation]), ...(b?.rows || []).flatMap((r) => [r.sun.elevation, r.earth.elevation])) / 10) * 10;
  const max = Math.ceil(Math.max(5, ...(a?.rows || []).flatMap((r) => [r.sun.elevation, r.earth.elevation]), ...(b?.rows || []).flatMap((r) => [r.sun.elevation, r.earth.elevation])) / 10) * 10;
  const x = (row: Geometry["rows"][number]) => left + ((s.alignment === "elapsed" ? row.elapsed : (Date.parse(row.time) - Date.parse(s.start)) / 3600000) / s.duration) * (canvas.width - left - right);
  const y = (value: number) => top + ((max - value) / (max - min)) * (canvas.height - top - bottom);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1a304e";
  ctx.font = "600 22px system-ui, sans-serif";
  ctx.fillText(`${s.name} — Sun / Earth elevation`, 34, 34);
  ctx.font = "14px system-ui, sans-serif";
  for (let i = 0; i <= 4; i++) {
    const value = min + ((max - min) * i) / 4;
    const py = y(value);
    ctx.strokeStyle = "#d8e0e8";
    ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(canvas.width - right, py); ctx.stroke();
    ctx.fillStyle = "#40536a";
    ctx.fillText(`${value.toFixed(0)}°`, 26, py + 4);
  }
  for (const [scenario, geometry] of [["A", a], ["B", b]] as const) {
    for (const [body, color] of [["sun", "#ac7408"], ["earth", "#2467a1"]] as const) {
      if (!geometry?.rows.length) continue;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash(scenario === "B" ? [9, 6] : []);
      ctx.beginPath();
      geometry.rows.forEach((row, index) => {
        const px = x(row), py = y(row[body].elevation);
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  ctx.fillStyle = "#ac7408"; ctx.fillText("Sun", left, canvas.height - 22);
  ctx.fillStyle = "#2467a1"; ctx.fillText("Earth", left + 54, canvas.height - 22);
  ctx.fillStyle = "#40536a"; ctx.fillText("Solid: A · Dashed: B · Reference-plane elevation", left + 118, canvas.height - 22);
  return canvas.toDataURL("image/png");
}
function reportLocatorImage(s: Study): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 620;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create the required report locator image.");
  const ctx = context;
  const x0 = 94, y0 = 94, mapW = 1012, mapH = 420;
  const x = (lon: number) => x0 + ((lon + 180) / 360) * mapW;
  const y = (lat: number) => y0 + ((90 - lat) / 180) * mapH;
  ctx.fillStyle = "#0c1b2d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f2f6fb";
  ctx.font = "600 30px system-ui, sans-serif";
  ctx.fillText("Lunar site locator", 44, 50);
  ctx.fillStyle = "#aab9ca";
  ctx.font = "16px system-ui, sans-serif";
  ctx.fillText("Coordinate schematic · not terrain imagery", 44, 76);
  ctx.fillStyle = "#182b40";
  ctx.fillRect(x0, y0, mapW, mapH);
  ctx.strokeStyle = "rgba(183,205,228,.24)";
  ctx.lineWidth = 1;
  for (let lon = -180; lon <= 180; lon += 30) {
    ctx.beginPath(); ctx.moveTo(x(lon), y0); ctx.lineTo(x(lon), y0 + mapH); ctx.stroke();
    ctx.fillStyle = "#afc0d2"; ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(`${lon}°`, x(lon) + 3, y0 + mapH + 20);
  }
  for (let lat = -90; lat <= 90; lat += 30) {
    ctx.beginPath(); ctx.moveTo(x0, y(lat)); ctx.lineTo(x0 + mapW, y(lat)); ctx.stroke();
    ctx.fillStyle = "#afc0d2"; ctx.font = "13px system-ui, sans-serif";
    ctx.fillText(`${lat}°`, 48, y(lat) + 4);
  }
  const sites = [["A", s.site, "#63c8ff"], ["B", s.compareSite, "#ffd166"]] as const;
  for (const [label, site, color] of sites) {
    const px = x(site.lon), py = y(site.lat);
    ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = "#07111d"; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.font = "700 17px system-ui, sans-serif";
    ctx.fillText(`${label} · ${site.name}`, px + 14, py - 12);
  }
  ctx.fillStyle = "#c9d6e4"; ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("East longitude", x0 + mapW - 100, y0 + mapH + 48);
  return canvas.toDataURL("image/png");
}
export type ReportImage = { label: string; image: string };
export async function exportPDF(
  s: Study,
  a: Geometry | undefined,
  b: Geometry | undefined,
  screenshot?: string,
  options: ReportOptions = DEFAULT_REPORT,
  views: ReportImage[] = [],
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: options.pageSize });
  const font = async (path: string, name: string) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error("Report font unavailable: " + path);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let raw = "";
    for (let i = 0; i < bytes.length; i += 8192)
      raw += String.fromCharCode(...bytes.subarray(i, i + 8192));
    doc.addFileToVFS(name + ".ttf", btoa(raw));
    doc.addFont(name + ".ttf", name, "normal");
  };
  await font("/fonts/NotoSans-Regular.ttf", "NotoSans");
  await font("/fonts/NotoSansMono-Regular.ttf", "NotoMono");
  const pageH = doc.internal.pageSize.getHeight(),
    pageW = doc.internal.pageSize.getWidth(),
    left = 18,
    width = pageW - 36,
    bottom = pageH - 20;
  let y = 22;
  const ink = "#1a304e";
  const clean = (text: string) =>
    text
      .replace(/\r/g, "")
      .replace(/[–—−]/g, "-")
      .replaceAll(String.fromCharCode(0), "")
      .replaceAll("≥", ">=")
      .replaceAll("≤", "<=")
      .replaceAll("≠", "!=")
      .replaceAll("∞", "infinity");
  const room = (height: number) => {
    if (y + height > bottom) {
      doc.addPage();
      y = 22;
    }
  };
  const line = (text: string, size = options.fontSize, color = ink) => {
    doc.setFont("NotoSans");
    doc.setFontSize(size);
    doc.setTextColor(color);
    const leading = size * 0.48 + 1;
    const lines: string[] = doc.splitTextToSize(clean(text), width);
    if (size >= 14) room(leading + 16);
    for (const entry of lines) {
      room(leading);
      doc.text(entry, left, y);
      y += leading;
    }
    y += 3;
  };
  const bullet = (text: string) => {
    doc.setFont("NotoSans");
    doc.setFontSize(options.fontSize);
    const lines: string[] = doc.splitTextToSize(clean(text), width - 6);
    for (let i = 0; i < lines.length; i++) {
      room(6);
      doc.setTextColor(ink);
      if (i === 0 && options.bullets) {
        doc.setFillColor(options.accent);
        doc.circle(left + 1, y - 1.2, 0.65, "F");
      }
      doc.text(lines[i], left + 5, y);
      y += 5.6;
    }
    y += 2;
  };
  const code = (source: string, language = "json") => {
    room(Math.min(100, source.split("\n").length * 4.5 + 18));
    line(language.toUpperCase(), 8, options.accent);
    doc.setFont("NotoMono");
    doc.setFontSize(7.5);
    const chars = Math.max(30, Math.floor(width / doc.getTextWidth("M")));
    for (const original of source.split("\n")) {
      const chunks = original.length
        ? Array.from({ length: Math.ceil(original.length / chars) }, (_, i) =>
            original.slice(i * chars, (i + 1) * chars),
          )
        : [""];
      for (const text of chunks) {
        room(4.5);
        doc.setFillColor("#eef3f9");
        doc.rect(left - 2, y - 3.2, width + 4, 4.5, "F");
        let x = left;
        const tokens =
          text.match(
            /"(?:[^"\\]|\\.)*"|#[^\n]*|\/\/[^\n]*|\b(?:true|false|null|None|True|False|const|let|function|return|def|import|from|class|if|else)\b|-?\b\d+(?:\.\d+)?\b|[^"#\w\d]+|\w+|./g,
          ) || [];
        for (const token of tokens) {
          let color = ink;
          if (options.syntax) {
            if (token.startsWith('"')) color = "#216e46";
            else if (/^(#|\/\/)/.test(token)) color = "#758391";
            else if (
              /^(true|false|null|None|True|False|const|let|function|return|def|import|from|class|if|else)$/.test(
                token,
              )
            )
              color = "#7947a8";
            else if (/^-?\d/.test(token)) color = "#b25b15";
          }
          doc.setTextColor(color);
          doc.text(clean(token), x, y);
          x += doc.getTextWidth(token);
        }
        y += 4.5;
      }
    }
    y += 5;
    doc.setFont("NotoSans");
  };
  const block = (text: string) => {
    const pieces = text.split(/```([\w+-]*)\n([\s\S]*?)```/);
    for (let i = 0; i < pieces.length; i += 3) {
      if (pieces[i].trim()) line(pieces[i].trim());
      if (pieces[i + 2]) code(pieces[i + 2], pieces[i + 1] || "text");
    }
  };
  const image = (img: string, caption: string) => {
    const props = doc.getImageProperties(img);
    const h = Math.min(112, (width * props.height) / props.width);
    room(h + 18);
    doc.addImage(img, "PNG", left, y, width, h, undefined, "FAST");
    y += h + 5;
    line(caption, 8);
  };
  line(s.name, 22, options.accent);
  line(options.title, 13, options.accent);
  line(
    `LUNA | ${new Date().toISOString().slice(0, 19)} UTC${options.author ? " | Prepared by " + options.author : ""}`,
    8,
  );
  block(s.description || "Lunar surface and mission planning study.");
  let liveMapIncluded = false;
  if (screenshot) {
    try {
      image(
        screenshot,
        `Map view captured at export time - scenario ${s.active}, ${cursorTime(s)}. Display imagery and elevation detail vary by region.`,
      );
      liveMapIncluded = true;
    } catch {
      // Replace an invalid or incomplete renderer capture with the coordinate schematic.
    }
  }
  if (!liveMapIncluded)
    image(
      reportLocatorImage(s),
      `Schematic coordinate locator for the study sites at ${cursorTime(s)}. Live map imagery was unavailable; this figure does not show terrain.`,
    );
  try {
    image(
      await reportFigureFromSvg(chartSVG(s, a, b)),
      "Calculated Sun and Earth elevation over mission time; reference-plane geometry.",
    );
  } catch {
    image(
      reportChartFallback(s, a, b),
      "Calculated Sun and Earth elevation over mission time; reference-plane geometry.",
    );
  }
  if (options.extraViews)
    for (const view of views) image(view.image, view.label);
  if (options.coordinates) {
    line("Study coordinates & time", 14, options.accent);
    for (const [id, site] of [
      ["A", s.site],
      ["B", s.compareSite],
    ] as const) {
      if (id === "B" && !options.includeComparison) continue;
      bullet(
        `${id}: ${site.name}; latitude ${site.lat.toFixed(6)} deg, east longitude ${site.lon.toFixed(6)} deg; reference-sphere height ${site.height.toFixed(2)} m. UTC start ${id === "A" ? s.start : s.compareStart}.`,
      );
    }
    line(
      `Duration ${s.duration} h. Step ${s.step} s. Frame MOON_ME / DE421; radius 1737.4 km.`,
      9,
    );
  }
  for (const [id, g] of [
    ["A", a],
    ["B", b],
  ] as const) {
    if (id === "B" && !options.includeComparison) continue;
    const t = totals(g);
    line(
      `Scenario ${id}: ${g ? `Sun center above reference ${t.sun.toFixed(2)} h, Earth ${t.earth.toFixed(2)} h; overlap ${t.overlap.toFixed(2)} h.` : "Calculation unavailable; no zero substituted."}`,
      9,
    );
  }
  if (options.mission) {
    line("Mission plan", 14, options.accent);
    if (!s.events.length) line("No activities defined.");
    if (s.tasks?.length) {
      line("Preparation tasks", 12, options.accent);
      for (const task of s.tasks)
        bullet(
          `${task.done ? "Complete" : "Open"}: ${task.title}${task.note ? " - " + task.note : ""}`,
        );
    }
    for (const e of [...s.events].sort((x, y) => x.offset - y.offset)) {
      bullet(
        `${e.name} - ${e.type} - ${new Date(Date.parse(s.start) + e.offset * 3600000).toISOString()} - duration ${e.duration} h - ${e.done ? "complete" : "planned"}`,
      );
      if (e.notes) block(e.notes);
    }
  }
  if (options.science)
    for (const [id, g] of [
      ["A", a],
      ["B", b],
    ] as const) {
      if (id === "B" && !options.includeComparison) continue;
      const result = g?.analysis;
      if (!result) continue;
      line(`Scenario ${id}: mission analysis`, 14, options.accent);
      bullet(
        `Terrain: ${result.terrain.status}. ${result.terrain.reason || ""} Observer height: ${g?.method.observer_height_m ?? "unknown"} m.`,
      );
      const unknown = result.rows.some((r) => r.terrain_unknown);
      bullet(
        `Minimum battery nominal ${(result.power.minimum_soc_nominal * 100).toFixed(1)}%. Conservative ${unknown ? "not established: unknown terrain, lower bound can be zero" : (result.power.minimum_soc_conservative * 100).toFixed(1) + "%"}. Reserve ${(result.power.reserve_floor * 100).toFixed(1)}%.`,
      );
      bullet(
        `${result.access.station}: ${result.access.available_hours_at_samples.toFixed(2)} h sampled known access; ${result.access.unknown_terrain_hours.toFixed(2)} h terrain-unknown. Eclipse overlap ${result.access.eclipse_hours_at_samples.toFixed(2)} h. Zero eclipse duration means none detected in this interval.`,
      );
      bullet(
        `Landing terrain screen: ${result.landing.status}; slope ${result.landing.slope_deg?.toFixed(2) ?? "unknown"} deg; residual roughness ${result.landing.roughness_rms_m?.toFixed(3) ?? "unknown"} m. Landing clearance is not established.`,
      );
      for (const event of result.events)
        bullet(
          `${event.kind}: ${event.time}; numerical bracket ${event.bracket_seconds.toFixed(3)} s.`,
        );
      if (options.assumptions) {
        room(114);
      line("Hardware & model assumptions", 12, options.accent);
        code(JSON.stringify(result.inputs, null, 2), "json");
      }
      for (const limitation of result.limitations) bullet(limitation);
    }
  if (options.recommendations && s.siteSearch) {
    line(s.siteSearch.area_scope === "region" ? "Study region landing and timing" : "Nearby and Moon-wide solar-site screening", 14, options.accent);
    if (s.siteSearch.area_scope === "region") {
      const region = s.annotations.find(a => a.kind === "polygon" && a.id === s.siteSearch?.region_id);
      const current = region && JSON.stringify(region.coordinates) === JSON.stringify(s.siteSearch.region);
      if (current) {
        line(region.name, 11);
        for (const window of s.siteSearch.region_windows ?? []) {
          bullet(`${window.start} | ${window.passing}/${window.sampled} pass sunlight and contact screens | ${window.known}/${window.sampled} assessed | ${window.mean_joint_hours.toFixed(1)} h mean overlap`);
        }
      } else bullet("These results refer to an earlier study-region boundary.");
    }
    line(s.siteSearch.method, 9);
    const measuredPass = (candidate: NonNullable<typeof s.siteSearch>['candidates'][number]) =>
      (candidate.terrain_unknown_hours ?? 0) <= 1e-7 &&
      candidate.meets_sun_contact_thresholds === true &&
      candidate.station_access_hours !== null && candidate.joint_sun_station_hours !== null &&
      candidate.landing.status === "screen-within-threshold";
    const reportCandidates = s.siteSearch.version === "sun-station-dates-v7"
      ? [...(s.siteSearch.same_date_candidates || []), ...(s.siteSearch.date_candidates || []).filter(measuredPass)]
      : s.siteSearch.candidates.filter(measuredPass);
    if (!reportCandidates.length)
      bullet("No location with measured terrain passed every configured site screen. Uncovered coordinates are omitted from this report.");
    for (const c of reportCandidates)
      bullet(
        `${c.lat.toFixed(6)} deg, ${c.lon.toFixed(6)} deg E; ${c.distance_km.toFixed(2)} km from origin; solar gain ${c.delta_energy_wh !== null ? c.delta_energy_wh.toFixed(1) + " Wh" : c.reference_delta_energy_wh == null ? "unknown" : "~" + c.reference_delta_energy_wh.toFixed(1) + " Wh reference-plane estimate"}; hazard screen ${c.landing.status}. Landing clearance not established.`,
      );
  }
  if (options.annotations) {
    line("Map annotations", 14, options.accent);
    if (!s.annotations.length) line("No annotations defined.");
    for (const note of s.annotations) {
      bullet(`${note.name} (${note.kind}): ${note.note}`);
      line(
        `Coordinates [east longitude, latitude]: ${note.coordinates.map((c) => c.map((n) => n.toFixed(6)).join(", ")).join(" | ")}`,
        8,
      );
    }
  }
  line("Spacecraft", 14, options.accent);
  for (const sat of s.satellites)
    bullet(
      sat.ephemeris
        ? `${sat.name}: NASA LRO definitive FDF/GSFC ACTUAL trajectory; 2022-09-15 through 2022-12-15. Not live telemetry.`
        : `${sat.name}: circular planning orbit; altitude ${sat.altitude} km, inclination ${sat.inclination} deg, RAAN ${sat.raan} deg, phase ${sat.phase} deg. Not a reconstructed spacecraft orbit.`,
    );
  if (options.sources) {
    line("Methods & sources", 14, options.accent);
    bullet(
      "SPICE apparent geometry LT+S, DE440s translations and DE421 lunar orientation. Map rendering may use LOLA elevation; visual exaggeration and mesh detail do not alter the numerical analysis. Sampled screening is not flight or landing certification.",
    );
    for (const source of SCIENCE_SOURCES) {
      line(source.title, 9, options.accent);
      line(source.url, 7);
    }
    line(`Kernels: ${(a?.kernels || []).join(", ")}`, 8);
  }
  line(
    "Export JSON alongside this report for complete machine-readable inputs, source hashes and model metadata.",
    8,
  );
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i);
    doc.setFont("NotoSans");
    doc.setFontSize(8);
    doc.setTextColor("#67788a");
    doc.text("LUNA | Moon / MOON_ME | Research screening", left, pageH - 9);
    doc.text(`${i} / ${doc.getNumberOfPages()}`, pageW - 18, pageH - 9, {
      align: "right",
    });
  }
  return doc.output("blob");
}
