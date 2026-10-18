// HUD and menus: the 3D "Bolshoi" buttons on the camera (tapped by ray casts), the fruit counter label,
// the pause menu and the instruction bubbles (both OnGUI).
import { MonoBehaviour, PlayerPrefs, WaitForSeconds } from './unity.js';
import { MeshFilter, Renderer } from '../engine/components.js';
import { LevelAttributes } from './level.js';
import { TouchControl } from './creature.js';

// taps on the camera's GUI meshes: a single finger inside checkArea is cast as a ray against each element
export class GUIBolshoi extends MonoBehaviour {
  Start() {
    this.touches = TouchControl.GetInstance(this.world);
    this.guiCam = this.GetComponent('Camera');
  }

  Update() {
    const t = this.touches;
    t.Refresh();
    const [x, y, w, h] = this.checkArea;
    const p = t.touch;
    if (t.fingersDown !== 1 || !(p[0] >= x && p[0] < x + w && p[1] >= y && p[1] < y + h)) {
      return;
    }
    const ray = this.guiCam.ScreenPointToRay(p);
    for (const e of this.elements) {
      if (e && !e.gameObject.destroyed && e.CheckClick(ray)) {
        t.fingersDown = 0;
        break;
      }
    }
  }
}

export class GUIBolshoiElement extends MonoBehaviour {
  CheckClick() { return false; }
  Refresh() {}
}

export class GUICombiner extends MonoBehaviour {}

export class GUIElementButton extends GUIBolshoiElement {
  constructor(go) {
    super(go);
    this.timer = 1;
    this.lastClickTime = -999;
  }

  Start() {
    this.myRenderer = this.myRenderer || this.renderer;
  }

  Run() {}
  GetRenderer() { return this.myRenderer; }

  CheckClick(ray) {
    if (!this.myRenderer) {
      return false;
    }
    if (!this.myRenderer.bounds.IntersectRay(ray)) {
      return false;
    }
    if (this.Time.realtime - this.lastClickTime > this.timer) {
      this.Run();
      this.lastClickTime = this.Time.realtime;
    }
    return true;
  }
}

// toggles the jump-direction arrow helper
export class GUIElementButtonArrow extends GUIElementButton {
  Awake() {
    this.levelAttr = LevelAttributes.GetInstance(this.world);
    const la = this.levelAttr;
    const ch = PlayerPrefs.GetInt('Selected Character', 0);
    if (ch === 0) {
      la.SetArrow(PlayerPrefs.GetInt('Arrow', 1) === 1);
    } else if (ch === 1) {
      const early = this.world.game.levelIndex(this.world.sceneName) - 1 < 3;
      la.SetArrow(!PlayerPrefs.HasKey('Arrow') && early ? true : PlayerPrefs.GetInt('Arrow', 0) === 1);
    } else {
      la.SetArrow(PlayerPrefs.GetInt('Arrow', 0) === 1);
    }
    this.Refresh();
  }

  Refresh() {
    this.GetComponent('MeshFilter').mesh = this.levelAttr.GetArrow() ? this.onMesh : this.offMesh;
  }

  Run() {
    const la = this.levelAttr;
    la.SetArrow(!la.GetArrow());
    PlayerPrefs.SetInt('Arrow', la.GetArrow() ? 1 : 0);
    this.Refresh();
  }
}

export class GUIElementButtonInstructions extends GUIElementButton {
  Run() {
    this.instructorPlayer.Play();
  }
}

export class GUIElementButtonPause extends GUIElementButton {
  Run() {
    this.pauseMenu.Pause();
  }
}

// two child meshes (speaker on / off); the inactive one is parked 5 units up, out of view
export class GUIElementButtonMute extends GUIElementButton {
  Awake() {
    const audio = this.world.audio;
    audio.setMuted(PlayerPrefs.GetInt('Volume', 1) === 0);
    const material = this.renderer.material;
    const make = (mesh) => {
      const go = this.world.createGameObject('');
      go.transform.setParent(this.transform);
      const mf = new MeshFilter(go, mesh);
      const r = new Renderer(go, { on: true, mats: [material], subs: [] });
      go.components.push(mf, r);
      this.world.renderers.push(r);
      return { go, r };
    };
    const on = make(this.offMesh);
    const off = make(this.onMesh);
    this.onGO = on.go;
    this.offGO = off.go;
    this.onGORenderer = on.r;
    this.offGORenderer = off.r;
    this.Destroy(this.renderer);
    this.Destroy(this.GetComponent('MeshFilter'));
    this.Refresh();
  }

  GetRenderer() {
    return this.world.audio.muted ? this.offGORenderer : this.onGORenderer;
  }

  Refresh() {
    const muted = this.world.audio.muted;
    this.onGO.transform.setLocal([0, muted ? 5 : 0, 0]);
    this.offGO.transform.setLocal([0, muted ? 0 : 5, 0]);
    this.myRenderer = muted ? this.offGORenderer : this.onGORenderer;
  }

  CheckClick(ray) {
    this.myRenderer = this.GetRenderer();
    return super.CheckClick(ray);
  }

  Run() {
    const audio = this.world.audio;
    audio.setMuted(!audio.muted);
    PlayerPrefs.SetInt('Volume', audio.muted ? 0 : 1);
    this.Refresh();
  }
}

// a row of digit meshes spelling out text such as "b3/5"
export class GUIElementLabel extends GUIBolshoiElement {
  constructor(go) {
    super(go);
    this.text = 'b 1/2 c 3/4';
    this.letterOffset = [30, 0, 0];
    this.idle = false;
  }

  CreateDigit(i) {
    const p = this.transform.position, o = this.letterOffset;
    const go = this.Instantiate(this.digitPrefab, [p[0] + o[0] * i, p[1] + o[1] * i, p[2] + o[2] * i], this.transform.rotation);
    go.transform.SetParent(this.transform);
    this.digits[i] = go.GetComponent('GUIElementDigit');
  }

  AbstractStart() {
    this.digits = [];
    for (let i = 0; i < 30; i++) {
      this.CreateDigit(i);
    }
    this.idle = true;
  }

  Start() {
    this.AbstractStart();
  }

  Refresh() {
    if (!this.idle) {
      return;
    }
    this.digits.forEach((d, i) => d.SetChar(i < this.text.length ? this.text[i] : ' '));
  }
}

export class GUIFruitsLabel extends GUIElementLabel {
  Start() {
    const la = LevelAttributes.GetInstance(this.world);
    if (la.currentLevel === 1 && PlayerPrefs.GetInt('Selected Character', 1) < 2) {
      this.Destroy(this.gameObject);
      return;
    }
    this.AbstractStart();
    la.Register('fruitsText', this);
  }
}

const DIGIT_CHARS = '_0123456789/+bcsa';   // GUIBolshoiDigit order; index 0 is "none"

export class GUIElementDigit extends GUIBolshoiElement {
  Awake() {
    this.filter = this.GetComponent('MeshFilter');
    this.digit = this.digit ?? 1;
    this.Refresh();
  }

  SetDigit(d) {
    this.digit = d;
    this.Refresh();
  }

  SetChar(c) {
    const i = DIGIT_CHARS.indexOf(c);
    this.SetDigit(i > 0 ? i : 0);
  }

  Refresh() {
    this.filter.mesh = this.meshes[this.digit];
  }
}

// ------------------------------------------------------------------ OnGUI screens
export class PauseMenu extends MonoBehaviour {
  Start() {
    if (this.world.sceneName === 'start') {
      this.PauseGame();
    }
    this.levelAttributes = LevelAttributes.GetInstance(this.world);
    this.ind = 0;
    this.enabled = false;
  }

  Pause() {
    this.enabled = true;
  }

  OnGUI() {
    this.world.timeScale = 0;
    this.Menu();
  }

  // three stacked image buttons (resume, menu, restart) in the middle of the screen
  Menu() {
    const GUI = this.world.gui;
    const W = this.world.screenWidth, H = this.world.screenHeight;
    GUI.skin = this.skin;
    const n = Math.floor(W / 3);
    let top = Math.floor(H / 2) - Math.floor(n / 2) - Math.floor(n / 4);
    const row = (tex) => {
      const y = top + n / 2.5;
      if (tex) {
        GUI.DrawTexture([W / 2 - n / 1.35, y, n * 1.5, Math.floor(n / 4)], tex, 1);
      }
      const hit = GUI.Button([Math.floor(W / 2) - Math.floor(n / 2), y, n, Math.floor(n / 4)], '');
      top += Math.floor(n / 4);
      return hit;
    };
    if (row(this.playTexture)) {
      this.UnPauseGame();
    }
    if (row(this.menuTexture)) {
      this.world.timeScale = 1;
      this.world.game.loadLevel('start');
    }
    if (row(this.restartTexture)) {
      this.world.timeScale = 1;
      PlayerPrefs.SetInt('LoadedLevel', 0);
      this.world.game.loadLevel('level' + this.levelAttributes.currentLevel);
    }
    if (row(null) && this.creatures && this.creatures.length) {
      this.levelAttributes.SetUserActor(this.creatures[this.ind]);
      this.ind = (this.ind + 1) % this.creatures.length;
    }
  }

  PauseGame() {
    this.world.timeScale = 0;
  }

  UnPauseGame() {
    this.world.timeScale = 1;
    this.enabled = false;
  }

  IsGamePaused() {
    return this.world.timeScale === 0;
  }
}

export class Instructor extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.ended = true;
    this.lastShow = -99999;
    this.minTwiceDisplayTime = 30;
    this.pauseGame = true;
  }

  NumberOfPages() {
    return Math.max(this.texts.length, this.textures.length, this.bg.length);
  }

  Setup() {}

  AbstractStart() {
    const la = LevelAttributes.GetInstance(this.world);
    const ch = la.characterOrder[PlayerPrefs.GetInt('Selected Character', 0)];
    if (!this.FeetsTheCharacter(ch)) {
      this.Destroy(this);
      return;
    }
    this.lastShow = -99999;
    this.Setup();
    if (this.autoStart && !la.loadedLevel) {
      this.Show();
    }
  }

  Start() {
    this.AbstractStart();
  }

  Show() {
    this.StartCoroutine(this.AbstractShow());
  }

  * AbstractShow() {
    if (this.Time.time - this.lastShow > this.minTwiceDisplayTime) {
      this.ended = false;
      this.lastShow = this.Time.time;
      yield new WaitForSeconds(0.1);
      this.Setup();
      InstructorPlayer.GetInstance(this.world).Play(this);
    } else {
      this.End();
    }
  }

  // "fits the character": character None means everyone
  FeetsTheCharacter(c) {
    return !(this.character !== 0 && this.character !== c && this.character1 !== c && this.character2 !== c);
  }

  End() {
    this.ended = true;
  }
}

export class StartInstructor extends Instructor {
  Setup() {
    if (!this.goalCondition) {
      const goal = LevelAttributes.GetInstance(this.world).goal;
      if (goal) {
        this.goalCondition = goal.condition;
      }
    }
    if (this.goalCondition) {
      this.texts = this.texts.map((s) => s.replace('[condition]', this.goalCondition.toString()));
    }
  }
}

// shows an Instructor's pages (background, picture, text box); a tap (press and release) turns the page
export class InstructorPlayer extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.ready = false;
    this.phase = 0;
    this.index = 0;
  }

  Play(instructor) {
    instructor = instructor || this.instructor;
    if (!instructor) {
      return;
    }
    this.instructor = instructor;
    this.index = 0;
    this.phase = 0;
    if (instructor.pauseGame) {
      this.world.timeScale = 0;
    }
    this.enabled = true;
    this.ready = false;
  }

  Stop() {
    if (this.instructor) {
      this.instructor.End();
    }
    this.UnPauseGame();
  }

  UnPauseGame() {
    this.world.timeScale = 1;
    this.enabled = false;
  }

  touchControl() {
    return TouchControl.GetInstance(this.world);
  }

  Update() {
    const tc = this.touchControl();
    tc.Refresh();
    if (!this.ready && tc.fingersDown === 0) {
      this.ready = true;
    }
  }

  OnGUI() {
    const ins = this.instructor;
    if (!ins || ins.gameObject.destroyed) {
      this.Stop();
      return;
    }
    const GUI = this.world.gui;
    const W = this.world.screenWidth, H = this.world.screenHeight;
    if (ins.skin) {
      GUI.skin = ins.skin;
    }
    const page = (arr) => arr[Math.min(arr.length - 1, this.index)];
    if (ins.bg.length && page(ins.bg)) {
      GUI.DrawTexture([0, Math.floor(H / 36), W, H], page(ins.bg), 1);
    }
    if (ins.textures.length) {
      GUI.DrawTexture(page(ins.textureRects), page(ins.textures), 1);
    }
    if (ins.texts.length) {
      GUI.Box(page(ins.textRects), page(ins.texts));
    }
    if (this.ready) {
      this.GetKey();
    }
  }

  Next() {
    if (this.index < this.instructor.NumberOfPages() - 1) {
      this.index++;
      this.phase = 0;
    } else {
      this.Stop();
    }
  }

  // wait for: no finger, a finger, no finger again -> next page
  GetKey() {
    const down = this.touchControl().fingersDown;
    if ((this.phase === 0 && down === 0) || (this.phase === 1 && down > 0) || (this.phase === 2 && down === 0)) {
      this.phase++;
    } else if (this.phase === 3) {
      this.Next();
    }
  }

  static GetInstance(world) {
    return world.FindObjectOfType('InstructorPlayer');
  }
}

// a trigger zone that pops an Instructor the first time the creature lands in it
export class InstructionPoint extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.triggerDelay = 0;
    this.lastClose = -10000;
  }

  Start() {
    this.lastClose = this.Time.time - 120;
    this.enabled = false;
  }

  ColliderIsUser(collider) {
    if (this.lastColliderChecked === collider) {
      return this.lastIsUserAnswer;
    }
    this.lastColliderChecked = collider;
    this.tempItem = collider.gameObject.GetComponent('Item');
    this.lastIsUserAnswer = !!(this.tempItem && this.tempItem.isUser);
    return this.lastIsUserAnswer;
  }

  OnTriggerEnter(collider) {
    if (this.ColliderIsUser(collider)) {
      if (this.tempItem.bodyState !== 5) {   // not in the air
        this.triggerTime = this.Time.time;
      }
    } else {
      this.IgnoreCollision(this.collider, collider);
    }
  }

  OnTriggerStay(collider) {
    if (this.ColliderIsUser(collider) && this.Time.time - this.triggerTime > this.triggerDelay) {
      if (this.Time.time - this.lastClose > 20) {
        this.item = this.tempItem;
        this.ShowInstruction();
      }
    }
  }

  Update() {
    if (!this.instructor || this.instructor.destroyed || this.instructor.ended) {
      this.lastClose = this.Time.time;
      if (this.item) {
        this.item.GetKeys();
      }
      this.enabled = false;
    }
    if (this.instructor && !this.instructor.destroyed && this.instructor.autoDestruct && this.instructor.ended) {
      this.Destroy(this.collider);
      this.enabled = false;
    }
  }

  ShowInstruction() {
    if (this.instructor && !this.instructor.destroyed && !this.enabled) {
      this.item.RejectKeys();
      this.instructor.Show();
      this.enabled = true;
    }
  }
}
