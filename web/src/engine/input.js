// Touch input in Unity iPhone terms: touches in 480x320 screen pixels with the origin at the bottom left.
// Real touchscreens report their fingers. With a mouse: hold the left button to put one finger at the cursor,
// and hold Space (or the right button) for a second finger; letting go of Space lifts every finger, so
// "hold Space, release" is the original two-finger jump.
export class Input {
  constructor(canvas, screen) {
    this.canvas = canvas;
    this.screen = screen;            // { width, height } in Unity pixels
    this.touchList = new Map();      // touch id -> position
    this.mouse = null;
    this.mouseDown = false;
    this.second = false;
    this.lifted = false;             // after a two-finger release, wait for a fresh press
    this.clicks = [];                // pending GUI clicks (Unity screen coords)
    this.listeners = [];
    const opts = { passive: false };
    canvas.addEventListener('touchstart', (e) => this.onTouch(e), opts);
    canvas.addEventListener('touchmove', (e) => this.onTouch(e), opts);
    canvas.addEventListener('touchend', (e) => this.onTouch(e), opts);
    canvas.addEventListener('touchcancel', (e) => this.onTouch(e), opts);
    canvas.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mousemove', (e) => this.onMouse(e, null));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  toUnity(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * this.screen.width, (1 - (clientY - r.top) / r.height) * this.screen.height];
  }

  onTouch(e) {
    e.preventDefault();
    this.emit('press');
    const before = this.touchList.size;
    this.touchList.clear();
    for (const t of e.touches) {
      this.touchList.set(t.identifier, this.toUnity(t.clientX, t.clientY));
    }
    if (e.type === 'touchstart' && this.touchList.size > before) {
      const t = e.changedTouches[0];
      this.clicks.push({ pos: this.toUnity(t.clientX, t.clientY), down: true });
    }
    if (e.type === 'touchend') {
      const t = e.changedTouches[0];
      this.clicks.push({ pos: this.toUnity(t.clientX, t.clientY), down: false });
    }
  }

  onMouse(e, down) {
    if (down === null) {
      this.mouse = this.toUnity(e.clientX, e.clientY);
      return;
    }
    if (down && e.target !== this.canvas) {
      return;
    }
    this.mouse = this.toUnity(e.clientX, e.clientY);
    if (e.button === 2) {
      this.second = down;
      if (!down) {
        this.lifted = true;
      }
      return;
    }
    if (e.button !== 0) {
      return;
    }
    if (down) {
      this.emit('press');
      this.lifted = false;
    }
    this.mouseDown = down;
    this.tapPending ||= down;      // a click shorter than a frame still counts as one frame of finger
    this.clicks.push({ pos: this.mouse, down });
  }

  onKey(e, down) {
    if (e.code !== 'Space') {
      return;
    }
    e.preventDefault();
    if (e.repeat) {
      return;
    }
    if (down) {
      this.emit('press');
      this.lifted = false;
    }
    this.second = down;
    if (!down) {
      this.lifted = true;
    }
  }

  on(name, fn) {
    this.listeners.push([name, fn]);
  }

  emit(name) {
    for (const [n, fn] of this.listeners) {
      if (n === name) {
        fn();
      }
    }
  }

  // Unity iPhoneInput.touches equivalent
  get touches() {
    if (this.touchList.size) {
      return [...this.touchList.values()].map((p) => ({ position: p }));
    }
    if (this.lifted || !this.mouse) {
      return [];
    }
    if (this.second) {
      return [{ position: this.mouse }, { position: this.mouse }];
    }
    return this.mouseDown || this.tapPending ? [{ position: this.mouse }] : [];
  }

  get touchCount() {
    return this.touches.length;
  }

  GetTouch(i) {
    return this.touches[i];
  }

  // GUI clicks for this frame, consumed by the GUI layer
  takeClicks() {
    const c = this.clicks;
    this.clicks = [];
    this.tapPending = false;
    return c;
  }
}
