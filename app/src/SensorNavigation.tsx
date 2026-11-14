import { useEffect, useRef, useState } from "react";
import { GAP_MS, parseSample, routeProgress, Tracker } from "./inertialNavigation";
import type { Sample } from "./inertialNavigation";
import { bearing, travelTime } from "./surfaceRoutes";
import type { LunarPoint, Mobility } from "./surfaceRoutes";
import { readSensor, serial } from "./sensorSerial";

export default function SensorNavigation({ anchor, pickAnchor, mobility, path, speed, onTrack, onReturn }: {
  anchor: LunarPoint;
  pickAnchor: () => void;
  mobility: Mobility;
  path: LunarPoint[];
  speed: number;
  onTrack: (positions: LunarPoint[]) => void;
  onReturn: (position: LunarPoint) => void;
}) {
  const [replayMode, setReplayMode] = useState("wheel");
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [heading, setHeading] = useState("");
  const [earth, setEarth] = useState(false);
  const [step, setStep] = useState(0.6);
  const [threshold, setThreshold] = useState(0.3);
  const [interval, setIntervalMs] = useState(300);
  const [corridor, setCorridor] = useState(15);
  const [knownDistance, setKnownDistance] = useState(0);
  const [startSegment, setStartSegment] = useState(0);
  const [progress, setProgress] = useState<ReturnType<typeof routeProgress>>(null);
  const [snapshot, setSnapshot] = useState<{ sample: Sample; stale: boolean; age: number; issue: string;
    method?: Tracker["method"]; steps: number; position?: LunarPoint; tilt?: number }>();
  const stream = useRef<AbortController | null>(null);
  const tracker = useRef<Tracker | null>(null);
  const buffer = useRef<Sample[]>([]);
  const seen = useRef(0);
  const fixedAt = useRef(0);
  const track = useRef<LunarPoint[]>([]);
  const progressLeg = useRef(0);
  const gravity = earth ? 9.80665 : 1.62;

  function publish(now: number) {
    const sample = buffer.current.at(-1);
    if (!sample) return;
    const active = tracker.current;
    const position = active && active.method !== "Readings only" ? active.position : undefined;
    if (!earth && position && position !== track.current.at(-1)) {
      track.current = [...track.current.slice(-599),position];
      onTrack(track.current);
    }
    const stale = now-seen.current >= GAP_MS;
    const route = position && !stale && !active?.issue && !earth && path.length >= 2
      ? routeProgress(path,position,progressLeg.current,corridor) : null;
    if (route && route.crossTrack <= corridor) progressLeg.current = route.leg;
    setProgress(route);
    setSnapshot({
      sample, position, method: active?.method, steps: active?.steps ?? 0,
      issue: active?.issue ?? "", stale,
      age: fixedAt.current ? Math.floor((now-fixedAt.current)/1000) : 0,
      tilt: Math.abs(Math.hypot(...sample.accel)-gravity) < gravity*0.08
        ? Math.atan2(Math.hypot(sample.accel[0],sample.accel[1]),sample.accel[2])*180/Math.PI : undefined,
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (tracker.current && now-seen.current >= GAP_MS) {
        tracker.current.issue ||= "Telemetry stale. Re-anchor to continue.";
      }
      if (buffer.current.length) publish(now);
    },250);
    return () => clearInterval(timer);
  });
  useEffect(() => () => {
    stream.current?.abort();
    onTrack([]);
  }, [onTrack]);
  useEffect(() => {
    progressLeg.current = 0;
  }, [path]);

  function receive(line: string) {
    const sample = parseSample(line);
    if (!sample) return;
    const now = performance.now();
    const previous = buffer.current.at(-1);
    if (previous) {
      const stale = now-seen.current >= GAP_MS;
      if (!stale && sample.t_ms <= previous.t_ms) return;
      const gap = stale || sample.t_ms-previous.t_ms >= GAP_MS;
      if (gap) {
        if (tracker.current) tracker.current.issue ||= "Telemetry interrupted. Re-anchor to continue.";
        buffer.current = [];
      }
    }
    seen.current = now;
    buffer.current = [...buffer.current.filter(s => sample.t_ms-s.t_ms <= 2200).slice(-1023),sample];
    tracker.current?.ingest(sample);
  }

  function resetEstimate() {
    tracker.current = null;
    fixedAt.current = 0;
    progressLeg.current = 0;
    setProgress(null);
    track.current = [];
    onTrack([]);
    publish(performance.now());
  }

  function disconnect() {
    stream.current?.abort();
    stream.current = null;
    if (tracker.current) tracker.current.issue ||= "Sensor disconnected. Re-anchor to continue.";
    setSource("");
    publish(performance.now());
  }

  function begin(replay: boolean) {
    buffer.current = [];
    resetEstimate();
    setSnapshot(undefined);
    setError("");
    const controller = new AbortController();
    stream.current = controller;
    if (replay) {
      setSource("Replay");
      let t = 0;
      let wheel = 0;
      const timer = window.setInterval(() => {
        // Repeat stationary windows so the same stream can be re-anchored.
        const active = t % 12000 >= 4500 && t % 12000 < 9000;
        if (active) wheel += 0.05;
        const accel = [active && replayMode === "imu" ? 0.4 : 0,0,
          gravity+(active && t%500 < 100 && mobility === "walking" ? 0.65 : 0)];
        receive(JSON.stringify({ v:1, t_ms:t, accel,
          gyro:replayMode === "accel" ? undefined : [0,0,0],
          wheel_m:replayMode === "wheel" ? wheel : undefined }));

        t += 50;
      },50);
      controller.signal.addEventListener("abort",() => clearInterval(timer),{ once:true });
      return;
    }
    setSource("Opening USB serial");
    void readSensor(line => {
      if (stream.current === controller && !controller.signal.aborted) receive(line);
    },controller.signal,() => {
      if (stream.current === controller) setSource("USB serial connected");
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not read USB serial.");
    }).finally(() => {
      if (stream.current === controller) disconnect();
    });
  }

  function calibrate() {
    const now = performance.now();
    if (!source || !buffer.current.length || now-seen.current >= GAP_MS) { setError("Wait for fresh sensor samples."); return; }
    try {
      const active = new Tracker({ anchor, heading: Number(heading), mobility, gravity,
        stepLength:step, threshold, interval },buffer.current);
      tracker.current = active;
      fixedAt.current = now;
      track.current = [];
      onTrack([]);
      progressLeg.current = Math.min(startSegment,Math.max(0,path.length-2));
      setError("");
      publish(now);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Calibration failed."); }
  }

  const validHeading = heading.trim() !== "" && +heading >= 0 && +heading < 360;
  const live = source && snapshot?.position && !snapshot.stale && !snapshot.issue && !earth;

  return <details className="surface-nav-card surface-sensor-card">
    <summary>External sensor</summary>
    <div className="surface-nav-row">
      {source ? <button onClick={disconnect}>Disconnect</button> : <>
        <button disabled={!serial()} onClick={() => begin(false)}>Connect sensor</button>
        <button onClick={() => begin(true)}>Run replay</button>
      </>}
    </div>
    {!source && <label>Replay stream<select value={replayMode} onChange={e => setReplayMode(e.target.value)}>
      <option value="wheel">IMU and wheel encoder</option><option value="imu">Six-axis IMU</option>
      <option value="accel">Accelerometer only</option>
    </select></label>}
    <p role="status">{source || (serial() ? "Sensor disconnected" : "USB serial unavailable in this browser")}
      {source && snapshot?.stale ? " · telemetry stale" : ""}</p>
    <label>Gravity<select value={earth ? "earth" : "moon"} disabled={!!source} onChange={e => {
      setEarth(e.target.value === "earth"); resetEstimate(); setSnapshot(undefined);
    }}><option value="moon">Lunar · 1.62 m/s²</option><option value="earth">Earth bench test · 9.80665 m/s²</option></select></label>
    <p>Known point {anchor[1].toFixed(5)}°, {anchor[0].toFixed(5)}° E</p>
    <button onClick={pickAnchor}>Pick known point on map</button>
    <label>Known heading clockwise from north (°)<input type="number" min="0" max="359.999" value={heading}
      onChange={e => setHeading(e.target.value)} /></label>
    <p>Hold still for two seconds before anchoring. Mount +X forward, +Y left, +Z up.</p>
    <button disabled={!source || !snapshot || snapshot.stale || !validHeading ||
      (mobility === "walking" && !(step >= 0.01 && step <= 5 && threshold > 0 && interval >= 100))}
      onClick={calibrate}>Calibrate and anchor</button>
    {mobility === "walking" && <>
      <label>Step length (m)<input type="number" min=".01" max="5" step=".01" value={step} onChange={e => {setStep(+e.target.value);resetEstimate();}} /></label>
      <label>Step threshold (m/s²)<input type="number" min=".01" step=".01" value={threshold} onChange={e => {setThreshold(+e.target.value);resetEstimate();}} /></label>
      <label>Minimum step interval (ms)<input type="number" min="100" value={interval} onChange={e => {setIntervalMs(+e.target.value);resetEstimate();}} /></label>
      <label>Measured calibration walk (m)<input type="number" min="0" value={knownDistance || ""} onChange={e => setKnownDistance(+e.target.value)} /></label>
      <button disabled={!snapshot?.steps || !(knownDistance > 0)} onClick={() => {
        if (!snapshot?.steps) return;
        const length = knownDistance/snapshot.steps;
        if (length < 0.01 || length > 5) {
          setError("Check the measured distance and detected steps.");
          return;
        }
        setStep(length);
        resetEstimate();
        setError("");
      }}>Set step length from detected steps</button>
      {snapshot?.method === "Steps + manual heading" && <button disabled={!validHeading || !source || !!snapshot.issue || snapshot.stale}
        onClick={() => tracker.current?.setHeading(Number(heading))}>Apply heading for next straight leg</button>}
      <small>Step estimates depend on gait. Mount the sensor securely at the waist.</small>
    </>}
    {path.length >= 2 && <>
      <label>Route corridor (m)<input type="number" min="1" value={corridor}
        onChange={e => setCorridor(Math.max(1,+e.target.value))} /></label>
      <label>Starting segment for next anchor<select value={Math.min(startSegment,path.length-2)}
        onChange={e => setStartSegment(+e.target.value)}>
        {path.slice(1).map((point,i) => <option key={i} value={i}>
          {i+1} · toward {point[1].toFixed(5)}°, {point[0].toFixed(5)}°
        </option>)}
      </select></label>
    </>}
    {error && <p role="alert">{error}</p>}
    {snapshot && <>
      <p>Acceleration {snapshot.sample.accel.map(n => n.toFixed(2)).join(", ")} m/s²
        {snapshot.tilt !== undefined && snapshot.method === "Readings only" ? ` · Tilt if stationary ${snapshot.tilt.toFixed(1)}°` : ""}</p>
      {snapshot.method && <p>{snapshot.method} · {snapshot.age} s since anchor{mobility === "walking" ? ` · ${snapshot.steps} steps` : ""}</p>}
      {snapshot.issue && <p role="status">{snapshot.issue}</p>}
      {snapshot.position && <p>{earth ? "Bench simulation" : "Estimated position"} {snapshot.position[1].toFixed(6)}°, {snapshot.position[0].toFixed(6)}° E</p>}
      {live && source !== "Replay" && snapshot.position && <button onClick={() => onReturn(snapshot.position!)}>Use estimate as return start</button>}
      {live && progress && <p>{progress.crossTrack.toFixed(1)} m from route · {progress.crossTrack <= corridor
        ? `${progress.remaining.toFixed(0)} m left · ETA ${travelTime(progress.remaining,speed)} · Next waypoint ${Math.round(bearing(snapshot.position!,progress.next)) % 360}°`
        : "Outside corridor · live ETA paused"}</p>}
    </>}
  </details>;
}
