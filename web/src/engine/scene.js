// Mini Unity scene graph: GameObjects, Transforms, components and script behaviours built from exported scene JSON.
import { mat, quat, v3 } from './math.js';

export const SCRIPTS = {};          // script name -> Behaviour subclass
export function registerScripts(mod) {
  for (const [name, cls] of Object.entries(mod)) {
    SCRIPTS[name] = cls;
  }
}

export class Transform {
  constructor(go) {
    this.gameObject = go;
    this.localPosition = [0, 0, 0];
    this.localRotation = [0, 0, 0, 1];
    this.localScale = [1, 1, 1];
    this.parent = null;
    this.children = [];
    this._world = null;
  }

  setParent(p) {
    if (this.parent) {
      this.parent.children = this.parent.children.filter((c) => c !== this);
    }
    this.parent = p;
    if (p) {
      p.children.push(this);
    }
    this.dirty();
  }

  // Unity's transform.parent = p: keeps the world pose
  SetParent(p) {
    const M = this.matrix, q = this.rotation;
    const ls = this.lossyScale, ps = p ? p.lossyScale : [1, 1, 1];
    this.setParent(p);
    this.localPosition = p ? mat.point(mat.invert(p.matrix), [M[3], M[7], M[11]]) : [M[3], M[7], M[11]];
    this.localRotation = p ? quat.mul(quat.inverse(p.rotation), q) : q;
    this.localScale = [ls[0] / ps[0], ls[1] / ps[1], ls[2] / ps[2]];
    this.dirty();
  }

  dirty() {
    if (this._world === null) {
      return;
    }
    this._world = null;
    for (const c of this.children) {
      c.dirty();
    }
  }

  get matrix() {
    if (this._world === null) {
      const local = mat.trs(this.localPosition, this.localRotation, this.localScale);
      this._world = this.parent ? mat.mul(this.parent.matrix, local) : local;
    }
    return this._world;
  }

  get position() {
    const m = this.matrix;
    return [m[3], m[7], m[11]];
  }

  set position(p) {
    this.localPosition = this.parent ? mat.point(mat.invert(this.parent.matrix), p) : [...p];
    this.dirty();
  }

  get rotation() {
    let q = this.localRotation;
    for (let t = this.parent; t; t = t.parent) {
      q = quat.mul(t.localRotation, q);
    }
    return q;
  }

  set rotation(q) {
    this.localRotation = this.parent ? quat.mul(quat.inverse(this.parent.rotation), q) : [...q];
    this.dirty();
  }

  get lossyScale() {
    const m = this.matrix;
    return [Math.hypot(m[0], m[4], m[8]), Math.hypot(m[1], m[5], m[9]), Math.hypot(m[2], m[6], m[10])];
  }

  setLocal(pos, rot, scale) {
    if (pos) {
      this.localPosition = pos;
    }
    if (rot) {
      this.localRotation = rot;
    }
    if (scale) {
      this.localScale = scale;
    }
    this.dirty();
  }

  TransformPoint(p) {
    return mat.point(this.matrix, p);
  }

  InverseTransformPoint(p) {
    return mat.point(mat.invert(this.matrix), p);
  }

  TransformDirection(d) {
    return quat.rotate(this.rotation, d);
  }

  get right() { return this.TransformDirection([1, 0, 0]); }
  get up() { return this.TransformDirection([0, 1, 0]); }
  get forward() { return this.TransformDirection([0, 0, 1]); }

  Find(path) {
    let t = this;
    for (const part of path.split('/')) {
      t = t.children.find((c) => c.gameObject.name === part);
      if (!t) {
        return null;
      }
    }
    return t;
  }

  Translate(d) {
    this.position = v3.add(this.position, d);
  }

  get name() { return this.gameObject.name; }
  get transform() { return this; }
}

export class Component {
  constructor(go) {
    this.gameObject = go;
  }
  get transform() { return this.gameObject.transform; }
  get world() { return this.gameObject.world; }
  GetComponent(t) { return this.gameObject.GetComponent(t); }
  get rigidbody() { return this.gameObject.GetComponent('Rigidbody'); }
  get collider() { return this.gameObject.GetComponent('Collider'); }
  get renderer() { return this.gameObject.GetComponent('Renderer'); }
  get animation() { return this.gameObject.GetComponent('Animation'); }
  get audio() { return this.gameObject.GetComponent('AudioSource'); }
  get name() { return this.gameObject.name; }
}

export class GameObject {
  constructor(world, name) {
    this.world = world;
    this.name = name;
    this.activeSelf = true;
    this.layer = 0;
    this.tag = 0;
    this.transform = new Transform(this);
    this.components = [];
    this.destroyed = false;
  }

  get activeInHierarchy() {
    for (let t = this.transform; t; t = t.parent) {
      if (!t.gameObject.activeSelf) {
        return false;
      }
    }
    return !this.destroyed;
  }

  get active() { return this.activeSelf; }
  set active(v) { this.SetActive(v); }

  SetActive(v) {
    const was = this.activeInHierarchy;
    this.activeSelf = v;
    if (!was && this.activeInHierarchy) {
      this.world.activated(this);
    }
  }

  SetActiveRecursively(v) {
    this.activeSelf = v;
    for (const c of this.transform.children) {
      c.gameObject.SetActiveRecursively(v);
    }
    if (v && this.activeInHierarchy) {
      this.world.activated(this);
    }
  }

  // type: a class, or a component kind name ('Rigidbody', 'Collider', ...), or a script name
  GetComponent(type) {
    return this.components.find((c) => isA(c, type)) || null;
  }

  GetComponents(type) {
    return this.components.filter((c) => isA(c, type));
  }

  GetComponentInChildren(type) {
    const own = this.GetComponent(type);
    if (own) {
      return own;
    }
    for (const c of this.transform.children) {
      const f = c.gameObject.GetComponentInChildren(type);
      if (f) {
        return f;
      }
    }
    return null;
  }

  GetComponentsInChildren(type, out = []) {
    out.push(...this.GetComponents(type));
    for (const c of this.transform.children) {
      c.gameObject.GetComponentsInChildren(type, out);
    }
    return out;
  }

  AddComponent(type) {
    const cls = typeof type === 'string' ? SCRIPTS[type] : type;
    const c = new cls(this);
    this.components.push(c);
    this.world.added(c);
    return c;
  }

  get rigidbody() { return this.GetComponent('Rigidbody'); }
  get collider() { return this.GetComponent('Collider'); }
  get renderer() { return this.GetComponent('Renderer'); }
  get animation() { return this.GetComponent('Animation'); }
  get audio() { return this.GetComponent('AudioSource'); }
}

function isA(c, type) {
  if (typeof type === 'string') {
    if (c.kind === type || (c.kinds && c.kinds.includes(type))) {
      return true;
    }
    for (let p = c.constructor; p && p.name; p = Object.getPrototypeOf(p)) {
      if (p.name === type) {
        return true;
      }
    }
    return false;
  }
  return c instanceof type;
}

// Base for ported MonoBehaviours. Fields from the scene data are assigned before Awake.
export class Behaviour extends Component {
  constructor(go) {
    super(go);
    this._enabled = true;
    this._started = false;
    this.kind = 'Behaviour';
  }
  get enabled() { return this._enabled; }
  set enabled(v) {
    if (v && !this._enabled && this.OnEnable) {
      this._enabled = v;
      this.OnEnable();
    }
    this._enabled = v;
  }
  StartCoroutine(gen) { return this.world.startCoroutine(gen, this); }
  StartCoroutine_Auto(gen) { return this.StartCoroutine(gen); }
  StopAllCoroutines() { this.world.stopCoroutines(this); }
  Invoke(name, delay) { this.world.invoke(this, name, delay); }
  CancelInvoke() { this.world.cancelInvoke(this); }
  get time() { return this.world.time; }
}
