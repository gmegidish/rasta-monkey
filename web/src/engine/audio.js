// Web Audio playback of the exported clips (keyed by Unity asset key).
export class Audio {
  constructor(assets) {
    this.assets = assets;
    this.ctx = null;
    this.buffers = new Map();
    this.muted = false;
    this.master = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        return;
      }
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.master.gain.value = this.muted ? 0 : 1;
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) {
      this.master.gain.value = m ? 0 : 1;
    }
  }

  buffer(key) {
    let p = this.buffers.get(key);
    if (!p) {
      const info = this.assets.audio[key];
      if (!info || !this.ctx) {
        return null;
      }
      p = fetch('data/audio/' + info.file).then((r) => r.arrayBuffer()).then((b) => this.ctx.decodeAudioData(b)).catch(() => null);
      this.buffers.set(key, p);
    }
    return p;
  }

  preload(keys) {
    for (const k of keys) {
      this.buffer(k);
    }
  }

  // returns a voice handle { stop(), playing }
  play(key, { volume = 1, loop = false, pitch = 1 } = {}) {
    const voice = { playing: true, src: null, stopped: false, stop() { this.stopped = true; this.playing = false; if (this.src) { try { this.src.stop(); } catch (e) { /* already stopped */ } } } };
    const p = key && this.buffer(key);
    if (!p) {
      voice.playing = false;
      return voice;
    }
    p.then((buf) => {
      if (!buf || voice.stopped) {
        voice.playing = false;
        return;
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = loop;
      src.playbackRate.value = pitch;
      const g = this.ctx.createGain();
      g.gain.value = volume;
      src.connect(g).connect(this.master);
      src.onended = () => { voice.playing = false; };
      src.start();
      voice.src = src;
      voice.gain = g;
    });
    return voice;
  }
}
