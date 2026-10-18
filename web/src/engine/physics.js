// Unity-style physics on top of planck.js (Box2D). The game is 2D on the z = 0 plane, so every 3D collider becomes
// the 2D cross-section of its shape with that plane (dynamic bodies are sliced through their own centre instead).
import * as planck from '../../vendor/planck.mjs';
import { Component } from './scene.js';
import { mat, quat, v3 } from './math.js';

const { Vec2 } = planck;
planck.Settings.maxTranslation = 60;   // Box2D's default (2 units/step) is far below this game's speeds
planck.Settings.maxPolygonVertices = 16;

export const PHYS = {
  gravity: -90,            // mainData PhysicsManager
  fixedDt: 0.0333333,      // mainData TimeManager (0x3d072b02)
  maxAngularVelocity: 7,   // PhysicsManager default max angular velocity
  velocityIterations: 20,  // solver iteration count
  positionIterations: 8,
};

// ------------------------------------------------------------------ custom angular velocity drive (ConfigurableJoint)
// Drives a body's angular velocity toward a target with a torque limit, without constraining its position.
class AngularDrive extends planck.Joint {
  constructor(body, ground) {
    super({}, body, ground);
    this.m_type = 'angular-drive';
    this.target = 0;
    this.maxTorque = 0;
    this.impulse = 0;
  }
  initVelocityConstraints(step) {
    this.invI = this.m_bodyA.m_invI;
    this.impulse = 0;
  }
  solveVelocityConstraints(step) {
    if (!this.invI || this.maxTorque <= 0) {
      return;
    }
    const w = this.m_bodyA.c_velocity.w;
    let imp = -(w - this.target) / this.invI;
    const old = this.impulse, max = this.maxTorque * step.dt;
    this.impulse = Math.max(-max, Math.min(max, old + imp));
    imp = this.impulse - old;
    this.m_bodyA.c_velocity.w = w + this.invI * imp;
  }
  solvePositionConstraints() { return true; }
  getAnchorA() { return this.m_bodyA.getPosition(); }
  getAnchorB() { return this.m_bodyA.getPosition(); }
  getReactionForce() { return Vec2(0, 0); }
  getReactionTorque() { return 0; }
}

// ------------------------------------------------------------------ components
export class Rigidbody extends Component {
  constructor(go, d = {}) {
    super(go);
    this.kind = 'Rigidbody';
    this._mass = d.mass ?? 1;
    this._drag = d.drag ?? 0;
    this._angularDrag = d.adrag ?? 0.05;
    this._useGravity = d.gravity ?? true;
    this._isKinematic = d.kinematic ?? false;
    this.interpolation = d.interp ?? 0;
    this.freezeRotation = d.freezeRot ?? false;
    this.pb = null;
    this.prev = null;   // previous fixed-step pose for interpolation
  }
  get physics() { return this.world.physics; }

  get mass() { return this._mass; }
  set mass(m) { this._mass = m; this.physics.updateMass(this); }
  get drag() { return this._drag; }
  set drag(v) { this._drag = v; if (this.pb) { this.pb.setLinearDamping(v); } }
  get angularDrag() { return this._angularDrag; }
  set angularDrag(v) { this._angularDrag = v; if (this.pb) { this.pb.setAngularDamping(v); } }
  get useGravity() { return this._useGravity; }
  set useGravity(v) { this._useGravity = v; if (this.pb) { this.pb.setGravityScale(v ? 1 : 0); } }
  get isKinematic() { return this._isKinematic; }
  set isKinematic(v) {
    if (v === this._isKinematic) {
      return;
    }
    this._isKinematic = v;
    if (this.pb) {
      this.physics.syncFromTransform(this);
      this.pb.setType(v ? 'kinematic' : 'dynamic');
      this.physics.updateMass(this);
      if (v) {
        this.pb.setLinearVelocity(Vec2(0, 0));
        this.pb.setAngularVelocity(0);
      }
      this.pb.setAwake(true);
    }
  }

  get velocity() {
    if (!this.pb) {
      return [0, 0, 0];
    }
    const v = this.pb.getLinearVelocity();
    return [v.x, v.y, 0];
  }
  set velocity(v) {
    if (this.pb && !this._isKinematic) {
      this.pb.setLinearVelocity(Vec2(v[0], v[1]));
      this.pb.setAwake(true);
    }
  }
  get angularVelocity() { return [0, 0, this.pb ? this.pb.getAngularVelocity() : 0]; }
  set angularVelocity(v) {
    if (this.pb && !this._isKinematic) {
      this.pb.setAngularVelocity(v[2]);
      this.pb.setAwake(true);
    }
  }

  // mode: 0 Force, 1 Impulse, 2 VelocityChange, 5 Acceleration (Unity ForceMode values)
  AddForce(f, mode = 0) {
    if (!this.pb || this._isKinematic) {
      return;
    }
    const m = this._mass;
    if (mode === 1) {
      this.pb.applyLinearImpulse(Vec2(f[0], f[1]), this.pb.getWorldCenter(), true);
    } else if (mode === 2) {
      const v = this.pb.getLinearVelocity();
      this.pb.setLinearVelocity(Vec2(v.x + f[0], v.y + f[1]));
    } else if (mode === 5) {
      this.pb.applyForceToCenter(Vec2(f[0] * m, f[1] * m), true);
    } else {
      this.pb.applyForceToCenter(Vec2(f[0], f[1]), true);
    }
  }
  AddRelativeForce(f, mode) { this.AddForce(this.transform.TransformDirection(f), mode); }
  AddForceAtPosition(f, p, mode = 0) {
    if (!this.pb || this._isKinematic) {
      return;
    }
    if (mode === 1) {
      this.pb.applyLinearImpulse(Vec2(f[0], f[1]), Vec2(p[0], p[1]), true);
    } else {
      this.pb.applyForce(Vec2(f[0], f[1]), Vec2(p[0], p[1]), true);
    }
  }
  AddTorque(t, mode = 0) {
    if (!this.pb || this._isKinematic) {
      return;
    }
    if (mode === 1) {
      this.pb.applyAngularImpulse(t[2], true);
    } else {
      this.pb.applyTorque(t[2], true);
    }
  }
  AddExplosionForce(force, pos, radius) {
    const p = this.transform.position, d = v3.sub(p, pos), l = v3.len(d);
    if (l < radius) {
      this.AddForce(v3.scale(v3.norm(d), force * (1 - l / radius)), 1);
    }
  }
  MovePosition(p) {
    this.transform.position = p;
    if (this.pb) {
      this.physics.syncFromTransform(this);
    }
  }
  MoveRotation(q) {
    this.transform.rotation = q;
    if (this.pb) {
      this.physics.syncFromTransform(this);
    }
  }
  get position() { return this.transform.position; }
  set position(p) { this.MovePosition(p); }
  get rotation() { return this.transform.rotation; }
  set rotation(q) { this.MoveRotation(q); }
  WakeUp() { if (this.pb) { this.pb.setAwake(true); } }
  Sleep() { if (this.pb) { this.pb.setAwake(false); } }
  IsSleeping() { return this.pb ? !this.pb.isAwake() : true; }
  GetPointVelocity(p) {
    if (!this.pb) {
      return [0, 0, 0];
    }
    const v = this.pb.getLinearVelocityFromWorldPoint(Vec2(p[0], p[1]));
    return [v.x, v.y, 0];
  }
  SetDensity() {}
}

export class Collider extends Component {
  constructor(go, type, d) {
    super(go);
    this.kind = 'Collider';
    this.kinds = [type, 'Collider'];
    this.type = type;
    this.d = d;
    this._isTrigger = d.trigger;
    this._enabled = true;
    this.fixtures = [];
    this.material = d.mat || null;
  }
  get isTrigger() { return this._isTrigger; }
  set isTrigger(v) {
    this._isTrigger = v;
    for (const f of this.fixtures) {
      f.setSensor(v);
    }
  }
  get enabled() { return this._enabled; }
  set enabled(v) {
    this._enabled = v;
    this.world.physics.colliderChanged(this);
  }
  get attachedRigidbody() {
    for (let t = this.transform; t; t = t.parent) {
      const rb = t.gameObject.GetComponent('Rigidbody');
      if (rb) {
        return rb;
      }
    }
    return null;
  }
  get bounds() {
    const pts = this.worldCorners();
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) {
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i]);
        max[i] = Math.max(max[i], p[i]);
      }
    }
    const center = v3.scale(v3.add(min, max), 0.5);
    return { min, max, center, size: v3.sub(max, min), extents: v3.scale(v3.sub(max, min), 0.5) };
  }
  worldCorners() {
    const M = this.transform.matrix;
    const d = this.d;
    if (this.type === 'BoxCollider') {
      return boxCorners(d.center, d.size).map((p) => mat.point(M, p));
    }
    if (this.type === 'SphereCollider') {
      const c = mat.point(M, d.center), r = d.radius * maxScale(M);
      return [v3.sub(c, [r, r, r]), v3.add(c, [r, r, r])];
    }
    if (this.type === 'CapsuleCollider') {
      const r = d.radius, h = Math.max(d.height, 2 * r);
      const size = [2 * r, 2 * r, 2 * r];
      size[d.dir] = h;
      return boxCorners(d.center, size).map((p) => mat.point(M, p));
    }
    const mesh = this.world.assets.meshes[d.mesh];
    const out = [];
    if (mesh) {
      for (let i = 0; i < mesh.v.length; i += 3) {
        out.push(mat.point(M, [mesh.v[i], mesh.v[i + 1], mesh.v[i + 2]]));
      }
    }
    return out.length ? out : [this.transform.position];
  }
  // Unity BoxCollider.size / center accessors used by scripts
  get size() { return this.d.size; }
  set size(s) { this.d.size = s; this.world.physics.colliderChanged(this); }
  get center() { return this.d.center; }
  set center(c) { this.d.center = c; this.world.physics.colliderChanged(this); }
  get radius() { return this.d.radius; }
  set radius(r) { this.d.radius = r; this.world.physics.colliderChanged(this); }

  Raycast(ray, dist) {
    return this.world.physics.raycast(ray.origin, ray.direction, dist, (c) => c === this);
  }
}

class Joint extends Component {
  constructor(go) {
    super(go);
    this.kind = 'Joint';
    this._connectedBody = null;
    this.anchor = [0, 0, 0];
    this.axis = [0, 0, 1];
    this.breakForce = Infinity;
    this.breakTorque = Infinity;
    this.pj = null;
    this.dirtyJoint = true;
    go.world.physics.joints.add(this);
  }
  get connectedBody() { return this._connectedBody; }
  set connectedBody(b) { this._connectedBody = b; this.dirtyJoint = true; }
  destroyJoint() {
    if (this.pj) {
      this.world.physics.w.destroyJoint(this.pj);
      this.pj = null;
    }
  }
}

export class HingeJoint extends Joint {
  constructor(go, d) {
    super(go);
    this.kinds = ['HingeJoint', 'Joint'];
    this.useSpring = false;
    this.spring = { spring: 0, damper: 0, targetPosition: 0 };
    this.useMotor = false;
    this.motor = { targetVelocity: 0, force: 0, freeSpin: false };
    this.useLimits = false;
    this.limits = { min: 0, max: 0 };
    if (d) {
      this._connectedBody = d.connected;   // resolved to a Rigidbody by the world loader
      this.anchor = d.anchor;
      this.axis = d.axis;
      this.useSpring = d.useSpring;
      this.spring = { spring: d.spring[0], damper: d.spring[1], targetPosition: d.spring[2] };
      this.useMotor = d.useMotor;
      this.motor = { targetVelocity: d.motor[0], force: d.motor[1], freeSpin: !!d.motor[2] };
      this.useLimits = d.useLimits;
      this.limits = { min: d.limits[0], max: d.limits[1] };
      this.breakForce = d.breakForce;
      this.breakTorque = d.breakTorque;
    }
  }
  get angle() {
    if (!this.pj) {
      return 0;
    }
    return -this.pj.getJointAngle() * 180 / Math.PI;
  }
}

export class FixedJoint extends Joint {
  constructor(go) {
    super(go);
    this.kinds = ['FixedJoint', 'Joint'];
  }
}

// Only what BodyBehaviour / enemies use: free or locked linear x/y, and the z angular velocity drive.
export class ConfigurableJoint extends Joint {
  constructor(go) {
    super(go);
    this.kinds = ['ConfigurableJoint', 'Joint'];
    this.xMotion = 2; this.yMotion = 2; this.zMotion = 0;
    this.angularXMotion = 0; this.angularYMotion = 0; this.angularZMotion = 2;
    this.targetAngularVelocity = [0, 0, 0];
    this.angularYZDrive = { mode: 2, positionSpring: 0, positionDamper: 0, maximumForce: 0 };
    this.angularXDrive = { mode: 0, positionSpring: 0, positionDamper: 0, maximumForce: 0 };
    this.linearLimit = { limit: 0, spring: 0, damper: 0, bounciness: 0 };
    this.rotationDriveMode = 0;
    this.lockPos = null;
  }
}

function boxCorners(c, s) {
  const out = [];
  for (const sx of [-0.5, 0.5]) {
    for (const sy of [-0.5, 0.5]) {
      for (const sz of [-0.5, 0.5]) {
        out.push([c[0] + sx * s[0], c[1] + sy * s[1], c[2] + sz * s[2]]);
      }
    }
  }
  return out;
}

function maxScale(M) {
  return Math.max(Math.hypot(M[0], M[4], M[8]), Math.hypot(M[1], M[5], M[9]), Math.hypot(M[2], M[6], M[10]));
}

const BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) {
    return p;
  }
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-9) {
      lower.pop();
    }
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-9) {
      upper.pop();
    }
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function polygonArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i][0] * q[1] - q[0] * p[i][1];
  }
  return Math.abs(a) / 2;
}

// Cross-section of a convex point set (given as edges) with the plane z = zc.
function sliceEdges(pts, edges, zc) {
  const out = [];
  for (const [i, j] of edges) {
    const a = pts[i], b = pts[j];
    const da = a[2] - zc, db = b[2] - zc;
    if (Math.abs(da) < 1e-9) {
      out.push([a[0], a[1]]);
    }
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// World-space 2D shapes for a collider: [{type:'poly', pts}|{type:'circle', c, r}|{type:'chain', pts}]
export function colliderShapes(col, zc, assets) {
  const M = col.transform.matrix;
  const d = col.d;
  if (col.type === 'BoxCollider') {
    const pts = boxCorners(d.center, d.size).map((p) => mat.point(M, p));
    // a box whose depth is tiny but which sits at the slicing plane: use its xy footprint
    const zs = pts.map((p) => p[2]);
    if (Math.max(...zs) - Math.min(...zs) < 1e-4) {
      if (Math.abs(zs[0] - zc) > 0.5) {
        return [];
      }
      const h = hull(pts.map((p) => [p[0], p[1]]));
      return h.length >= 3 ? [{ type: 'poly', pts: h }] : [];
    }
    const h = hull(sliceEdges(pts, BOX_EDGES, zc));
    return h.length >= 3 && polygonArea(h) > 1e-4 ? [{ type: 'poly', pts: h }] : [];
  }
  if (col.type === 'SphereCollider') {
    const c = mat.point(M, d.center), r = d.radius * maxScale(M);
    const dz = c[2] - zc;
    if (Math.abs(dz) >= r) {
      return [];
    }
    return [{ type: 'circle', c: [c[0], c[1]], r: Math.sqrt(r * r - dz * dz) }];
  }
  if (col.type === 'CapsuleCollider') {
    const ax = [0, 0, 0];
    ax[d.dir] = 1;
    const sc = [Math.hypot(M[0], M[4], M[8]), Math.hypot(M[1], M[5], M[9]), Math.hypot(M[2], M[6], M[10])];
    const others = [0, 1, 2].filter((i) => i !== d.dir);
    const r = d.radius * Math.max(sc[others[0]], sc[others[1]]);
    const half = Math.max(0, d.height * sc[d.dir] / 2 - r);
    const c = mat.point(M, d.center);
    const dirW = v3.norm(mat.dir(M, ax));
    const p1 = v3.add(c, v3.scale(dirW, half)), p2 = v3.sub(c, v3.scale(dirW, half));
    const out = [];
    for (const p of [p1, p2]) {
      const dz = p[2] - zc;
      if (Math.abs(dz) < r) {
        out.push({ type: 'circle', c: [p[0], p[1]], r: Math.sqrt(r * r - dz * dz) });
      }
    }
    if (out.length === 2) {
      const dx = p1[0] - p2[0], dy = p1[1] - p2[1], l = Math.hypot(dx, dy);
      if (l > 1e-3) {
        const nx = -dy / l * out[0].r, ny = dx / l * out[0].r;
        out.push({ type: 'poly', pts: [[p1[0] + nx, p1[1] + ny], [p2[0] + nx, p2[1] + ny], [p2[0] - nx, p2[1] - ny], [p1[0] - nx, p1[1] - ny]] });
      }
    }
    return out;
  }
  // MeshCollider: intersect every triangle with the plane, then chain the segments
  const mesh = assets.meshes[d.mesh];
  if (!mesh) {
    return [];
  }
  const v = mesh.v;
  const W = [];
  for (let i = 0; i < v.length; i += 3) {
    W.push(mat.point(M, [v[i], v[i + 1], v[i + 2]]));
  }
  const segs = [];
  for (const sub of mesh.subs) {
    for (let i = 0; i < sub.length; i += 3) {
      const tri = [W[sub[i]], W[sub[i + 1]], W[sub[i + 2]]];
      const s = sliceEdges(tri, [[0, 1], [1, 2], [2, 0]], zc);
      if (s.length >= 2) {
        const a = s[0], b = s[s.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-4) {
          segs.push([a, b]);
        }
      }
    }
  }
  if (d.convex || col.attachedRigidbody) {
    const h = hull(segs.flat());
    return h.length >= 3 ? [{ type: 'poly', pts: h }] : [];
  }
  return chainSegments(segs).map((pts) => ({ type: 'chain', pts }));
}

function chainSegments(segs) {
  const k = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const adj = new Map();
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const kk = k(s[e]);
      if (!adj.has(kk)) {
        adj.set(kk, []);
      }
      adj.get(kk).push(i);
    }
  });
  const used = new Set();
  const chains = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) {
      continue;
    }
    used.add(i);
    const line = [segs[i][0], segs[i][1]];
    for (const dir of [1, 0]) {
      for (;;) {
        const end = dir ? line[line.length - 1] : line[0];
        const next = (adj.get(k(end)) || []).find((j) => !used.has(j));
        if (next === undefined) {
          break;
        }
        used.add(next);
        const s = segs[next];
        const other = k(s[0]) === k(end) ? s[1] : s[0];
        if (dir) {
          line.push(other);
        } else {
          line.unshift(other);
        }
      }
    }
    // drop near-duplicate points
    const clean = [line[0]];
    for (const p of line.slice(1)) {
      const q = clean[clean.length - 1];
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01) {
        clean.push(p);
      }
    }
    if (clean.length >= 2) {
      chains.push(clean);
    }
  }
  return chains;
}

// ------------------------------------------------------------------ world
export class Physics {
  constructor(world) {
    this.world = world;
    this.w = new planck.World({ gravity: Vec2(0, PHYS.gravity) });
    this.ground = this.w.createBody();
    this.rigidbodies = new Set();
    this.statics = new Map();  // collider -> planck body (colliders without a rigidbody)
    this.joints = new Set();
    this.drives = new Map();   // ConfigurableJoint -> AngularDrive
    this.ignored = new Set();
    this.events = [];
    this.w.on('begin-contact', (c) => this.onContact(c, true));
    this.w.on('end-contact', (c) => this.onContact(c, false));
    this.w.on('pre-solve', (c) => {
      const a = c.getFixtureA().getUserData(), b = c.getFixtureB().getUserData();
      if (!a || !b || this.isIgnored(a, b) || !a.enabled || !b.enabled) {
        c.setEnabled(false);
        return;
      }
      const ma = a.material && this.world.assets.physicMaterials[a.material];
      const mb = b.material && this.world.assets.physicMaterials[b.material];
      if (ma || mb) {
        c.setRestitution(Math.max(ma ? ma.bounce : 0, mb ? mb.bounce : 0));
      }
    });
  }

  isIgnored(a, b) {
    return this.ignored.has(pairKey(a, b));
  }

  IgnoreCollision(a, b, ignore = true) {
    if (!a || !b) {
      return;
    }
    if (ignore) {
      this.ignored.add(pairKey(a, b));
    } else {
      this.ignored.delete(pairKey(a, b));
    }
  }

  // ---------------------------------------------------------------- registration
  // Build bodies for every active object under root (called when objects become active / are created).
  addHierarchy(go) {
    const all = go.GetComponentsInChildren('Rigidbody');
    for (const rb of all) {
      if (rb.gameObject.activeInHierarchy && !rb.pb) {
        this.addRigidbody(rb);
      }
    }
    for (const col of go.GetComponentsInChildren('Collider')) {
      if (!col.gameObject.activeInHierarchy || col.fixtures.length || this.statics.has(col)) {
        continue;
      }
      const rb = col.attachedRigidbody;
      if (rb) {
        if (rb.pb) {
          this.addFixtures(rb.pb, col, rb);
          this.updateMass(rb);
        }
      } else {
        this.addStatic(col);
      }
    }
  }

  removeHierarchy(go) {
    for (const rb of go.GetComponentsInChildren('Rigidbody')) {
      this.removeRigidbody(rb);
    }
    for (const col of go.GetComponentsInChildren('Collider')) {
      this.removeCollider(col);
    }
    for (const j of go.GetComponentsInChildren('Joint')) {
      j.destroyJoint();
      this.joints.delete(j);
      this.drives.delete(j);
    }
  }

  pose(go) {
    const M = go.transform.matrix;
    return { x: M[3], y: M[7], z: M[11], a: Math.atan2(M[4], M[0]) };
  }

  addRigidbody(rb) {
    const p = this.pose(rb.gameObject);
    const body = this.w.createBody({
      type: rb._isKinematic ? 'kinematic' : 'dynamic',
      position: Vec2(p.x, p.y),
      angle: p.a,
      linearDamping: rb._drag,
      angularDamping: rb._angularDrag,
      gravityScale: rb._useGravity ? 1 : 0,
      fixedRotation: rb.freezeRotation,
      bullet: false,
    });
    body.setUserData(rb);
    rb.pb = body;
    rb.a0 = p.a;
    rb.q0 = rb.transform.rotation;
    rb.z0 = p.z;
    rb.prev = { x: p.x, y: p.y, a: p.a };
    this.rigidbodies.add(rb);
    for (const col of rb.gameObject.GetComponentsInChildren('Collider')) {
      if (col.gameObject.activeInHierarchy && col.attachedRigidbody === rb) {
        this.removeCollider(col);
        this.addFixtures(body, col, rb);
      }
    }
    this.updateMass(rb);
  }

  removeRigidbody(rb) {
    if (!rb.pb) {
      return;
    }
    for (const j of this.joints) {
      if (j.pj && (j.pj.getBodyA() === rb.pb || j.pj.getBodyB() === rb.pb)) {
        j.pj = null;
        j.dirtyJoint = true;
      }
    }
    for (const [cj, drive] of this.drives) {
      if (drive.getBodyA() === rb.pb) {
        this.drives.delete(cj);
      }
    }
    for (let f = rb.pb.getFixtureList(); f; f = f.getNext()) {
      const col = f.getUserData();
      if (col) {
        col.fixtures = [];
      }
    }
    this.w.destroyBody(rb.pb);
    rb.pb = null;
    this.rigidbodies.delete(rb);
  }

  addStatic(col) {
    const p = this.pose(col.gameObject);
    const body = this.w.createBody({ type: 'static', position: Vec2(p.x, p.y), angle: p.a });
    body.a0 = p.a;
    body.m0 = col.transform.matrix;
    this.statics.set(col, body);
    this.addFixtures(body, col, null);
  }

  removeCollider(col) {
    const sb = this.statics.get(col);
    if (sb) {
      this.w.destroyBody(sb);
      this.statics.delete(col);
    }
    for (const f of col.fixtures) {
      const b = f.getBody();
      if (b && b.getWorld && b.getWorld()) {
        b.destroyFixture(f);
      }
    }
    col.fixtures = [];
  }

  colliderChanged(col) {
    const rb = col.attachedRigidbody;
    this.removeCollider(col);
    if (!col.gameObject.activeInHierarchy) {
      return;
    }
    if (rb && rb.pb) {
      this.addFixtures(rb.pb, col, rb);
      this.updateMass(rb);
    } else if (!rb) {
      this.addStatic(col);
    }
  }

  addFixtures(body, col, rb) {
    const zc = rb ? rb.transform.position[2] : 0;
    const shapes = colliderShapes(col, zc, this.world.assets);
    const bp = body.getPosition(), ba = body.getAngle();
    const c = Math.cos(-ba), s = Math.sin(-ba);
    const local = ([x, y]) => {
      const dx = x - bp.x, dy = y - bp.y;
      return Vec2(dx * c - dy * s, dx * s + dy * c);
    };
    const mat2 = col.material && this.world.assets.physicMaterials[col.material];
    const def = { isSensor: col._isTrigger, friction: mat2 ? mat2.friction : 0.4, restitution: mat2 ? mat2.bounce : 0, density: 1, userData: col };
    for (const sh of shapes) {
      let shape = null;
      if (sh.type === 'circle') {
        shape = planck.Circle(local(sh.c), sh.r);
      } else if (sh.type === 'poly') {
        let pts = sh.pts.map(local);
        if (pts.length > planck.Settings.maxPolygonVertices) {
          pts = pts.slice(0, planck.Settings.maxPolygonVertices);
        }
        if (polygonArea(pts.map((p) => [p.x, p.y])) < 1e-4) {
          continue;
        }
        shape = planck.Polygon(pts);
      } else if (sh.type === 'chain') {
        shape = planck.Chain(sh.pts.map(local), false);
      }
      if (shape) {
        const f = body.createFixture(shape, def);
        col.fixtures.push(f);
      }
    }
  }

  // Unity masses/inertias: total mass from the Rigidbody, inertia about z from the collider shapes in 3D terms.
  updateMass(rb) {
    const body = rb.pb;
    if (!body || rb._isKinematic) {
      return;
    }
    const m = rb._mass;
    let I = 0, n = 0;
    for (const col of rb.gameObject.GetComponentsInChildren('Collider')) {
      if (col.attachedRigidbody !== rb) {
        continue;
      }
      const M = col.transform.matrix, d = col.d;
      if (col.type === 'SphereCollider') {
        const r = d.radius * maxScale(M);
        I += 0.4 * r * r; n++;
      } else if (col.type === 'BoxCollider') {
        const sx = d.size[0] * Math.hypot(M[0], M[4], M[8]), sy = d.size[1] * Math.hypot(M[1], M[5], M[9]);
        I += (sx * sx + sy * sy) / 12; n++;
      } else if (col.type === 'CapsuleCollider') {
        const r = d.radius, h = d.height;
        I += (r * r) / 2 + (h * h) / 12; n++;
      } else {
        const b = col.bounds;
        I += (b.size[0] ** 2 + b.size[1] ** 2) / 12; n++;
      }
    }
    I = n ? (I / n) * m : 0.4 * m;
    body.setMassData({ mass: m, center: Vec2(0, 0), I });
  }

  // ---------------------------------------------------------------- transform sync
  syncFromTransform(rb) {
    const p = this.pose(rb.gameObject);
    const a = rb.a0 + angleDelta(rb.q0, rb.transform.rotation);
    rb.pb.setTransform(Vec2(p.x, p.y), a);
    rb.lastPos = [p.x, p.y, a];
    rb.prev = { x: p.x, y: p.y, a };
  }

  writeTransform(rb, x, y, a) {
    const tr = rb.transform;
    const pos = tr.position;
    tr.position = [x, y, pos[2]];
    tr.rotation = quat.mul(quat.fromZ(a - rb.a0), rb.q0);
    rb.lastPos = [x, y, a];
  }

  prestep() {
    // kinematic bodies follow their transforms; dynamic ones pick up teleports done by scripts
    const dt = PHYS.fixedDt;
    for (const rb of this.rigidbodies) {
      const p = this.pose(rb.gameObject);
      const a = rb.a0 + angleDelta(rb.q0, rb.transform.rotation);
      const b = rb.pb;
      if (rb._isKinematic) {
        // kinematic bodies follow their transforms with a velocity, so touching bodies get carried along
        const bp = b.getPosition();
        const dx = p.x - bp.x, dy = p.y - bp.y;
        let da = a - b.getAngle();
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.hypot(dx, dy) > 20) {
          b.setTransform(Vec2(p.x, p.y), a);
          b.setLinearVelocity(Vec2(0, 0));
          b.setAngularVelocity(0);
        } else {
          b.setLinearVelocity(Vec2(dx / dt, dy / dt));
          b.setAngularVelocity(da / dt);
        }
      } else {
        const lp = rb.lastPos;
        if (!lp || Math.abs(lp[0] - p.x) > 1e-4 || Math.abs(lp[1] - p.y) > 1e-4 || Math.abs(lp[2] - a) > 1e-4) {
          this.syncFromTransform(rb);
        }
      }
      rb.prev = { x: b.getPosition().x, y: b.getPosition().y, a: b.getAngle() };
    }
    for (const [col, body] of [...this.statics]) {
      const M = col.transform.matrix;
      if (M !== body.m0 && !sameMatrix(M, body.m0)) {
        if (Math.abs(M[11] - body.m0[11]) > 0.5) {
          this.colliderChanged(col);   // moved off (or onto) the z = 0 play plane: re-slice
          continue;
        }
        body.m0 = M;
        const p = this.pose(col.gameObject);
        body.setTransform(Vec2(p.x, p.y), p.a);
      }
    }
    for (const j of this.joints) {
      this.updateJoint(j);
    }
  }

  step(dt) {
    this.prestep();
    this.w.step(dt, PHYS.velocityIterations, PHYS.positionIterations);
    for (const rb of this.rigidbodies) {
      const b = rb.pb;
      if (rb._isKinematic) {
        continue;
      }
      const w = b.getAngularVelocity();
      if (Math.abs(w) > PHYS.maxAngularVelocity) {
        b.setAngularVelocity(Math.sign(w) * PHYS.maxAngularVelocity);
      }
      const p = b.getPosition();
      this.writeTransform(rb, p.x, p.y, b.getAngle());
    }
    this.dispatch();
  }

  // Unity-style render interpolation: move interpolated bodies' transforms between the last two fixed steps
  interpolate(alpha) {
    for (const rb of this.rigidbodies) {
      if (!rb.interpolation || rb._isKinematic || !rb.prev) {
        continue;
      }
      const b = rb.pb, p = b.getPosition();
      const x = rb.prev.x + (p.x - rb.prev.x) * alpha, y = rb.prev.y + (p.y - rb.prev.y) * alpha;
      let da = b.getAngle() - rb.prev.a;
      const a = rb.prev.a + da * alpha;
      const tr = rb.transform;
      tr.position = [x, y, tr.position[2]];
      tr.rotation = quat.mul(quat.fromZ(a - rb.a0), rb.q0);
      rb.lastPos = [x, y, a];
      rb.interpolated = true;
    }
  }

  restore() {
    for (const rb of this.rigidbodies) {
      if (rb.interpolated) {
        rb.interpolated = false;
        const b = rb.pb, p = b.getPosition();
        this.writeTransform(rb, p.x, p.y, b.getAngle());
      }
    }
  }

  // ---------------------------------------------------------------- joints
  updateJoint(j) {
    const rbA = j.gameObject.GetComponent('Rigidbody');
    if (!rbA || !rbA.pb || !j.gameObject.activeInHierarchy) {
      return;
    }
    if (j instanceof ConfigurableJoint && !j._connectedBody) {
      this.updateDrive(j, rbA);
      return;
    }
    const rbB = j._connectedBody;
    if (rbB && !rbB.pb) {
      return;
    }
    const bodyB = rbB ? rbB.pb : this.ground;
    if (j.pj && (j.dirtyJoint || j.pj.getBodyB() !== bodyB)) {
      j.destroyJoint();
    }
    j.dirtyJoint = false;
    if (!j.pj) {
      const anchorW = rbA.transform.TransformPoint(j.anchor);
      const anchor = Vec2(anchorW[0], anchorW[1]);
      if (j instanceof HingeJoint) {
        j.pj = this.w.createJoint(planck.RevoluteJoint({ collideConnected: false }, rbA.pb, bodyB, anchor));
      } else if (j instanceof FixedJoint) {
        j.pj = this.w.createJoint(planck.WeldJoint({ collideConnected: false }, rbA.pb, bodyB, anchor));
      } else if (j instanceof ConfigurableJoint) {
        const ca = rbA.pb.getPosition(), cb = bodyB.getPosition();
        j.pj = this.w.createJoint(planck.DistanceJoint({ frequencyHz: 0, dampingRatio: 0, length: Math.hypot(ca.x - cb.x, ca.y - cb.y) }, rbA.pb, bodyB, ca, cb));
      }
      j.angle0 = rbA.pb.getAngle() - bodyB.getAngle();
    }
    if (j instanceof HingeJoint && j.pj) {
      const pj = j.pj;
      if (j.useLimits) {
        pj.enableLimit(true);
        pj.setLimits(-j.limits.max * Math.PI / 180, -j.limits.min * Math.PI / 180);
      } else {
        pj.enableLimit(false);
      }
      if (j.useMotor) {
        pj.enableMotor(true);
        pj.setMotorSpeed(-j.motor.targetVelocity * Math.PI / 180);
        pj.setMaxMotorTorque(j.motor.force);
      } else {
        pj.enableMotor(false);
      }
      if (j.useSpring && j.spring.spring) {
        // spring toward targetPosition (degrees) about the joint, applied as equal and opposite torques
        const A = rbA.pb, B = bodyB;
        const rel = A.getAngle() - B.getAngle() - j.angle0;
        const target = -j.spring.targetPosition * Math.PI / 180;
        const wrel = A.getAngularVelocity() - B.getAngularVelocity();
        const tq = -j.spring.spring * (rel - target) - j.spring.damper * wrel;
        A.applyTorque(tq, true);
        if (B !== this.ground) {
          B.applyTorque(-tq, true);
        }
      }
    }
  }

  updateDrive(j, rbA) {
    let drive = this.drives.get(j);
    if (!drive || drive.getBodyA() !== rbA.pb) {
      drive = this.w.createJoint(new AngularDrive(rbA.pb, this.ground));
      this.drives.set(j, drive);
    }
    const dr = j.angularYZDrive;
    // PhysX drives the joint frame, which spins opposite to the body: BodyBehaviour's inversion check expects this
    drive.target = -j.targetAngularVelocity[2];
    drive.maxTorque = dr.mode ? dr.maximumForce : 0;
    // locked linear motion: pin the body where it is
    if (j.xMotion === 0 && j.yMotion === 0) {
      if (!j.lockPos) {
        const p = rbA.pb.getPosition();
        j.lockPos = Vec2(p.x, p.y);
      }
      rbA.pb.setPosition(j.lockPos);
      rbA.pb.setLinearVelocity(Vec2(0, 0));
    } else {
      j.lockPos = null;
    }
  }

  // ---------------------------------------------------------------- contacts
  onContact(c, begin) {
    const a = c.getFixtureA().getUserData(), b = c.getFixtureB().getUserData();
    if (!a || !b) {
      return;
    }
    const trigger = c.getFixtureA().isSensor() || c.getFixtureB().isSensor();
    let rel = [0, 0, 0];
    if (!trigger && begin) {
      const wm = c.getWorldManifold(null);
      const pt = wm && wm.points && wm.points[0] ? wm.points[0] : c.getFixtureA().getBody().getPosition();
      const va = c.getFixtureA().getBody().getLinearVelocityFromWorldPoint(pt);
      const vb = c.getFixtureB().getBody().getLinearVelocityFromWorldPoint(pt);
      rel = [va.x - vb.x, va.y - vb.y, 0];
    }
    this.events.push({ a, b, begin, trigger, rel, contact: c });
  }

  dispatch() {
    const evs = this.events;
    this.events = [];
    for (const e of evs) {
      if (this.isIgnored(e.a, e.b)) {
        continue;
      }
      if (e.trigger) {
        const name = e.begin ? 'OnTriggerEnter' : 'OnTriggerExit';
        if (!e.a.enabled || !e.b.enabled) {
          continue;
        }
        sendCollider(e.a, name, e.b);
        sendCollider(e.b, name, e.a);
      } else {
        const name = e.begin ? 'OnCollisionEnter' : 'OnCollisionExit';
        sendCollider(e.a, name, collision(e.b, e.rel, e.contact));
        sendCollider(e.b, name, collision(e.a, e.rel.map((x) => -x), e.contact));
      }
    }
    // OnTriggerStay / OnCollisionStay for touching contacts
    for (let c = this.w.getContactList(); c; c = c.getNext()) {
      if (!c.isTouching()) {
        continue;
      }
      const a = c.getFixtureA().getUserData(), b = c.getFixtureB().getUserData();
      if (!a || !b || this.isIgnored(a, b)) {
        continue;
      }
      if (c.getFixtureA().isSensor() || c.getFixtureB().isSensor()) {
        if (a.enabled && b.enabled) {
          sendCollider(a, 'OnTriggerStay', b);
          sendCollider(b, 'OnTriggerStay', a);
        }
        continue;
      }
      sendCollider(a, 'OnCollisionStay', collision(b, [0, 0, 0], c));
      sendCollider(b, 'OnCollisionStay', collision(a, [0, 0, 0], c));
    }
  }

  // ---------------------------------------------------------------- queries
  raycast(origin, dir, dist = 1e4, filter = null, mask = -1) {
    const d = v3.norm([dir[0], dir[1], 0]);
    const p1 = Vec2(origin[0], origin[1]);
    const p2 = Vec2(origin[0] + d[0] * dist, origin[1] + d[1] * dist);
    let best = null;
    this.w.rayCast(p1, p2, (f, point, normal, fraction) => {
      const col = f.getUserData();
      if (!col || f.isSensor() || (filter && !filter(col)) || !(mask & (1 << col.gameObject.layer))) {
        return -1;
      }
      best = { collider: col, point: [point.x, point.y, origin[2]], normal: [normal.x, normal.y, 0], distance: fraction * dist,
        transform: col.transform, rigidbody: col.attachedRigidbody, gameObject: col.gameObject };
      return fraction;
    });
    return best;
  }

  overlapSphere(c, r) {
    const out = new Set();
    const aabb = planck.AABB(Vec2(c[0] - r, c[1] - r), Vec2(c[0] + r, c[1] + r));
    this.w.queryAABB(aabb, (f) => {
      if (f.getUserData()) {
        out.add(f.getUserData());
      }
      return true;
    });
    return [...out];
  }
}

function pairKey(a, b) {
  const ia = a.uid ?? (a.uid = ++pairKey.n), ib = b.uid ?? (b.uid = ++pairKey.n);
  return ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
}
pairKey.n = 0;

function sameMatrix(a, b) {
  for (let i = 0; i < 12; i++) {
    if (Math.abs(a[i] - b[i]) > 1e-6) {
      return false;
    }
  }
  return true;
}

// rotation about z between two orientations (both assumed to differ only by a z rotation)
function angleDelta(q0, q) {
  const d = quat.mul(q, quat.inverse(q0));
  return quat.zAngle(d);
}

function collision(other, rel, contact) {
  const wm = contact.getWorldManifold(null);
  const pts = wm && wm.points ? wm.points.slice(0, contact.getManifold().pointCount) : [];
  return {
    collider: other,
    gameObject: other.gameObject,
    transform: other.transform,
    rigidbody: other.attachedRigidbody,
    relativeVelocity: rel,
    contacts: pts.map((p) => ({ point: [p.x, p.y, 0], normal: [wm.normal.x, wm.normal.y, 0] })),
  };
}

// Unity sends collision messages to the collider's object and to its rigidbody's object, even to disabled scripts
function sendCollider(col, name, arg) {
  const targets = [col.gameObject];
  const rb = col.attachedRigidbody;
  if (rb && rb.gameObject !== col.gameObject) {
    targets.push(rb.gameObject);
  }
  for (const go of targets) {
    if (go.destroyed) {
      continue;
    }
    for (const c of go.components) {
      if (typeof c[name] === 'function') {
        go.world.callScript(c, name, arg);
      }
    }
  }
}
