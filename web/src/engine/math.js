// Small vector / quaternion / affine-matrix helpers in Unity's conventions (left-handed, quaternions as [x, y, z, w]).
// Affine matrices are row-major 3x4 arrays: [m00 m01 m02 m03, m10 m11 m12 m13, m20 m21 m22 m23].

export const DEG = Math.PI / 180;

export const v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  sqrLen: (a) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

export const quat = {
  identity: () => [0, 0, 0, 1],
  mul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  },
  axisAngle(axis, rad) {
    const s = Math.sin(rad / 2);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
  },
  // Unity Quaternion.Euler: z, then x, then y (degrees)
  euler(x, y, z) {
    const qx = quat.axisAngle([1, 0, 0], x * DEG), qy = quat.axisAngle([0, 1, 0], y * DEG), qz = quat.axisAngle([0, 0, 1], z * DEG);
    return quat.mul(qy, quat.mul(qx, qz));
  },
  inverse: (q) => [-q[0], -q[1], -q[2], q[3]],
  rotate(q, v) {
    const [x, y, z, w] = q;
    const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2];
    const iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
    return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
  },
  normalize(q) {
    const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    let bb = b;
    if (d < 0) { d = -d; bb = [-b[0], -b[1], -b[2], -b[3]]; }
    if (d > 0.9995) {
      return quat.normalize([a[0] + (bb[0] - a[0]) * t, a[1] + (bb[1] - a[1]) * t, a[2] + (bb[2] - a[2]) * t, a[3] + (bb[3] - a[3]) * t]);
    }
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
  },
  // rotation angle about z of a quaternion that only rotates about z (2D physics)
  zAngle: (q) => 2 * Math.atan2(q[2], q[3]),
  fromZ: (rad) => [0, 0, Math.sin(rad / 2), Math.cos(rad / 2)],
};

export const mat = {
  identity: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  trs(t, q, s) {
    const [x, y, z, w] = q;
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [
      (1 - 2 * (yy + zz)) * s[0], 2 * (xy - wz) * s[1], 2 * (xz + wy) * s[2], t[0],
      2 * (xy + wz) * s[0], (1 - 2 * (xx + zz)) * s[1], 2 * (yz - wx) * s[2], t[1],
      2 * (xz - wy) * s[0], 2 * (yz + wx) * s[1], (1 - 2 * (xx + yy)) * s[2], t[2],
    ];
  },
  mul(a, b) {
    const o = new Array(12);
    for (let r = 0; r < 3; r++) {
      const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2], a3 = a[r * 4 + 3];
      o[r * 4] = a0 * b[0] + a1 * b[4] + a2 * b[8];
      o[r * 4 + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
      o[r * 4 + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
      o[r * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3;
    }
    return o;
  },
  point: (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
  ],
  dir: (m, v) => [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2],
  ],
  invert(m) {
    const [a, b, c, , d, e, f, , g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C || 1e-12;
    const r = [
      A / det, -(b * i - c * h) / det, (b * f - c * e) / det, 0,
      B / det, (a * i - c * g) / det, -(a * f - c * d) / det, 0,
      C / det, -(a * h - b * g) / det, (a * e - b * d) / det, 0,
    ];
    const t = [m[3], m[7], m[11]];
    r[3] = -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]);
    r[7] = -(r[4] * t[0] + r[5] * t[1] + r[6] * t[2]);
    r[11] = -(r[8] * t[0] + r[9] * t[1] + r[10] * t[2]);
    return r;
  },
};

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
