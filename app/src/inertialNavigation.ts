import { surfaceDistance } from "./study";
import { bearing } from "./surfaceRoutes";
import type { LunarPoint, Mobility } from "./surfaceRoutes";

type Vector = [number, number, number];
export type Sample = { t_ms: number; accel: Vector; gyro?: Vector; wheel_m?: number };
export const GAP_MS = 1000;
const rad = Math.PI / 180;
const dot = (a: Vector, b: Vector) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const scale = (v: Vector, k: number): Vector => [v[0]*k, v[1]*k, v[2]*k];
const add = (a: Vector, b: Vector): Vector => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const subtract = (a: Vector, b: Vector) => add(a, scale(b, -1));
const cross = (a: Vector, b: Vector): Vector => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const norm = (v: Vector) => Math.hypot(...v);
const unit = (v: Vector) => scale(v, 1/norm(v));
const vector = (v: unknown, limit: number): v is Vector =>
  Array.isArray(v) && v.length === 3 && v.every(n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= limit);

export function parseSample(line: string): Sample | null {
  try {
    const data = JSON.parse(line);
    if (data?.v !== 1 || !Number.isSafeInteger(data.t_ms) || data.t_ms < 0 || !vector(data.accel, 500)
      || (data.gyro !== undefined && !vector(data.gyro, 100))
      || (data.wheel_m !== undefined && (!Number.isFinite(data.wheel_m) || data.wheel_m < 0))) return null;
    return { t_ms: data.t_ms, accel: data.accel, gyro: data.gyro, wheel_m: data.wheel_m };
  } catch { return null; }
}

export function destination(from: LunarPoint, east: number, north: number): LunarPoint {
  const distance = Math.hypot(east, north) / 1737400;
  if (!distance) return from;
  const lat = from[1] * rad;
  const lon = from[0] * rad;
  const cosLat = Math.cos(lat);
  const sinLat = Math.sin(lat);
  const radial: Vector = [cosLat*Math.cos(lon),cosLat*Math.sin(lon),sinLat];
  const eastAxis: Vector = [-Math.sin(lon),Math.cos(lon),0];
  const northAxis = cross(radial,eastAxis);
  const meters = Math.hypot(east,north);
  const tangent = add(scale(eastAxis,east/meters),scale(northAxis,north/meters));
  const [x,y,z] = add(scale(radial,Math.cos(distance)),scale(tangent,Math.sin(distance)));
  return [Math.atan2(y,x)/rad, Math.atan2(z,Math.hypot(x,y))/rad];
}

function rotate(v: Vector, axis: Vector, angle: number) {
  return add(add(scale(v, Math.cos(angle)), scale(cross(axis, v), Math.sin(angle))),
    scale(axis, dot(axis, v)*(1-Math.cos(angle))));
}

export type TrackingConfig = {
  anchor: LunarPoint; heading: number; mobility: Mobility; gravity: number;
  stepLength: number; threshold: number; interval: number;
};

export class Tracker {
  method: "Wheel + gyro" | "IMU only" | "Steps + gyro" | "Steps + manual heading" | "Readings only";
  position: LunarPoint;
  issue = "";
  steps = 0;
  last: Sample;
  readonly started: number;
  private basis: Vector[];
  private gyroBias: Vector;
  private accelScale: number;
  private velocity: Vector = [0, 0, 0];
  private previousAcceleration: Vector = [0, 0, 0];
  private displacement: Vector = [0, 0, 0];
  private lastStep = -Infinity;
  private above = false;

  private config: TrackingConfig;

  constructor(config: TrackingConfig, samples: Sample[]) {
    this.config = { ...config };
    const first = samples[0];
    this.last = samples[samples.length-1];
    if (!first || samples.length < 10 || this.last.t_ms-first.t_ms < 1900) throw Error("Collect two seconds of stationary samples.");
    const average = (values: Vector[]) => scale(values.reduce(add), 1/values.length);
    const mean = average(samples.map(s => s.accel));
    const gravity = config.gravity;
    const gyro = samples.every(s => s.gyro);
    const wheel = samples.every(s => s.wheel_m !== undefined);
    this.gyroBias = gyro ? average(samples.map(s => s.gyro!)) : [0,0,0];
    if (Math.abs(norm(mean)-gravity) > gravity*0.15
      || samples.some(s => norm(subtract(s.accel,mean)) > gravity*0.08 || (s.gyro && norm(s.gyro) > 0.08))
      || (wheel && samples.some(s => Math.abs(s.wheel_m!-first.wheel_m!) > 0.02))) {
      throw Error("Keep the sensor still and check the selected gravity and units.");
    }
    if (samples.some(s => Boolean(s.gyro) !== gyro || (s.wheel_m !== undefined) !== wheel)) {
      throw Error("Keep the available sensor fields consistent during calibration.");
    }
    this.accelScale = gravity/norm(mean);
    const up = unit(mean);
    const forward = subtract([1,0,0], scale(up,up[0]));
    if (norm(forward) < 0.25) throw Error("Mount +X forward with the sensor roughly upright.");
    const f = unit(forward);
    const right = cross(f, up);
    const heading = config.heading*rad;
    this.basis = [add(scale(f,Math.sin(heading)),scale(right,Math.cos(heading))),
      add(scale(f,Math.cos(heading)),scale(right,-Math.sin(heading))), up];
    this.started = this.last.t_ms;
    this.position = config.anchor;
    this.method = config.mobility === "walking" ? (gyro ? "Steps + gyro" : "Steps + manual heading")
      : gyro ? (wheel ? "Wheel + gyro" : "IMU only") : "Readings only";
  }

  setHeading(heading: number) { this.config.heading = heading; }

  ingest(sample: Sample) {
    if (this.issue || sample.t_ms <= this.last.t_ms) return;
    const elapsed = sample.t_ms-this.last.t_ms;
    if (elapsed >= GAP_MS) { this.issue = "Telemetry gap. Re-anchor to continue."; return; }
    if (this.method === "IMU only" && sample.t_ms-this.started > 5000) {
      this.issue = "Five-second IMU limit reached. Re-anchor to continue."; return;
    }
    const usesGyro = this.method === "Wheel + gyro" || this.method === "IMU only" || this.method === "Steps + gyro";
    if (usesGyro && !sample.gyro) { this.issue = "Gyro data missing. Re-anchor to continue."; return; }
    const dt = elapsed/1000;
    if (usesGyro && sample.gyro) {
      const rate = subtract(sample.gyro,this.gyroBias);
      const omega = norm(rate);
      if (omega) this.basis = this.basis.map(row => rotate(row,unit(rate),-omega*dt));
    }
    let heading = usesGyro ? Math.atan2(this.basis[0][0],this.basis[1][0]) : this.config.heading*rad;
    let distance = 0;
    if (this.method === "Wheel + gyro") {
      if (sample.wheel_m === undefined || sample.wheel_m < this.last.wheel_m!) {
        this.issue = "Wheel counter missing or reset. Re-anchor to continue."; return;
      }
      distance = sample.wheel_m-this.last.wheel_m!;
    } else if (this.config.mobility === "walking") {
      const above = norm(sample.accel)*this.accelScale-this.config.gravity >= this.config.threshold;
      if (above && !this.above && sample.t_ms-this.lastStep >= this.config.interval) {
        distance = this.config.stepLength;
        this.steps++;
        this.lastStep = sample.t_ms;
      }
      this.above = above;
    } else if (this.method === "IMU only") {
      const acceleration: Vector = [dot(this.basis[0],sample.accel)*this.accelScale,
        dot(this.basis[1],sample.accel)*this.accelScale,0];
      const next = add(this.velocity,scale(add(this.previousAcceleration,acceleration),dt/2));
      const delta = scale(add(this.velocity,next),dt/2);
      this.velocity = next;
      this.previousAcceleration = acceleration;
      distance = Math.hypot(delta[0],delta[1]);
      heading = Math.atan2(delta[0],delta[1]);
    }
    if (distance) {
      this.displacement = add(this.displacement,[distance*Math.sin(heading),distance*Math.cos(heading),0]);
      this.position = destination(this.config.anchor,this.displacement[0],this.displacement[1]);
    }
    this.last = sample;
  }
}

export function routeProgress(path: LunarPoint[], position: LunarPoint, leg: number, corridor: number) {
  const lengths = path.slice(1).map((point,i) => surfaceDistance(path[i],point)*1000);
  let index = Math.min(leg,lengths.length-1);
  if (index < 0) return null;
  let crossTrack = 0;
  let remaining = 0;
  for (; index < lengths.length; index++) {
    const length = lengths[index];
    const from = path[index], to = path[index+1];
    const distance = surfaceDistance(from,position)*1000;
    const angle = (bearing(from,position)-bearing(from,to))*rad;
    const along = distance*Math.cos(angle);
    const clamped = Math.max(0,Math.min(length,along));
    crossTrack = Math.hypot(distance*Math.sin(angle),along-clamped);
    remaining = length-clamped+lengths.slice(index+1).reduce((a,b) => a+b,0);
    if (index === lengths.length-1 || (length > 0 && (crossTrack > corridor
      || surfaceDistance(position,to)*1000 > Math.min(corridor,Math.max(0.5,length*0.15))))) break;
  }
  return { leg: index, crossTrack, remaining, next: path[index+1] };
}
