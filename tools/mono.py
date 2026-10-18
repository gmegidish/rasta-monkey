"""Decode Unity 2.5 MonoBehaviour fields using field lists parsed from the decompiled sources."""
import re
from pathlib import Path
from u25 import R

SRC = Path(__file__).resolve().parents[1] / 'recovered' / 'decomp-unityscript'
CLASS_RE = re.compile(r'^public (?:sealed )?(?:class|enum) (\w+)(?: : (\w+))?', re.M)
FIELD_RE = re.compile(r'^\tpublic ([\w.\[\]]+) (\w+);', re.M)
SKIP = {'UnityScript.Lang.Array', 'Type', 'AnimationState', 'Hashtable'}
PRIMS = {'float', 'int', 'bool', 'string', 'Vector3', 'Vector2', 'Color', 'Rect', 'Quaternion'}
BOOL_ALIGN = True


def _load():
    classes, enums = {}, set()
    for f in SRC.glob('*.cs'):
        text = f.read_text()
        for m in CLASS_RE.finditer(text):
            if text[m.start():m.end()].startswith('public enum'):
                enums.add(m.group(1))
                continue
            # fields belong to the top-level class only: cut nested classes (indented)
            body = text[m.end():]
            nxt = CLASS_RE.search(body)
            body = body[:nxt.start()] if nxt else body
            classes[m.group(1)] = (m.group(2), [(t, n) for t, n in FIELD_RE.findall(body)])
    return classes, enums


CLASSES, ENUMS = _load()


def fields_of(cls):
    out = []
    while cls in CLASSES:
        base, fs = CLASSES[cls]
        out = fs + out
        cls = base
    return out


def _value(r, t):
    if t.endswith('[]'):
        n = r.i32()
        v = [_value(r, t[:-2]) for _ in range(n)]
        r.align()
        return v
    if t == 'float':
        return r.f32()
    if t == 'int' or t in ENUMS:
        return r.i32()
    if t == 'bool':
        v = bool(r.u8())
        if BOOL_ALIGN:
            r.align()
        return v
    if t == 'string':
        return r.str()
    if t == 'Vector3':
        return r.fs(3)
    if t == 'Vector2':
        return r.fs(2)
    if t in ('Color', 'Rect', 'Quaternion'):
        return r.fs(4)
    if t in CLASSES and CLASSES[t][0] is None and t[0].isupper() and not _is_component(t):
        return {n: _value(r, ft) for ft, n in fields_of(t) if ft not in SKIP}
    return r.pptr()


def _is_component(t):
    while t in CLASSES:
        base = CLASSES[t][0]
        if base in ('MonoBehaviour', 'Item', 'Hangable', 'ControlLogic', 'PlatformBehaviour'):
            return True
        t = base
    return False


def mono_behaviour(d, script):
    r = R(d)
    go = r.pptr(); enabled = r.u8(); r.align(); scr = r.pptr(); name = r.str()
    out = {'_go': go, '_enabled': bool(enabled), '_script': script}
    for t, n in fields_of(script):
        if t in SKIP:
            continue
        out[n] = _value(r, t)
    out['_left'] = len(d) - r.p
    return out
