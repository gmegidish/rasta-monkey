"""Readers for Unity 2.5 serialized objects (no typetrees in these files)."""
import struct


class R:
    def __init__(self, d, p=0):
        self.d, self.p = d, p

    def i32(self):
        v = struct.unpack_from('<i', self.d, self.p)[0]; self.p += 4; return v

    def u16(self):
        v = struct.unpack_from('<H', self.d, self.p)[0]; self.p += 2; return v

    def u8(self):
        v = self.d[self.p]; self.p += 1; return v

    def f32(self):
        v = struct.unpack_from('<f', self.d, self.p)[0]; self.p += 4; return v

    def fs(self, n):
        v = list(struct.unpack_from('<%df' % n, self.d, self.p)); self.p += 4 * n; return v

    def align(self):
        self.p = (self.p + 3) & ~3

    def str(self):
        n = self.i32(); s = self.d[self.p:self.p + n].decode('utf-8', 'replace'); self.p += n; self.align(); return s

    def pptr(self):
        return (self.i32(), self.i32())

    def end(self):
        return self.p >= len(self.d)


def game_object(d):
    r = R(d)
    comps = [(r.i32(), r.pptr()) for _ in range(r.i32())]
    layer = r.i32(); name = r.str(); tag = r.u16(); active = r.u8()
    return dict(components=comps, layer=layer, name=name, tag=tag, active=bool(active))


def transform(d):
    r = R(d)
    go = r.pptr(); rot = r.fs(4); pos = r.fs(3); scale = r.fs(3)
    children = [r.pptr() for _ in range(r.i32())]
    father = r.pptr()
    return dict(go=go, rot=rot, pos=pos, scale=scale, children=children, father=father)


def mesh(d):
    r = R(d)
    name = r.str()
    use16 = r.i32()
    nbytes = r.i32()
    if use16:
        idx = list(struct.unpack_from('<%dH' % (nbytes // 2), d, r.p))
    else:
        idx = list(struct.unpack_from('<%dI' % (nbytes // 4), d, r.p))
    r.p += nbytes; r.align()
    subs = []
    for _ in range(r.i32()):
        first_byte, count, strip, tris = r.i32(), r.i32(), r.i32(), r.i32()
        subs.append(dict(first=first_byte // (2 if use16 else 4), count=count, strip=strip, tris=tris))
    nv = r.i32(); verts = r.fs(3 * nv)
    nskin = r.i32(); r.p += nskin * 32
    nbind = r.i32(); r.p += nbind * 64
    nuv = r.i32(); uv = r.fs(2 * nuv)
    nuv1 = r.i32(); r.fs(2 * nuv1)
    ntan = r.i32(); tan = r.fs(7 * ntan)
    rest = d[r.p:]
    return dict(name=name, idx=idx, subs=subs, verts=verts, uv=uv, nskin=nskin, rest=rest)


def triangles(m, sub):
    """Triangle index triples for a submesh (handles strips)."""
    s = m['idx'][sub['first']:sub['first'] + sub['count']]
    if not sub['strip']:
        return [s[i:i + 3] for i in range(0, len(s) - 2, 3)]
    out = []
    for i in range(len(s) - 2):
        a, b, c = s[i], s[i + 1], s[i + 2]
        if a == b or b == c or a == c:
            continue
        out.append([a, b, c] if i % 2 == 0 else [b, a, c])
    return out
