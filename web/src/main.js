// Rasta Monkey — boot, scene switching and the frame loop.
import { loadAssets, loadScene } from './engine/assets.js';
import { Audio } from './engine/audio.js';
import { Input } from './engine/input.js';
import { Renderer } from './engine/render.js';
import { World } from './engine/world.js';
import { registerScripts } from './engine/scene.js';
import * as scripts from './scripts/index.js';
import { PlayerPrefs } from './scripts/unity.js';

registerScripts(scripts);

const SCREEN = { width: 480, height: 320 };
// build order: Application.LoadLevel(i) loads SCENES[i]
const SCENES = ['id', 'start', ...Array.from({ length: 15 }, (_, i) => `level${i + 1}`), 'goal', 'end'];
const canvas = document.getElementById('view');
const params = new URLSearchParams(location.search);

class Game {
  constructor(assets) {
    this.assets = assets;
    this.audio = new Audio(assets);
    this.input = new Input(canvas, SCREEN);
    this.renderer = new Renderer(canvas, assets);
    this.world = null;
    this.prefs = loadPrefs();
    PlayerPrefs.game = this;
    this.input.on('press', () => this.audio.unlock());
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(Math.round(r.width * dpr), Math.round(r.height * dpr));
  }

  // Application.LoadLevel
  async loadLevel(name) {
    name = typeof name === 'number' ? SCENES[name] : name.toLowerCase();
    const scene = await loadScene(this.assets, name);
    if (this.world) {
      this.world.dispose && this.world.dispose();
    }
    const world = new World(this, this.assets, name);
    world.screenWidth = SCREEN.width;
    world.screenHeight = SCREEN.height;
    this.world = world;
    world.load(scene);
    window.world = world;
    return world;
  }

  // Application.loadedLevel of a scene: 0 id splash, 1 start menu, 2..16 levels 1..15, 17 goal reached, 18 end
  levelIndex(name) {
    return Math.max(0, SCENES.indexOf(name.toLowerCase()));
  }

  goalReached(levelAttributes) {
    this.lastLevel = levelAttributes;   // DontDestroyOnLoad: the GoalReached scene reads its score
    this.loadLevel('goal');
  }

  frame(dt) {
    if (this.world) {
      this.world.tick(dt);
      this.renderer.render(this.world);
    }
  }
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem('rasta-monkey') || '{}');
  } catch (e) {
    return {};
  }
}

async function boot() {
  const fill = document.querySelector('#boot .fill');
  const assets = await loadAssets((p) => { fill.style.width = `${Math.round(p * 100)}%`; });
  const game = new Game(assets);
  window.game = game;
  await game.loadLevel(params.get('scene') || 'id');
  document.getElementById('boot').classList.add('done');
  let last = performance.now();
  const loop = (now) => {
    game.frame((now - last) / 1000);
    last = now;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('boot').textContent = 'Failed to load: ' + e.message;
});
