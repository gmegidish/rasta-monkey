// Canvas 2D renderer for the game's (almost entirely flat, alpha-blended) meshes seen through a perspective camera.
// Each mesh is split into planar groups (connected triangles at one depth). A group is rasterised once into a sprite
// in its own plane; per frame the sprite is drawn with the affine transform that the camera projection gives that
// plane. That is exact for planes facing the camera, which is every plane in this game.
import { mat } from './math.js';

const MAX_SPRITE = 2048;
const MIN_TEXELS_PER_UNIT = 2;
const PAD = 2;
const OVERLAY_SHADERS = new Set(['Overlay']);

export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.assets = assets;
    this.groupCache = new Map();   // mesh|sub|axis -> groups
    this.spriteCache = new Map();  // mesh|sub|axis|group|material -> sprite
    this.patterns = new Map();
    this.stats = { drawn: 0 };
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  // ------------------------------------------------------------------ frame
  render(world) {
    const ctx = this.ctx;
    const cams = world.cameras.filter((c) => c.enabled && c.gameObject.activeInHierarchy).sort((a, b) => a.depth - b.depth);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!cams.length || cams[0].clearFlags !== 2) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    this.stats.drawn = 0;
    for (const cam of cams) {
      this.renderCamera(world, cam);
    }
    if (world.gui) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      world.gui.paint(ctx, this.canvas.width / world.screenWidth);
    }
  }

  viewport(cam) {
    const W = this.canvas.width, H = this.canvas.height;
    const [rx, ry, rw, rh] = cam.rect;
    return { x: rx * W, y: (1 - ry - rh) * H, w: rw * W, h: rh * H };
  }

  renderCamera(world, cam) {
    const ctx = this.ctx;
    const vp = this.viewport(cam);
    if (cam.clearFlags === 1 || cam.clearFlags === 2) {
      const [r, g, b] = cam.backgroundColor;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})`;
      ctx.fillRect(vp.x, vp.y, vp.w, vp.h);
    }
    const proj = cam.projector(vp);
    const items = [];
    let order = 0;
    for (const r of world.renderers) {
      order++;
      if (!r.enabled || !r.gameObject.activeInHierarchy || !(cam.cullingMask & (1 << r.gameObject.layer))) {
        continue;
      }
      const mesh = r.meshData();
      if (!mesh) {
        continue;
      }
      const M = r.combined ? mat.identity() : r.transform.matrix;
      const axis = depthAxis(M);
      const subs = r.subsets.length ? r.subsets : r.materials.map((_, i) => i);
      for (let i = 0; i < r.materials.length && i < subs.length; i++) {
        const matKey = r.materials[i];
        const material = this.assets.materials[matKey];
        if (!material) {
          continue;
        }
        const groups = this.groups(r.meshKey, mesh, subs[i], axis);
        const overlay = OVERLAY_SHADERS.has(material.shader);
        for (let g = 0; g < groups.length; g++) {
          const grp = groups[g];
          const c = mat.point(proj.view, mat.point(M, grp.center));
          if (c[2] <= cam.near) {
            continue;
          }
          items.push({ r, M, grp, g, matKey, material, depth: c[2], overlay, order, sub: subs[i], axis });
        }
      }
    }
    items.sort((a, b) => (a.overlay - b.overlay) || (b.depth - a.depth) || (a.order - b.order) || (a.g - b.g));
    ctx.save();
    ctx.beginPath();
    ctx.rect(vp.x, vp.y, vp.w, vp.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    for (const it of items) {
      this.drawGroup(it, proj);
    }
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawGroup(it, proj) {
    const sprite = this.sprite(it);
    if (!sprite) {
      return;
    }
    const { M } = it;
    const s0 = proj.toScreen(mat.point(M, sprite.p0));
    const s1 = proj.toScreen(mat.point(M, sprite.p1));
    const s2 = proj.toScreen(mat.point(M, sprite.p2));
    if (!s0 || !s1 || !s2) {
      return;
    }
    const w = sprite.canvas.width, h = sprite.canvas.height;
    const ax = (s1[0] - s0[0]) / w, ay = (s1[1] - s0[1]) / w, bx = (s2[0] - s0[0]) / h, by = (s2[1] - s0[1]) / h;
    // cull: bounding box of the projected sprite
    const xs = [s0[0], s1[0], s2[0], s1[0] + s2[0] - s0[0]], ys = [s0[1], s1[1], s2[1], s1[1] + s2[1] - s0[1]];
    const vp = proj.vp;
    if (Math.max(...xs) < vp.x || Math.min(...xs) > vp.x + vp.w || Math.max(...ys) < vp.y || Math.min(...ys) > vp.y + vp.h) {
      return;
    }
    const ctx = this.ctx;
    ctx.setTransform(ax, ay, bx, by, s0[0], s0[1]);
    const alpha = it.r.alpha * (it.material.color ? it.material.color[3] : 1);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(sprite.canvas, 0, 0);
    ctx.globalAlpha = 1;
    this.stats.drawn++;
  }

  // ------------------------------------------------------------------ geometry groups
  groups(meshKey, mesh, sub, axis) {
    const key = `${meshKey}|${sub}|${axis.join('')}`;
    let gs = this.groupCache.get(key);
    if (!gs) {
      gs = buildGroups(mesh, mesh.subs[sub] || [], axis);
      this.groupCache.set(key, gs);
    }
    return gs;
  }

  sprite(it) {
    const key = `${it.r.meshKey}|${it.sub}|${it.axis.join('')}|${it.g}|${it.matKey}`;
    let sp = this.spriteCache.get(key);
    if (sp === undefined) {
      const img = it.material.tex ? this.assets.images[it.material.tex] : null;
      if (it.material.tex && !img) {
        return null; // texture still loading
      }
      sp = rasterise(it.r.meshData(), it.grp, it.axis, it.material, img, this.pattern(img));
      this.spriteCache.set(key, sp);
    }
    return sp;
  }

  pattern(img) {
    if (!img) {
      return null;
    }
    let p = this.patterns.get(img);
    if (!p) {
      p = this.ctx.createPattern(img, 'repeat');
      this.patterns.set(img, p);
    }
    return p;
  }
}

// which local axis points (mostly) along world z: that one is the depth axis, the other two span the sprite plane
function depthAxis(M) {
  const cz = [0, 1, 2].map((i) => Math.abs(M[8 + i]) / (Math.hypot(M[i], M[4 + i], M[8 + i]) || 1));
  const d = cz.indexOf(Math.max(...cz));
  const [a, b] = [0, 1, 2].filter((i) => i !== d);
  // plane axes, oriented so that the sprite's x/y follow world x/y as closely as possible
  const ax = Math.abs(M[a]) / (Math.hypot(M[a], M[4 + a], M[8 + a]) || 1);
  const bx = Math.abs(M[b]) / (Math.hypot(M[b], M[4 + b], M[8 + b]) || 1);
  return ax >= bx ? [a, b, d] : [b, a, d];
}

function buildGroups(mesh, tris, [a, b, d]) {
  const v = mesh.v;
  const n = tris.length / 3;
  // union-find over triangles sharing vertices, split by depth
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const byVert = new Map();
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = tris[t * 3 + k];
      const prev = byVert.get(vi);
      if (prev === undefined) {
        byVert.set(vi, t);
      } else {
        parent[find(t)] = find(prev);
      }
    }
  }
  let ext = 0;
  for (let i = 0; i < v.length; i += 3) {
    ext = Math.max(ext, Math.abs(v[i + a]), Math.abs(v[i + b]));
  }
  const tol = Math.max(1e-4, ext * 0.004);
  const groups = new Map();
  for (let t = 0; t < n; t++) {
    const dz = (v[tris[t * 3] * 3 + d] + v[tris[t * 3 + 1] * 3 + d] + v[tris[t * 3 + 2] * 3 + d]) / 3;
    const k = `${find(t)}|${Math.round(dz / tol)}`;
    let g = groups.get(k);
    if (!g) {
      g = { tris: [], dsum: 0 };
      groups.set(k, g);
    }
    g.tris.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
    g.dsum += dz;
  }
  return [...groups.values()].map((g) => {
    let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
    for (const vi of g.tris) {
      minA = Math.min(minA, v[vi * 3 + a]); maxA = Math.max(maxA, v[vi * 3 + a]);
      minB = Math.min(minB, v[vi * 3 + b]); maxB = Math.max(maxB, v[vi * 3 + b]);
    }
    const depth = g.dsum / (g.tris.length / 3);
    const center = [0, 0, 0];
    center[a] = (minA + maxA) / 2; center[b] = (minB + maxB) / 2; center[d] = depth;
    return { tris: g.tris, depth, minA, maxA, minB, maxB, center };
  });
}

function rasterise(mesh, grp, [a, b, d], material, img, pattern) {
  const v = mesh.v, uv = mesh.uv;
  const W = img ? img.width : 1, H = img ? img.height : 1;
  const sx = material.scale || [1, 1], off = material.offset || [0, 0];
  const texel = (vi) => [((uv[vi * 2] || 0) * sx[0] + off[0]) * W, (1 - ((uv[vi * 2 + 1] || 0) * sx[1] + off[1])) * H];
  // texel density: texels per local unit, from the largest triangle
  let density = MIN_TEXELS_PER_UNIT;
  if (img) {
    let best = 0;
    for (let i = 0; i < grp.tris.length; i += 3) {
      const [i0, i1, i2] = [grp.tris[i], grp.tris[i + 1], grp.tris[i + 2]];
      const la = triArea(v[i0 * 3 + a], v[i0 * 3 + b], v[i1 * 3 + a], v[i1 * 3 + b], v[i2 * 3 + a], v[i2 * 3 + b]);
      const t0 = texel(i0), t1 = texel(i1), t2 = texel(i2);
      const ta = triArea(t0[0], t0[1], t1[0], t1[1], t2[0], t2[1]);
      if (la > best && ta > 0) {
        best = la;
        density = Math.sqrt(ta / la);
      }
    }
  }
  const wU = grp.maxA - grp.minA, hU = grp.maxB - grp.minB;
  let s = Math.max(density, MIN_TEXELS_PER_UNIT);
  s = Math.min(s, (MAX_SPRITE - 2 * PAD) / Math.max(wU, 1e-6), (MAX_SPRITE - 2 * PAD) / Math.max(hU, 1e-6));
  const cw = Math.max(1, Math.ceil(wU * s) + 2 * PAD), ch = Math.max(1, Math.ceil(hU * s) + 2 * PAD);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  const toPx = (vi) => [(v[vi * 3 + a] - grp.minA) * s + PAD, (grp.maxB - v[vi * 3 + b]) * s + PAD];
  const col = material.color || [1, 1, 1, 1];
  for (let i = 0; i < grp.tris.length; i += 3) {
    const ids = [grp.tris[i], grp.tris[i + 1], grp.tris[i + 2]];
    const p = ids.map(toPx);
    const q = expand(p, 0.6);
    ctx.beginPath();
    ctx.moveTo(q[0][0], q[0][1]);
    ctx.lineTo(q[1][0], q[1][1]);
    ctx.lineTo(q[2][0], q[2][1]);
    ctx.closePath();
    if (img) {
      const t = ids.map(texel);
      const m = affine(t, p);
      if (!m) {
        continue;
      }
      pattern.setTransform(new DOMMatrix(m));
      ctx.fillStyle = pattern;
    } else {
      ctx.fillStyle = `rgb(${col[0] * 160 | 0},${col[1] * 160 | 0},${col[2] * 160 | 0})`;
    }
    ctx.fill();
  }
  // sprite corners back in local space: p0 = top-left, p1 = top-right, p2 = bottom-left
  const corner = (pa, pb) => {
    const c = [0, 0, 0];
    c[a] = pa; c[b] = pb; c[d] = grp.depth;
    return c;
  };
  const a0 = grp.minA - PAD / s, b0 = grp.maxB + PAD / s;
  return { canvas, p0: corner(a0, b0), p1: corner(a0 + cw / s, b0), p2: corner(a0, b0 - ch / s) };
}

function triArea(x0, y0, x1, y1, x2, y2) {
  return Math.abs((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)) / 2;
}

// affine [a b c d e f] mapping source triangle s onto destination triangle t
function affine(s, t) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (Math.abs(det) < 1e-9) {
    return null;
  }
  const [[u0, v0], [u1, v1], [u2, v2]] = t;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
  return [a, b, c, dd, u0 - a * x0 - c * y0, v0 - b * x0 - dd * y0];
}

// push triangle edges outwards by px to hide anti-aliasing seams between neighbours
function expand(p, px) {
  const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cy = (p[0][1] + p[1][1] + p[2][1]) / 3;
  return p.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, l = Math.hypot(dx, dy) || 1;
    return [x + (dx / l) * px, y + (dy / l) * px];
  });
}
