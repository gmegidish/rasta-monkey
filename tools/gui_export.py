"""Unity 2.5 GUISkin (a built-in MonoBehaviour) and Font parsers, for the OnGUI emulation."""
import u25

STATES = ['normal', 'hover', 'active', 'focused', 'onNormal', 'onHover', 'onActive', 'onFocused']
SKIN_STYLES = ['box', 'button', 'toggle', 'label', 'textField', 'textArea', 'window']


def style(r):
    s = dict(name=r.str())
    for st in STATES:
        s[st] = dict(bg=r.pptr(), color=r.fs(4))
    for k in ('border', 'margin', 'padding', 'overflow'):
        s[k] = [r.i32() for _ in range(4)]           # left, right, top, bottom
    s['font'] = r.pptr()
    s['imagePosition'] = r.i32()
    s['alignment'] = r.i32()                         # TextAnchor: 0 UpperLeft .. 8 LowerRight
    s['wordWrap'] = r.i32() != 0
    s['clipping'] = r.i32()
    s['contentOffset'] = r.fs(2)
    s['fixedWidth'], s['fixedHeight'] = r.fs(2)
    s['stretchWidth'], s['stretchHeight'] = r.i32() != 0, r.i32() != 0
    return s


def skin(d):
    r = u25.R(d)
    r.pptr(); r.u8(); r.align(); r.pptr()            # MonoBehaviour header
    name = r.str()
    font = r.pptr()
    return dict(name=name, font=font, styles={n: style(r) for n in SKIN_STYLES})


def font(d):
    r = u25.R(d)
    name = r.str()
    ascii_start, size, font_size = r.i32(), r.i32(), r.i32()
    kerning, line_spacing = r.f32(), r.f32()
    r.pptr()
    material = r.pptr()                              # its _MainTex is the glyph atlas
    glyphs = {}
    for _ in range(r.i32()):
        idx = r.i32()
        uv = r.fs(4)
        vert = r.fs(4)
        width = r.f32()
        glyphs[idx] = dict(uv=uv, vert=vert, width=width)
    return dict(name=name, size=size, kerning=kerning, lineSpacing=line_spacing, material=material, glyphs=glyphs)
