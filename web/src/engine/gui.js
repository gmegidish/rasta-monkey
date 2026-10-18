// Unity's immediate-mode GUI (OnGUI) for the 480x320 screen: GUISkin styles with 9-slice backgrounds and bitmap fonts.
// Scripts call GUI.* inside OnGUI; calls are recorded as draw commands and painted over the 3D view by the renderer.

const ANCHOR_X = [0, 0.5, 1, 0, 0.5, 1, 0, 0.5, 1];
const ANCHOR_Y = [0, 0, 0, 0.5, 0.5, 0.5, 1, 1, 1];
const ScaleMode = { StretchToFill: 0, ScaleAndCrop: 1, ScaleToFit: 2 };

export class GUI {
  constructor(assets) {
    this.assets = assets;
    this.commands = [];
    this.skin = null;
    this.color = [1, 1, 1, 1];
    this.clicks = [];
    this.pressed = null;     // where the current press started
    this.tinted = new Map(); // font image + colour -> tinted atlas canvas
  }

  // start a frame: clicks are {pos:[x,y] Unity screen (origin bottom-left), down}
  begin(clicks) {
    this.commands = [];
    this.color = [1, 1, 1, 1];
    this.clicks = clicks.map((c) => ({ ...c, pos: [c.pos[0], 320 - c.pos[1]] }));
    for (const c of this.clicks) {
      if (c.down) {
        this.pressed = c.pos;
      }
    }
  }

  skinData() {
    const s = this.skin;
    if (!s) {
      return this.assets.skins['sharedassets1.assets:384'] || null;
    }
    return typeof s === 'string' ? this.assets.skins[s] : s;
  }

  style(name) {
    const sk = this.skinData();
    return sk ? { ...sk.styles[name], skinFont: sk.font } : null;
  }

  DrawTexture(rect, tex, scaleMode = ScaleMode.StretchToFill) {
    const img = typeof tex === 'string' ? this.assets.texture(tex) : tex;
    if (img) {
      this.commands.push({ type: 'image', rect: rect.slice(), img, scaleMode, alpha: this.color[3] });
    }
  }

  Box(rect, text) {
    this.drawStyled('box', rect, text);
  }

  Label(rect, text) {
    this.drawStyled('label', rect, text);
  }

  // true when a press that started inside rect is released inside it this frame
  Button(rect, text) {
    this.drawStyled('button', rect, text);
    const inside = (p) => p && p[0] >= rect[0] && p[0] < rect[0] + rect[2] && p[1] >= rect[1] && p[1] < rect[1] + rect[3];
    return this.clicks.some((c) => !c.down && inside(c.pos) && inside(this.pressed));
  }

  drawStyled(name, rect, text) {
    const st = this.style(name);
    if (!st) {
      return;
    }
    const bg = st.normal.bg && this.assets.texture(st.normal.bg);
    if (bg) {
      this.commands.push({ type: 'slice', rect: rect.slice(), img: bg, border: st.border, alpha: this.color[3] });
    }
    if (text) {
      const font = this.assets.fonts[st.font || st.skinFont];
      if (font) {
        this.commands.push({ type: 'text', rect: rect.slice(), text: String(text), font, style: st, color: st.normal.color.map((v, i) => v * this.color[i]) });
      }
    }
  }

  // ---------------------------------------------------------------- painting (called by the renderer)
  paint(ctx, scale) {
    for (const c of this.commands) {
      ctx.save();
      ctx.globalAlpha = c.alpha ?? 1;
      if (c.type === 'image') {
        this.paintImage(ctx, scale, c);
      } else if (c.type === 'slice') {
        paintSlice(ctx, scale, c);
      } else if (c.type === 'text') {
        this.paintText(ctx, scale, c);
      }
      ctx.restore();
    }
  }

  paintImage(ctx, s, c) {
    const [x, y, w, h] = c.rect, img = c.img;
    if (c.scaleMode === ScaleMode.StretchToFill) {
      ctx.drawImage(img, x * s, y * s, w * s, h * s);
      return;
    }
    const ia = img.width / img.height, ra = w / h;
    if (c.scaleMode === ScaleMode.ScaleAndCrop) {
      // fill the rect, cropping the image's overflow
      let sw = img.width, sh = img.height;
      if (ia > ra) {
        sw = img.height * ra;
      } else {
        sh = img.width / ra;
      }
      ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x * s, y * s, w * s, h * s);
    } else {
      const fw = ia > ra ? w : h * ia, fh = ia > ra ? w / ia : h;
      ctx.drawImage(img, (x + (w - fw) / 2) * s, (y + (h - fh) / 2) * s, fw * s, fh * s);
    }
  }

  tintedAtlas(font, color) {
    const key = font.texture + color.join(',');
    let cv = this.tinted.get(key);
    if (!cv) {
      const img = this.assets.images[font.texture];
      cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = `rgb(${color.slice(0, 3).map((v) => Math.round(v * 255)).join(',')})`;
      g.fillRect(0, 0, cv.width, cv.height);
      this.tinted.set(key, cv);
    }
    return cv;
  }

  paintText(ctx, s, c) {
    const st = c.style, font = c.font;
    const [x, y, w, h] = c.rect;
    const pad = st.padding;   // left, right, top, bottom
    const inner = [x + pad[0], y + pad[2], w - pad[0] - pad[1], h - pad[2] - pad[3]];
    const lines = layoutLines(font, c.text, st.wordWrap ? inner[2] : Infinity);
    const lh = font.lineSpacing;
    const totalH = lines.length * lh;
    const ax = ANCHOR_X[st.alignment], ay = ANCHOR_Y[st.alignment];
    const atlas = this.tintedAtlas(font, c.color);
    const aw = atlas.width, ah = atlas.height;
    let ty = inner[1] + (inner[3] - totalH) * ay;
    for (const line of lines) {
      let tx = inner[0] + (inner[2] - line.width) * ax;
      for (const ch of line.text) {
        const g = font.glyphs[ch.charCodeAt(0)];
        if (!g) {
          continue;
        }
        const [u, v, uw, vh] = g.uv, [vx, vy, vw, vhh] = g.vert;
        if (uw > 0 && vh > 0) {
          // uv origin is bottom-left; vert rect y grows down as negative numbers
          const sx = u * aw, sy = (1 - v - vh) * ah;
          ctx.drawImage(atlas, sx, sy, uw * aw, vh * ah, (tx + vx) * s, (ty - vy) * s, vw * s, -vhh * s);
        }
        tx += g.width;
      }
      ty += lh;
    }
  }
}

function textWidth(font, text) {
  let w = 0;
  for (const ch of text) {
    const g = font.glyphs[ch.charCodeAt(0)];
    w += g ? g.width : 0;
  }
  return w;
}

function layoutLines(font, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const cand = line ? line + ' ' + word : word;
      if (line && textWidth(font, cand) > maxW) {
        out.push(line);
        line = word;
      } else {
        line = cand;
      }
    }
    out.push(line);
  }
  return out.map((t) => ({ text: t, width: textWidth(font, t) }));
}

// a background stretched with fixed-size borders (GUIStyle.border: left, right, top, bottom)
function paintSlice(ctx, s, c) {
  const img = c.img;
  const [l, r, t, b] = c.border;
  const [x, y, w, h] = c.rect;
  const sxs = [0, l, img.width - r, img.width], sys = [0, t, img.height - b, img.height];
  const dxs = [x, x + l, x + w - r, x + w], dys = [y, y + t, y + h - b, y + h];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const sw = sxs[i + 1] - sxs[i], sh = sys[j + 1] - sys[j];
      const dw = dxs[i + 1] - dxs[i], dh = dys[j + 1] - dys[j];
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) {
        ctx.drawImage(img, sxs[i], sys[j], sw, sh, dxs[i] * s, dys[j] * s, dw * s, dh * s);
      }
    }
  }
}
