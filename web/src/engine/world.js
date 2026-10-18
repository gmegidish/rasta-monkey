// Runtime for one loaded Unity scene: builds objects from exported JSON, runs the script lifecycle and physics.
import { GameObject, Behaviour, SCRIPTS } from './scene.js';
import { Camera, MeshFilter, Renderer, Animation, AudioSource } from './components.js';
import { GUI } from './gui.js';
import { Physics, Rigidbody, Collider, HingeJoint, PHYS } from './physics.js';

const REF = /^[\w .\-]+:\d+$/;
const COLLIDERS = { box: 'BoxCollider', sphere: 'SphereCollider', capsule: 'CapsuleCollider', meshcol: 'MeshCollider' };

// stand-in for scripts that have not been ported: keeps their data so other scripts can read it
class DataBehaviour extends Behaviour {}

export class WaitForSeconds {
  constructor(s) { this.seconds = s; }
}
export const WaitForFixedUpdate = { fixed: true };

export class World {
  constructor(game, assets, sceneName) {
    this.game = game;
    this.assets = assets;
    this.audio = game.audio;
    this.input = game.input;
    this.sceneName = sceneName;
    this.objects = [];
    this.byId = new Map();
    this.renderers = [];
    this.cameras = [];
    this.animations = [];
    this.behaviours = [];
    this.coroutines = [];
    this.invokes = [];
    this.physics = new Physics(this);
    this.time = 0;
    this.realtime = 0;
    this.deltaTime = PHYS.fixedDt;
    this.fixedDeltaTime = PHYS.fixedDt;
    this.timeScale = 1;
    this.frameCount = 0;
    this.accum = 0;
    this.pendingStart = [];
    this.screenWidth = 480;
    this.screenHeight = 320;
    this.gui = new GUI(assets);
    this.loading = null;
  }

  // ---------------------------------------------------------------- building
  load(scene) {
    const records = Object.entries(scene.objects);
    const created = this.build(records, null);
    this.objects.push(...created.gos);
    for (const go of created.gos) {
      if (!go.transform.parent && go.activeInHierarchy) {
        this.physics.addHierarchy(go);
      }
    }
    this.awakeAll(created.behaviours);
    return created;
  }

  // records: [id, rec][]; returns created objects. ids map to new objects; refs outside fall back to the world map.
  build(records, remap) {
    const local = new Map();
    const gos = [];
    const pendingFields = [];
    const behaviours = [];
    for (const [id, rec] of records) {
      const go = new GameObject(this, rec.name);
      go.id = id;
      go.src = rec;
      go.activeSelf = rec.active;
      go.layer = rec.layer;
      go.tag = rec.tag;
      go.transform.localPosition = rec.t.slice();
      go.transform.localRotation = rec.r.slice();
      go.transform.localScale = rec.s.slice();
      local.set(id, go);
      local.set(rec.tid, go.transform);
      gos.push(go);
      this.addComponents(go, rec, local, pendingFields, behaviours);
    }
    // hierarchy
    for (const go of gos) {
      const p = go.src.parent;
      if (p) {
        const pt = local.get(p) || (remap ? null : this.byId.get(p));
        if (pt) {
          go.transform.setParent(pt);
        }
      }
    }
    if (!remap) {
      for (const [k, v] of local) {
        this.byId.set(k, v);
      }
    }
    const resolve = (v) => this.resolve(v, local);
    for (const [obj, rec] of pendingFields) {
      for (const [k, v] of Object.entries(rec)) {
        if (k[0] !== '_') {
          obj[k] = resolve(v);
        }
      }
    }
    for (const go of gos) {
      const h = go.GetComponent('HingeJoint');
      if (h && typeof h._connectedBody === 'string') {
        h._connectedBody = local.get(h._connectedBody) || this.byId.get(h._connectedBody) || null;
      }
    }
    return { gos, behaviours, local };
  }

  addComponents(go, rec, local, pendingFields, behaviours) {
    const add = (c, id) => {
      go.components.push(c);
      if (id) {
        local.set(id, c);
      }
      return c;
    };
    if (rec.filter) {   // a MeshFilter may start empty and get its mesh from a script
      add(new MeshFilter(go, rec.mesh), rec.filter && rec.filter._id);
    }
    if (rec.rend) {
      this.renderers.push(add(new Renderer(go, rec.rend), rec.rend._id));
    }
    if (rec.camera) {
      this.cameras.push(add(new Camera(go, rec.camera), rec.camera._id));
    }
    if (rec.body) {
      add(new Rigidbody(go, rec.body), rec.body._id);
    }
    for (const [k, type] of Object.entries(COLLIDERS)) {
      if (rec[k]) {
        add(new Collider(go, type, { ...rec[k] }), rec[k]._id);
      }
    }
    if (rec.hinge) {
      add(new HingeJoint(go, rec.hinge), rec.hinge._id);
    }
    if (rec.anim) {
      this.animations.push(add(new Animation(go, rec.anim), rec.anim._id));
    }
    if (rec.audio) {
      add(new AudioSource(go, rec.audio), rec.audio._id);
    }
    for (const mb of rec.mb || []) {
      const cls = SCRIPTS[mb._script] || DataBehaviour;
      const b = new cls(go);
      b.scriptName = mb._script;
      b._enabled = mb._enabled;
      add(b, mb._id);
      this.behaviours.push(b);
      behaviours.push(b);
      pendingFields.push([b, mb]);
    }
  }

  resolve(v, local) {
    if (typeof v === 'string' && REF.test(v)) {
      if (local && local.has(v)) {
        return local.get(v);
      }
      if (this.byId.has(v)) {
        return this.byId.get(v);
      }
      if (this.assets.prefabs[v]) {
        return this.prefab(v);
      }
      return v; // asset key (audio clip, texture, material, mesh ...)
    }
    if (Array.isArray(v)) {
      return v.map((x) => this.resolve(x, local));
    }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) {
        o[k] = this.resolve(x, local);
      }
      return o;
    }
    return v;
  }

  // a prefab GameObject living in a sharedassets file: a template that Instantiate can copy
  prefab(key) {
    this.prefabCache = this.prefabCache || new Map();
    let p = this.prefabCache.get(key);
    if (!p) {
      p = { isPrefab: true, key, name: this.assets.prefabs[key].name };
      this.prefabCache.set(key, p);
    }
    return p;
  }

  // records making up the hierarchy under a GameObject id (scene or prefab)
  subtree(rootId, source) {
    const byTid = new Map();
    for (const [id, rec] of Object.entries(source)) {
      byTid.set(rec.tid, [id, rec]);
    }
    const out = [];
    const children = new Map();
    for (const [id, rec] of Object.entries(source)) {
      if (rec.parent) {
        if (!children.has(rec.parent)) {
          children.set(rec.parent, []);
        }
        children.get(rec.parent).push([id, rec]);
      }
    }
    const walk = (id, rec) => {
      out.push([id, rec]);
      for (const c of children.get(rec.tid) || []) {
        walk(c[0], c[1]);
      }
    };
    walk(rootId, source[rootId]);
    return out;
  }

  Instantiate(original, position, rotation) {
    let records;
    if (original && original.isPrefab) {
      records = this.subtree(original.key, this.assets.prefabs);
    } else {
      const go = original.gameObject || original;
      records = this.subtree(go.id, this.sceneRecords());
    }
    const root = records[0][1];
    // prefab assets are stored inactive in the build; their instances come out active
    const prefab = original && original.isPrefab;
    const created = this.build(records.map(([id, rec], i) => [id, { ...rec, parent: i === 0 ? null : rec.parent, active: prefab || rec.active }]), true);
    const go = created.gos[0];
    if (!(original && original.isPrefab)) {
      const src = original.gameObject || original;
      go.activeSelf = src.activeSelf;
      // copy the current state of the original's transform
      go.transform.localScale = src.transform.localScale.slice();
      go.transform.localRotation = src.transform.localRotation.slice();
      go.transform.localPosition = src.transform.position;
    }
    if (position) {
      go.transform.localPosition = position.slice();
    }
    if (rotation) {
      go.transform.localRotation = rotation.slice();
    }
    go.name = root.name + '(Clone)';
    go.transform.dirty();
    this.objects.push(...created.gos);
    if (go.activeInHierarchy) {
      this.physics.addHierarchy(go);
    }
    this.awakeAll(created.behaviours);
    return original && original.transform && !original.gameObject ? go.transform : go;
  }

  sceneRecords() {
    if (!this.allRecords) {
      this.allRecords = {};
      for (const o of this.objects) {
        if (o.id && o.src) {
          this.allRecords[o.id] = o.src;
        }
      }
    }
    return this.allRecords;
  }

  awakeAll(list) {
    for (const b of list) {
      if (b.gameObject.activeInHierarchy && !b._awoken) {
        b._awoken = true;
        this.callScript(b, 'Awake');
      }
    }
    for (const b of list) {
      if (b.gameObject.activeInHierarchy && b._enabled && b.OnEnable && !b._enabledCalled) {
        b._enabledCalled = true;
        this.callScript(b, 'OnEnable');
      }
      this.pendingStart.push(b);
    }
  }

  // called by GameObject.SetActive when an object becomes active in the hierarchy
  activated(go) {
    this.physics.addHierarchy(go);
    const bs = go.GetComponentsInChildren('Behaviour');
    this.awakeAll(bs.filter((b) => !b._awoken));
    for (const b of bs) {
      if (b._awoken && !b._started) {
        this.pendingStart.push(b);
      }
    }
  }

  added(c) {
    if (c instanceof Behaviour) {
      this.behaviours.push(c);
      if (c.gameObject.activeInHierarchy) {
        c._awoken = true;
        this.callScript(c, 'Awake');
        if (c.OnEnable) {
          this.callScript(c, 'OnEnable');
        }
        this.pendingStart.push(c);
      }
    } else if (c instanceof Renderer) {
      this.renderers.push(c);
    } else if (c instanceof Collider && c.gameObject.activeInHierarchy) {
      this.physics.colliderChanged(c);
    } else if (c instanceof Rigidbody && c.gameObject.activeInHierarchy) {
      this.physics.addRigidbody(c);
    }
  }

  callScript(b, name, arg) {
    if (typeof b[name] !== 'function') {
      return;
    }
    try {
      const r = b[name](arg);
      // UnityScript coroutine-style handlers (OnCollisionStay etc. returning a generator)
      if (r && typeof r.next === 'function' && name !== 'Start') {
        this.startCoroutine(r, b);
      } else if (r && typeof r.next === 'function') {
        this.startCoroutine(r, b);
      }
    } catch (e) {
      console.error(`[script] ${b.scriptName || b.constructor.name}.${name} on ${b.gameObject.name}`, e);
    }
  }

  // new GameObject(name)
  createGameObject(name) {
    const go = new GameObject(this, name);
    this.objects.push(go);
    return go;
  }

  // ---------------------------------------------------------------- destroy
  Destroy(obj, delay = 0) {
    if (!obj) {
      return;
    }
    if (delay > 0) {
      this.invokes.push({ t: this.time + delay, fn: () => this.Destroy(obj) });
      return;
    }
    if (obj instanceof GameObject || (obj.gameObject && obj === obj.gameObject.transform)) {
      this.destroyGameObject(obj instanceof GameObject ? obj : obj.gameObject);
      return;
    }
    // a component
    const go = obj.gameObject;
    if (!go) {
      return;
    }
    go.components = go.components.filter((c) => c !== obj);
    obj.destroyed = true;
    if (obj.kind === 'Joint') {
      obj.destroyJoint();
      this.physics.joints.delete(obj);
      this.physics.drives.delete(obj);
    } else if (obj instanceof Collider) {
      this.physics.removeCollider(obj);
    } else if (obj instanceof Rigidbody) {
      this.physics.removeRigidbody(obj);
    } else if (obj instanceof Renderer) {
      this.renderers = this.renderers.filter((r) => r !== obj);
    } else if (obj instanceof Behaviour) {
      obj._enabled = false;
      this.stopCoroutines(obj);
    }
  }

  destroyGameObject(go) {
    if (go.destroyed) {
      return;
    }
    const all = [];
    const walk = (t) => {
      all.push(t.gameObject);
      for (const c of t.children) {
        walk(c);
      }
    };
    walk(go.transform);
    this.physics.removeHierarchy(go);
    for (const g of all) {
      for (const c of g.components) {
        if (c instanceof Behaviour) {
          if (c.OnDestroy) {
            this.callScript(c, 'OnDestroy');
          }
          this.stopCoroutines(c);
          c._enabled = false;
        }
        if (c.voice) {
          c.Stop();
        }
      }
      g.destroyed = true;
    }
    const dead = new Set(all);
    go.transform.setParent(null);
    this.objects = this.objects.filter((o) => !dead.has(o));
    this.renderers = this.renderers.filter((r) => !dead.has(r.gameObject));
    this.cameras = this.cameras.filter((r) => !dead.has(r.gameObject));
    this.animations = this.animations.filter((r) => !dead.has(r.gameObject));
    this.behaviours = this.behaviours.filter((r) => !dead.has(r.gameObject));
  }

  // ---------------------------------------------------------------- finding
  Find(name) {
    if (name.includes('/')) {
      const [first, ...rest] = name.replace(/^\//, '').split('/');
      for (const o of this.objects) {
        if (o.name === first && !o.transform.parent && o.activeInHierarchy) {
          const t = o.transform.Find(rest.join('/'));
          if (t) {
            return t.gameObject;
          }
        }
      }
      return null;
    }
    return this.objects.find((o) => o.name === name && o.activeInHierarchy) || null;
  }

  FindObjectOfType(type) {
    for (const o of this.objects) {
      if (!o.activeInHierarchy) {
        continue;
      }
      const c = o.GetComponent(type);
      if (c) {
        return c;
      }
    }
    return null;
  }

  FindObjectsOfType(type) {
    const out = [];
    for (const o of this.objects) {
      if (o.activeInHierarchy) {
        out.push(...o.GetComponents(type));
      }
    }
    return out;
  }

  FindGameObjectsWithTag(tag) {
    return this.objects.filter((o) => o.tag === tag && o.activeInHierarchy);
  }

  // ---------------------------------------------------------------- coroutines
  startCoroutine(gen, owner) {
    if (!gen || typeof gen.next !== 'function') {
      return null;
    }
    const co = { gen, owner, wait: null, done: false };
    this.coroutines.push(co);
    this.advance(co, undefined);
    return co;
  }

  stopCoroutines(owner) {
    for (const co of this.coroutines) {
      if (co.owner === owner) {
        co.done = true;
      }
    }
  }

  advance(co) {
    if (co.done || (co.owner && co.owner.gameObject && co.owner.gameObject.destroyed)) {
      co.done = true;
      return;
    }
    let r;
    try {
      r = co.gen.next();
    } catch (e) {
      console.error('[coroutine]', co.owner && co.owner.gameObject && co.owner.gameObject.name, e);
      co.done = true;
      return;
    }
    if (r.done) {
      co.done = true;
      return;
    }
    const y = r.value;
    if (y instanceof WaitForSeconds) {
      co.wait = { until: this.time + y.seconds };
    } else if (y === WaitForFixedUpdate) {
      co.wait = { fixed: true };
    } else if (y && typeof y.next === 'function') {
      co.wait = { child: this.startCoroutine(y, co.owner) };
    } else if (y && y.gen) {
      co.wait = { child: y };
    } else {
      co.wait = { frame: this.frameCount };
    }
  }

  runCoroutines(phase) {
    const list = this.coroutines;
    for (let i = 0; i < list.length; i++) {
      const co = list[i];
      if (co.done || !co.wait) {
        continue;
      }
      const w = co.wait;
      let ready = false;
      if (phase === 'fixed') {
        ready = !!w.fixed;
      } else if (w.until !== undefined) {
        ready = this.time >= w.until;
      } else if (w.frame !== undefined) {
        ready = this.frameCount > w.frame;
      } else if (w.child) {
        ready = w.child.done;
      }
      if (ready) {
        co.wait = null;
        this.advance(co);
      }
    }
    this.coroutines = this.coroutines.filter((c) => !c.done);
  }

  invoke(owner, name, delay) {
    this.invokes.push({ t: this.time + delay, owner, fn: () => owner[name]() });
  }

  cancelInvoke(owner) {
    this.invokes = this.invokes.filter((i) => i.owner !== owner);
  }

  // ---------------------------------------------------------------- loop
  live(b) {
    return b._enabled && !b.destroyed && b.gameObject.activeInHierarchy;
  }

  runStarts() {
    while (this.pendingStart.length) {
      const list = this.pendingStart;
      this.pendingStart = [];
      for (const b of list) {
        if (!b._started && b._enabled && b.gameObject.activeInHierarchy && !b.destroyed) {
          b._started = true;
          if (b.Start) {
            this.callScript(b, 'Start');
          }
        } else if (!b._started && !b.destroyed) {
          // not yet startable (disabled or inactive): keep it for later frames
          (this.deferredStart = this.deferredStart || new Set()).add(b);
        }
      }
    }
    if (this.deferredStart) {
      for (const b of [...this.deferredStart]) {
        if (b._started || b.destroyed) {
          this.deferredStart.delete(b);
        } else if (b._enabled && b.gameObject.activeInHierarchy) {
          this.deferredStart.delete(b);
          b._started = true;
          if (!b._awoken) {
            b._awoken = true;
            this.callScript(b, 'Awake');
          }
          if (b.Start) {
            this.callScript(b, 'Start');
          }
        }
      }
    }
  }

  fixedStep() {
    const dt = this.fixedDeltaTime;
    this.deltaTime = dt;
    this.physics.restore();
    for (const b of this.behaviours.slice()) {
      if (b.FixedUpdate && this.live(b)) {
        this.callScript(b, 'FixedUpdate');
      }
    }
    this.physics.step(dt);
    this.runCoroutines('fixed');
  }

  // advance real time by frameDt seconds
  tick(frameDt) {
    frameDt = Math.min(frameDt, 0.25);
    this.realtime += frameDt;
    const scaled = frameDt * this.timeScale;
    this.runStarts();
    this.accum += scaled;
    while (this.accum >= this.fixedDeltaTime) {
      this.accum -= this.fixedDeltaTime;
      this.fixedTime = (this.fixedTime || 0) + this.fixedDeltaTime;
      this.time = this.fixedTime;
      this.fixedStep();
    }
    this.time = (this.fixedTime || 0) + this.accum;
    this.deltaTime = scaled;
    if (this.timeScale > 0) {
      this.physics.interpolate(this.accum / this.fixedDeltaTime);
    }
    this.frameCount++;
    for (const b of this.behaviours.slice()) {
      if (b.Update && this.live(b)) {
        this.callScript(b, 'Update');
      }
    }
    if (this.invokes.length) {
      const due = this.invokes.filter((i) => i.t <= this.time);
      this.invokes = this.invokes.filter((i) => i.t > this.time);
      for (const i of due) {
        try {
          i.fn();
        } catch (e) {
          console.error('[invoke]', e);
        }
      }
    }
    this.runCoroutines('frame');
    for (const a of this.animations) {
      if (a.gameObject.activeInHierarchy && !a.gameObject.destroyed) {
        if (a.playAutomatically && !a._autoplayed) {
          a._autoplayed = true;
          a.Play();
        }
        a.update(scaled);
      }
    }
    for (const b of this.behaviours.slice()) {
      if (b.LateUpdate && this.live(b)) {
        this.callScript(b, 'LateUpdate');
      }
    }
    // OnGUI: once per frame, with this frame's presses and releases
    this.gui.begin(this.input.takeClicks());
    this.gui.skin = null;
    for (const b of this.behaviours.slice()) {
      if (b.OnGUI && this.live(b)) {
        this.callScript(b, 'OnGUI');
      }
    }
  }
}
