// Built-in (non-script) Unity components: Camera, MeshFilter/Renderer, Animation, AudioSource.
import { Component } from './scene.js';
import { mat, quat, DEG } from './math.js';

export class Camera extends Component {
  constructor(go, d = {}) {
    super(go);
    this.kind = 'Camera';
    this.enabled = d.on ?? true;
    this.clearFlags = d.clear ?? 2;
    this.backgroundColor = d.bg ?? [0, 0, 0, 1];
    this.rect = d.rect ?? [0, 0, 1, 1];
    this.near = d.near ?? 0.3;
    this.far = d.far ?? 1000;
    this.fieldOfView = d.fov ?? 60;
    this.orthographic = d.ortho ?? false;
    this.orthographicSize = d.size ?? 5;
    this.depth = d.depth ?? 0;
    this.cullingMask = d.mask ?? -1;
  }

  // world -> screen projection for a viewport rectangle in canvas pixels
  projector(vp) {
    const m = this.transform.matrix;
    // drop scale from the camera matrix
    const view = mat.invert(mat.trs([m[3], m[7], m[11]], this.transform.rotation, [1, 1, 1]));
    const aspect = vp.w / vp.h;
    const near = this.near;
    if (this.orthographic) {
      const hh = this.orthographicSize, hw = hh * aspect;
      const toScreen = (p) => {
        const c = mat.point(view, p);
        return [vp.x + (c[0] / hw + 1) * 0.5 * vp.w, vp.y + (1 - c[1] / hh) * 0.5 * vp.h, c[2]];
      };
      return { view, vp, toScreen };
    }
    const t = Math.tan((this.fieldOfView * DEG) / 2);
    const toScreen = (p) => {
      const c = mat.point(view, p);
      if (c[2] <= near * 0.5) {
        return null;
      }
      return [vp.x + (c[0] / (c[2] * t * aspect) + 1) * 0.5 * vp.w, vp.y + (1 - c[1] / (c[2] * t)) * 0.5 * vp.h, c[2]];
    };
    return { view, vp, toScreen };
  }

  // Unity Camera.WorldToScreenPoint (pixels, origin bottom-left, z = distance)
  WorldToScreenPoint(p) {
    const W = this.world.screenWidth, H = this.world.screenHeight;
    const s = this.projector({ x: 0, y: 0, w: W, h: H }).toScreen(p);
    return s ? [s[0], H - s[1], s[2]] : [0, 0, -1];
  }

  ScreenToWorldPoint(sp) {
    const W = this.world.screenWidth, H = this.world.screenHeight;
    const nx = (sp[0] / W) * 2 - 1, ny = (sp[1] / H) * 2 - 1;
    let c;
    if (this.orthographic) {
      c = [nx * this.orthographicSize * (W / H), ny * this.orthographicSize, sp[2]];
    } else {
      const t = Math.tan((this.fieldOfView * DEG) / 2);
      c = [nx * t * (W / H) * sp[2], ny * t * sp[2], sp[2]];
    }
    return mat.point(mat.trs(this.transform.position, this.transform.rotation, [1, 1, 1]), c);
  }

  ScreenPointToRay(sp) {
    const o = this.transform.position;
    const p = this.ScreenToWorldPoint([sp[0], sp[1], 1]);
    const d = [p[0] - o[0], p[1] - o[1], p[2] - o[2]];
    const l = Math.hypot(...d);
    return { origin: o, direction: d.map((x) => x / l) };
  }
}

export class MeshFilter extends Component {
  constructor(go, meshKey) {
    super(go);
    this.kind = 'MeshFilter';
    this.meshKey = meshKey;
  }
  get mesh() { return this.meshKey; }
  set mesh(k) { this.meshKey = k; }
  get sharedMesh() { return this.meshKey; }
}

export class Renderer extends Component {
  constructor(go, d) {
    super(go);
    this.kind = 'Renderer';
    this.kinds = ['MeshRenderer', 'Renderer'];
    this.enabled = d.on;
    this.materials = d.mats.slice();
    this.subsets = d.subs.slice();
    this.alpha = 1;
  }
  get filter() { return this.gameObject.GetComponent('MeshFilter'); }
  get meshKey() { const f = this.filter; return f ? f.meshKey : null; }
  get combined() { return this.subsets.length > 0; }
  meshData() { const k = this.meshKey; return k ? this.world.assets.meshes[k] : null; }
  // world-space AABB of the mesh, with Unity's Bounds.IntersectRay
  get bounds() {
    const m = this.meshData();
    const M = this.transform.matrix;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const used = this.combined ? new Set(this.subsets.flatMap((i) => m.subs[i])) : null;
    for (let i = 0; m && i < m.v.length / 3; i++) {
      if (used && !used.has(i)) {
        continue;
      }
      const p = mat.point(M, [m.v[i * 3], m.v[i * 3 + 1], m.v[i * 3 + 2]]);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], p[k]);
        max[k] = Math.max(max[k], p[k]);
      }
    }
    return { min, max, IntersectRay: (ray) => rayHitsBox(ray, min, max) };
  }
  get material() { return this.materials[0]; }
  set material(m) { this.materials[0] = m; }
  get sharedMaterial() { return this.materials[0]; }
  set sharedMaterial(m) { this.materials[0] = m; }
}

function rayHitsBox(ray, min, max) {
  let t0 = -Infinity, t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const o = ray.origin[k], d = ray.direction[k];
    if (Math.abs(d) < 1e-12) {
      if (o < min[k] || o > max[k]) {
        return false;
      }
      continue;
    }
    let a = (min[k] - o) / d, b = (max[k] - o) / d;
    if (a > b) {
      [a, b] = [b, a];
    }
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
  }
  return t1 >= Math.max(t0, 0);
}

// ---------------------------------------------------------------- animation
export class AnimationState {
  constructor(anim, name, clip) {
    this.anim = anim;
    this.name = name;
    this.clip = clip;
    this.time = 0;
    this.speed = 1;
    this.weight = 1;
    this.enabled = false;
    this.wrapMode = clip.wrap || 0;
    this.length = clipLength(clip);
  }
  get normalizedTime() { return this.length ? this.time / this.length : 0; }
  set normalizedTime(v) { this.time = v * this.length; }
}

function clipLength(clip) {
  let len = 0;
  for (const kind of ['rot', 'pos', 'scale', 'float']) {
    for (const c of clip[kind]) {
      if (c.keys.length) {
        len = Math.max(len, c.keys[c.keys.length - 1][0]);
      }
    }
  }
  return len;
}

const WRAP = { Default: 0, Once: 1, Loop: 2, PingPong: 4, ClampForever: 8 };

export class Animation extends Component {
  constructor(go, d) {
    super(go);
    this.kind = 'Animation';
    this.enabled = d.on;
    this.playAutomatically = d.play;
    this.wrapMode = d.wrap;
    this.states = {};
    const clips = this.world.assets.clips;
    const keys = [d.clip, ...d.clips].filter(Boolean);
    for (const k of keys) {
      const clip = clips[k];
      if (clip && !this.states[clip.name] && !isImportStub(clip)) {
        this.states[clip.name] = new AnimationState(this, clip.name, clip);
      }
    }
    this.defaultName = d.clip && clips[d.clip] ? clips[d.clip].name : null;
    this.isPlaying = false;
  }

  get clip() { return this.defaultName ? this.states[this.defaultName].clip : null; }
  get(name) { return this.states[name]; }

  Play(name, mode) {
    const n = name || this.defaultName;
    const st = this.states[n];
    if (!st) {
      return false;
    }
    for (const s of Object.values(this.states)) {
      if (s !== st) {
        s.enabled = false;
      }
    }
    st.enabled = true;
    st.time = st.speed < 0 ? st.length : 0;
    this.isPlaying = true;
    return true;
  }

  CrossFade(name) { return this.Play(name); }
  // QueueMode.CompleteOthers: starts once everything playing now has finished
  PlayQueued(name) {
    if (this.isPlaying) {
      this.queued = name;
    } else {
      this.Play(name);
    }
  }
  Rewind(name) {
    for (const s of Object.values(this.states)) {
      if (!name || s.name === name) {
        s.time = 0;
      }
    }
  }
  Stop(name) {
    for (const s of Object.values(this.states)) {
      if (!name || s.name === name) {
        s.enabled = false;
        s.time = 0;
      }
    }
    this.isPlaying = Object.values(this.states).some((s) => s.enabled);
  }
  IsPlaying(name) { return !!this.states[name] && this.states[name].enabled; }
  Sample() {
    for (const s of Object.values(this.states)) {
      if (s.enabled) {
        this.apply(s, s.time);
      }
    }
  }

  update(dt) {
    if (!this.enabled) {
      return;
    }
    let any = false;
    for (const s of Object.values(this.states)) {
      if (!s.enabled) {
        continue;
      }
      s.time += dt * s.speed;
      const wrap = s.wrapMode || this.wrapMode || WRAP.Once;
      let t = s.time;
      if (wrap === WRAP.Loop) {
        t = s.length ? ((t % s.length) + s.length) % s.length : 0;
      } else if (wrap === WRAP.PingPong) {
        const L = s.length || 1, k = ((t % (2 * L)) + 2 * L) % (2 * L);
        t = k > L ? 2 * L - k : k;
      } else if (t >= s.length || t < 0) {
        t = Math.max(0, Math.min(t, s.length));
        if (wrap !== WRAP.ClampForever) {
          this.apply(s, t);
          s.enabled = false;
          continue;
        }
      }
      this.apply(s, t);
      any = true;
    }
    this.isPlaying = any;
    if (!any && this.queued) {
      this.Play(this.queued);
      this.queued = null;
    }
  }

  apply(state, t) {
    const clip = state.clip;
    const root = this.transform;
    for (const c of clip.pos) {
      const tr = c.path ? root.Find(c.path) : root;
      if (tr) {
        tr.localPosition = evalCurve(c.keys, t, 3);
        tr.dirty();
      }
    }
    for (const c of clip.rot) {
      const tr = c.path ? root.Find(c.path) : root;
      if (tr) {
        tr.localRotation = quat.normalize(evalCurve(c.keys, t, 4));
        tr.dirty();
      }
    }
    for (const c of clip.scale) {
      const tr = c.path ? root.Find(c.path) : root;
      if (tr) {
        tr.localScale = evalCurve(c.keys, t, 3);
        tr.dirty();
      }
    }
    for (const c of clip.float) {
      const tr = c.path ? root.Find(c.path) : root;
      if (tr) {
        applyFloat(tr.gameObject, c, evalCurve(c.keys, t, 1)[0]);
      }
    }
  }
}

function applyFloat(go, curve, v) {
  const attr = curve.attr;
  if (attr === 'm_Enabled') {
    const r = go.renderer;
    if (r && curve.cls === 23) {
      r.enabled = v > 0.5;
    }
  } else if (attr.startsWith('m_Color') || attr.startsWith('_Color')) {
    if (attr.endsWith('.a') && go.renderer) {
      go.renderer.alpha = v;
    }
  }
}

// Hermite evaluation of Unity keyframes [time, value(n), inSlope(n), outSlope(n)]
export function evalCurve(keys, t, n) {
  if (!keys.length) {
    return new Array(n).fill(0);
  }
  if (t <= keys[0][0]) {
    return keys[0].slice(1, 1 + n);
  }
  const last = keys[keys.length - 1];
  if (t >= last[0]) {
    return last.slice(1, 1 + n);
  }
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1][0] < t) {
    i++;
  }
  const k0 = keys[i], k1 = keys[i + 1];
  const dt = k1[0] - k0[0];
  const s = (t - k0[0]) / dt;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const out = new Array(n);
  for (let j = 0; j < n; j++) {
    const p0 = k0[1 + j], p1 = k1[1 + j];
    let m0 = k0[1 + 2 * n + j] * dt, m1 = k1[1 + n + j] * dt;
    if (!Number.isFinite(m0) || !Number.isFinite(m1)) {
      out[j] = s < 1 ? p0 : p1; // stepped key
      continue;
    }
    out[j] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
  }
  return out;
}

export class AudioSource extends Component {
  constructor(go, d = {}) {
    super(go);
    this.kind = 'AudioSource';
    this.clip = d.clip || null;
    this.playOnAwake = d.playOnAwake ?? false;
    this.volume = d.volume ?? 1;
    this.pitch = d.pitch ?? 1;
    this.loop = d.loop ?? false;
    this.enabled = true;
    this.voice = null;
  }
  Play() {
    this.Stop();
    if (this.clip) {
      this.voice = this.world.audio.play(this.clip, { volume: this.volume, loop: this.loop, pitch: this.pitch });
    }
  }
  PlayOneShot(clip, vol = 1) {
    this.world.audio.play(clip, { volume: this.volume * vol });
  }
  Stop() {
    if (this.voice) {
      this.voice.stop();
      this.voice = null;
    }
  }
  get isPlaying() { return !!this.voice && this.voice.playing; }
}

// Maya-import "Default" clips holding one key a frame before 0: the original evidently never applies them
// (the start menu's character panel only lines up with its buttons when they are skipped)
function isImportStub(clip) {
  const curves = [...clip.pos, ...clip.rot, ...clip.scale, ...(clip.float || [])];
  return curves.length > 0 && curves.every((c) => c.keys.length === 1 && c.keys[0][0] < 0);
}
