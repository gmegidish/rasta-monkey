"""Export Rasta Monkey Unity 2.5 scenes, meshes, materials and textures for the web port."""
import json
import math
import re
from pathlib import Path

import project
import u25
import mono
import unity25

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'web' / 'data'
SCENES = {'mainData': 'id', 'level0': 'start', 'level16': 'goal', 'level17': 'end'}
SCENES.update({'level%d' % i: 'level%d' % i for i in range(1, 16)})


COMPONENT_KEYS = {'MeshFilter': 'filter', 'MeshRenderer': 'rend', 'BoxCollider': 'box', 'SphereCollider': 'sphere',
                  'CapsuleCollider': 'capsule', 'MeshCollider': 'meshcol', 'Rigidbody': 'body', 'HingeJoint': 'hinge',
                  'Animation': 'anim', 'AudioSource': 'audio', 'Camera': 'camera'}


def finite(v):
    if isinstance(v, float):
        return v if math.isfinite(v) else (0.0 if math.isnan(v) else math.copysign(1e30, v))
    if isinstance(v, list):
        return [finite(x) for x in v]
    if isinstance(v, dict):
        return {k: finite(x) for k, x in v.items()}
    return v


def dump(path, obj, **kw):
    path.write_text(json.dumps(finite(obj), separators=(',', ':'), **kw))


def key(ref):
    return None if ref is None else '%s:%d' % ref


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'unnamed'


class Exporter:
    def __init__(self):
        self.P = project.Project()
        self.meshes = {}
        self.materials = {}
        self.textures = {}
        self.clips = {}
        self.audio = {}
        self.physic = {}

    def ref(self, fname, pptr):
        return key(self.P.resolve(fname, pptr))

    def fix_refs(self, fname, v):
        if isinstance(v, tuple) and len(v) == 2:
            return self.ref(fname, v)
        if isinstance(v, list):
            return [self.fix_refs(fname, x) for x in v]
        if isinstance(v, dict):
            return {k: self.fix_refs(fname, x) for k, x in v.items()}
        if isinstance(v, float):
            return round(v, 5)
        return v

    # ---------- assets
    def texture(self, k):
        if k in self.textures or k is None:
            return
        o = self.P.obj(tuple([k.split(':')[0], int(k.split(':')[1])]))
        if o is None:
            self.textures[k] = None
            return
        t = unity25.parse_texture(o.get_raw_data())
        name = slug(t.name)
        if any(v == name + '.png' for v in self.textures.values()):
            name = '%s-%s' % (name, slug(k))
        (OUT / 'tex').mkdir(parents=True, exist_ok=True)
        unity25.decode_texture(t).save(OUT / 'tex' / (name + '.png'))
        self.textures[k] = name + '.png'

    def material(self, k):
        if k in self.materials or k is None:
            return
        fname, pid = k.split(':')[0], int(k.split(':')[1])
        o = self.P.obj((fname, pid))
        if o is None:
            self.materials[k] = None
            return
        r = u25.R(o.get_raw_data())
        name = r.str(); shader = self.ref(fname, r.pptr())
        tex = {}
        for _ in range(r.i32()):
            n = r.str(); t = self.ref(fname, r.pptr()); sc = r.fs(2); off = r.fs(2)
            tex[n] = dict(tex=t, scale=sc, offset=off)
            self.texture(t)
        floats = {}
        for _ in range(r.i32()):
            n = r.str(); floats[n] = r.f32()
        colors = {}
        for _ in range(r.i32()):
            n = r.str(); colors[n] = [round(x, 4) for x in r.fs(4)]
        sh = self.P.obj(tuple([shader.split(':')[0], int(shader.split(':')[1])])) if shader else None
        shname = u25.R(sh.get_raw_data()).str() if sh else None
        if sh:
            src = sh.get_raw_data().decode('latin1')
            m = re.search(r'Shader "([^"]+)"', src)
            shname = m.group(1) if m else shname
        main = tex.get('_MainTex')
        self.materials[k] = dict(name=name, shader=shname,
                                 tex=self.textures.get(main['tex']) if main else None,
                                 scale=main['scale'] if main else [1, 1], offset=main['offset'] if main else [0, 0],
                                 color=colors.get('_Color', [1, 1, 1, 1]), colors=colors, floats=floats)

    def mesh(self, k):
        if k in self.meshes or k is None:
            return
        o = self.P.obj(tuple([k.split(':')[0], int(k.split(':')[1])]))
        if o is None:
            self.meshes[k] = None
            return
        m = u25.mesh(o.get_raw_data())
        self.meshes[k] = dict(name=m['name'], v=[round(x, 4) for x in m['verts']], uv=[round(x, 5) for x in m['uv']],
                              subs=[sum(u25.triangles(m, s), []) for s in m['subs']])

    def clip(self, k):
        if k in self.clips or k is None:
            return
        o = self.P.obj(tuple([k.split(':')[0], int(k.split(':')[1])]))
        if o is None:
            self.clips[k] = None
            return
        self.clips[k] = anim_clip(o.get_raw_data())

    # ---------- scene
    def scene(self, fname):
        f = self.P.files[fname]
        objs = {}
        for o in f.objects.values():
            if o.type.name == 'GameObject':
                objs[o.path_id] = self.game_object(fname, f, o)
        return objs

    def game_object(self, fname, f, o):
        g = u25.game_object(o.get_raw_data())
        rec = dict(name=g['name'], active=g['active'], layer=g['layer'], tag=g['tag'])
        for cid, pptr in g['components']:
            co = f.objects.get(pptr[1]) if pptr[0] == 0 else None
            if co is None:
                continue
            d = co.get_raw_data(); r = u25.R(d); r.pptr()
            t = co.type.name
            if t == 'Transform':
                tr = u25.transform(d)
                rec['t'] = [round(x, 4) for x in tr['pos']]
                rec['r'] = [round(x, 6) for x in tr['rot']]
                rec['s'] = [round(x, 5) for x in tr['scale']]
                fa = self.ref(fname, tr['father'])
                rec['parent'] = fa
                rec['tid'] = key((fname, pptr[1]))
            elif t == 'MeshFilter':
                mk = self.ref(fname, r.pptr()); rec['mesh'] = mk; self.mesh(mk); rec['filter'] = {}
            elif t == 'MeshRenderer':
                en = r.u8(); r.u8(); r.u8(); r.u8()
                mats = [self.ref(fname, r.pptr()) for _ in range(r.i32())]
                subs = [r.i32() for _ in range(r.i32())]
                for m in mats:
                    self.material(m)
                rec['rend'] = dict(on=bool(en), mats=mats, subs=subs)
            elif t == 'BoxCollider':
                mat = self.ref(fname, r.pptr()); trig = r.u8(); r.align()
                rec['box'] = dict(trigger=bool(trig), size=r.fs(3), center=r.fs(3), mat=mat)
            elif t == 'SphereCollider':
                mat = self.ref(fname, r.pptr()); trig = r.u8(); r.align()
                rec['sphere'] = dict(trigger=bool(trig), radius=r.f32(), center=r.fs(3), mat=mat)
            elif t == 'CapsuleCollider':
                mat = self.ref(fname, r.pptr()); trig = r.u8(); r.align()
                rec['capsule'] = dict(trigger=bool(trig), radius=r.f32(), height=r.f32(), dir=r.i32(), center=r.fs(3), mat=mat)
            elif t == 'MeshCollider':
                mat = self.ref(fname, r.pptr()); trig = r.u8(); conv = r.u8(); r.align()
                mk = self.ref(fname, r.pptr()); self.mesh(mk)
                rec['meshcol'] = dict(trigger=bool(trig), convex=bool(conv), mesh=mk, mat=mat)
            elif t == 'Rigidbody':
                rec['body'] = dict(mass=r.f32(), drag=r.f32(), adrag=r.f32(), gravity=bool(r.u8()), kinematic=bool(r.u8()),
                                   interp=r.u8(), freezeRot=bool(r.u8()))
            elif t == 'HingeJoint':
                rec['hinge'] = dict(connected=self.ref(fname, r.pptr()), anchor=r.fs(3), axis=r.fs(3),
                                    useSpring=bool(r.i32()), spring=r.fs(3), useMotor=bool(r.i32()), motor=[r.f32(), r.f32(), r.i32()],
                                    useLimits=bool(r.i32()), limits=r.fs(4), breakForce=r.f32(), breakTorque=r.f32())
            elif t == 'Animation':
                en = r.u8(); r.align(); default = self.ref(fname, r.pptr())
                clips = [self.ref(fname, r.pptr()) for _ in range(r.i32())]
                wrap = r.i32(); play = r.u8()
                for c in [default] + clips:
                    self.clip(c)
                rec['anim'] = dict(on=bool(en), clip=default, clips=clips, wrap=wrap, play=bool(play))
            elif t == 'AudioSource':
                en = r.u8(); r.align(); clip = self.ref(fname, r.pptr()); awake = r.i32()
                vol, pitch, minv, maxv, roll = r.fs(5); loop = r.u8()
                rec['audio'] = dict(clip=clip, playOnAwake=bool(awake), volume=vol, pitch=pitch, loop=bool(loop))
                self.audio.setdefault(clip, None)
            elif t == 'Camera':
                en = r.u8(); r.align(); clear = r.i32(); bg = r.fs(4); rect = r.fs(4)
                near, far, fov = r.fs(3); ortho = r.i32(); size = r.f32(); depth = r.f32(); mask = r.i32()
                rec['camera'] = dict(on=bool(en), clear=clear, bg=bg, rect=rect, near=near, far=far, fov=fov,
                                     ortho=bool(ortho), size=size, depth=depth, mask=mask)
            elif t == 'MonoBehaviour':
                s = self.P.script_name(fname, d)
                if not s:
                    continue
                mb = mono.mono_behaviour(d, s)
                mb.pop('_go'); left = mb.pop('_left')
                if left:
                    mb['_undecoded'] = left
                mb = self.fix_refs(fname, mb)
                mb['_id'] = key((fname, pptr[1]))
                rec.setdefault('mb', []).append(mb)
            else:
                rec.setdefault('other', []).append(t)
            kind = COMPONENT_KEYS.get(t)
            if kind in rec:
                rec[kind]['_id'] = key((fname, pptr[1]))
        return rec


def anim_curve(r, n):
    keys = []
    for _ in range(r.i32()):
        keys.append([round(x, 5) for x in r.fs(1 + 3 * n)])
    pre, post = r.i32(), r.i32()
    return dict(keys=keys, pre=pre, post=post)


def anim_clip(d):
    r = u25.R(d)
    name = r.str()
    out = dict(name=name, rot=[], pos=[], scale=[], float=[])
    for kind, n in (('rot', 4), ('pos', 3), ('scale', 3)):
        for _ in range(r.i32()):
            c = anim_curve(r, n); c['path'] = r.str(); out[kind].append(c)
    for _ in range(r.i32()):
        c = anim_curve(r, 1); c['attr'] = r.str(); c['path'] = r.str(); c['cls'] = r.i32(); r.pptr()
        out['float'].append(c)
    out['rate'] = r.f32(); out['wrap'] = r.i32()
    out['_left'] = len(d) - r.p
    return out


WAV = ROOT / 'build' / 'audio'


def export_audio(d):
    """Write a Unity 2.5 clip as WAV (PCM formats 2 mono / 4 stereo) or MP3 (format 5) into build/audio."""
    r = u25.R(d)
    name = r.str()
    fmt, dur, freq, size = r.i32(), r.f32(), r.i32(), r.i32()
    WAV.mkdir(parents=True, exist_ok=True)
    base = slug(name)
    if fmt == 5:
        (WAV / (base + '.mp3')).write_bytes(d[d.find(b'\xff\xfb'):])
    else:
        import wave
        with wave.open(str(WAV / (base + '.wav')), 'wb') as w:
            w.setnchannels(2 if fmt == 4 else 1)
            w.setsampwidth(2)
            w.setframerate(freq)
            w.writeframes(d[len(d) - size:])
    return dict(name=name, file=base + '.mp3', duration=round(dur, 3))


def skin_refs(objs):
    for rec in objs:
        for mb in rec.get('mb', []):
            for k, v in mb.items():
                if 'skin' in k.lower() and isinstance(v, str):
                    yield v


# GUISkins referenced by scripts, plus their fonts (glyph atlases) -> skins.json / fonts.json
def export_gui(E, prefabs):
    import gui_export
    recs = list(prefabs.values())
    for sname in SCENES.values():
        recs += json.loads((OUT / 'scenes' / (sname + '.json')).read_text())['objects'].values()
    skins, fonts = {}, {}
    for k in sorted(set(skin_refs(recs))):
        fname, pid = k.rsplit(':', 1)
        sk = gui_export.skin(E.P.obj((fname, int(pid))).get_raw_data())
        sk['font'] = E.ref(fname, sk['font'])
        for st in sk['styles'].values():
            st['font'] = E.ref(fname, st['font'])
            for state in gui_export.STATES:
                st[state]['bg'] = E.ref(fname, st[state]['bg'])
                E.texture(st[state]['bg'])
        skins[k] = sk
        fk = sk['font']
        if fk and fk not in fonts:
            ffile, fpid = fk.rsplit(':', 1)
            fo = gui_export.font(E.P.obj((ffile, int(fpid))).get_raw_data())
            mk = E.ref(ffile, fo.pop('material'))
            E.material(mk)
            fo['texture'] = E.materials[mk]['tex']
            fonts[fk] = fo
    dump(OUT / 'skins.json', skins)
    dump(OUT / 'fonts.json', fonts)
    print('skins', list(skins), 'fonts', list(fonts))


def main():
    E = Exporter()
    (OUT / 'scenes').mkdir(parents=True, exist_ok=True)
    for fname, sname in SCENES.items():
        objs = E.scene(fname)
        dump(OUT / 'scenes' / (sname + '.json'), dict(file=fname, objects={key((fname, k)): v for k, v in objs.items()}))
    # prefabs living in shared asset files
    prefabs = {}
    for fname in E.P.files:
        if fname.startswith('sharedassets'):
            for k, v in E.scene(fname).items():
                prefabs[key((fname, k))] = v
    for fname, f in E.P.files.items():
        for o in f.objects.values():
            if o.type.name == 'Mesh':
                E.mesh(key((fname, o.path_id)))   # meshes swapped in by scripts are not on any MeshFilter
            elif o.type.name == 'Texture2D':
                try:
                    E.texture(key((fname, o.path_id)))
                except (ValueError, NotImplementedError):
                    pass
            elif o.type.name == 'PhysicMaterial':
                r = u25.R(o.get_raw_data())
                pm_name = r.str(); dyn, stat, bounce = r.fs(3)
                E.physic[key((fname, o.path_id))] = dict(name=pm_name, friction=round(dyn, 4), staticFriction=round(stat, 4), bounce=round(bounce, 4))
            elif o.type.name == 'AudioClip':
                E.audio[key((fname, o.path_id))] = export_audio(o.get_raw_data())
    export_gui(E, prefabs)
    dump(OUT / 'physic.json', E.physic)
    dump(OUT / 'textures.json', E.textures)
    dump(OUT / 'audio.json', E.audio)
    dump(OUT / 'prefabs.json', prefabs)
    dump(OUT / 'meshes.json', E.meshes)
    dump(OUT / 'materials.json', E.materials)
    dump(OUT / 'clips.json', E.clips)
    bad = {k: v['_left'] for k, v in E.clips.items() if v and v['_left']}
    print('meshes', len(E.meshes), 'materials', len(E.materials), 'textures', len(E.textures), 'clips', len(E.clips), 'bad clips', bad)


if __name__ == '__main__':
    main()
