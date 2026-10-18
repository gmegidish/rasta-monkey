// Unity static APIs the game scripts use, bound to the running world.
import { WaitForSeconds, WaitForFixedUpdate } from '../engine/world.js';
import { Behaviour } from '../engine/scene.js';

export { WaitForSeconds, WaitForFixedUpdate };

const PREFS_KEY = 'rasta-monkey';

// PlayerPrefs on localStorage (game.prefs is the in-memory copy)
export const PlayerPrefs = {
  game: null,
  get store() { return this.game ? this.game.prefs : {}; },
  save() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.store));
    } catch (e) {
      // private mode: progress lives for this session only
    }
  },
  GetInt(k, d = 0) { return Number.isInteger(this.store[k]) ? this.store[k] : d; },
  SetInt(k, v) { this.store[k] = Math.trunc(v); this.save(); },
  GetFloat(k, d = 0) { return typeof this.store[k] === 'number' ? this.store[k] : d; },
  SetFloat(k, v) { this.store[k] = v; this.save(); },
  GetString(k, d = '') { return typeof this.store[k] === 'string' ? this.store[k] : d; },
  SetString(k, v) { this.store[k] = String(v); this.save(); },
  HasKey(k) { return k in this.store; },
  DeleteKey(k) { delete this.store[k]; this.save(); },
  DeleteAll() {
    for (const k of Object.keys(this.store)) {
      delete this.store[k];
    }
    this.save();
  },
};

export const Random = {
  Range(a, b) {
    if (Number.isInteger(a) && Number.isInteger(b)) {
      return a + Math.floor(Math.random() * (b - a));   // int version excludes max
    }
    return a + Math.random() * (b - a);
  },
};

// Unity's Vector3.ToString: "(x.x, y.y, z.z)" with one decimal, used to build PlayerPrefs keys
export function vecString(v) {
  return `(${v.map((x) => x.toFixed(1)).join(', ')})`;
}

export const sign = (x) => (x < 0 ? -1 : 1);

// Base class for game scripts: Unity-style helpers on top of Behaviour
export class MonoBehaviour extends Behaviour {
  get Time() { return this.world; }
  Instantiate(o, p, r) { return this.world.Instantiate(o, p, r); }
  Destroy(o, t) { this.world.Destroy(o, t); }
  IgnoreCollision(a, b) { this.world.physics.IgnoreCollision(a, b); }
  // one instance per world, like the original static GetInstance() caches
  static GetInstance(world) {
    const key = '_inst_' + this.name;
    if (!world[key] || world[key].gameObject.destroyed) {
      world[key] = world.FindObjectOfType(this.name);
    }
    return world[key];
  }
}
