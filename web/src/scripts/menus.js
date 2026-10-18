// Scenes around the levels: id splash, start menu with character and level select, GoalReached score screen, end screen.
import { MonoBehaviour, PlayerPrefs, WaitForSeconds } from './unity.js';
import { LevelAttributes } from './level.js';

const BLACK = [0, 0, 0, 1];
const WHITE = [1, 1, 1, 1];

// the "Respecta" screen: per-fruit score lines plus the Next Level / Try Again buttons (drawn in the scene, hit as OnGUI rects)
export class GoalReachedCamera extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.fTime = 100;
    this.fLives = 200;
    this.fAllBananaBonus = 2500;
    this.bananaValue = 10;
    this.cherryValue = 25;
    this.strawberryValue = 50;
    this.appleValue = 100;
    this.loading = false;
  }

  Start() {
    // the level's LevelAttributes survives the scene load (DontDestroyOnLoad)
    const la = this.world.game.lastLevel || { currentLevel: 1, selectedCharacter: 0, lives: 0, levelScore: 0, estTime: 0, levelEndTime: 0,
      bananaCounter: 0, appleCounter: 0, strawberryCounter: 0, cherryCounter: 0, goalBananas: 0, goalApples: 0, goalStrawberries: 0, goalCherries: 0 };
    this.levelAttr = la;
    this.ClaculateScore();
    PlayerPrefs.SetInt('Level', la.currentLevel + 1);
    PlayerPrefs.DeleteKey(la.currentLevel + 'SpawnPoint');
    PlayerPrefs.SetInt('LoadedLevel', 0);
    this.reachedLevel = 0;
    if (la.currentLevel === PlayerPrefs.GetInt('Final Level', 2)) {
      if (la.selectedCharacter < 4) {
        PlayerPrefs.SetInt('Character Unlocked ' + (la.selectedCharacter + 1), 1);
      }
      PlayerPrefs.DeleteKey('Level');
    } else {
      this.reachedLevel = la.currentLevel;
    }
    if (PlayerPrefs.GetInt('Level Reached ' + la.selectedCharacter, 0) < this.reachedLevel) {
      PlayerPrefs.SetInt('Level Reached ' + la.selectedCharacter, this.reachedLevel);
    }
    const W = this.world.screenWidth, H = this.world.screenHeight;
    this.textWidth = W / 2;
    this.heightUnit = H / 7.5;
    this.offsetY = this.heightUnit + this.heightUnit / 6;
    this.marginX = W / 20;
    this.buttonSize = this.heightUnit;
    this.buttonSizeLong = W / 3;
  }

  ClaculateScore() {
    const la = this.levelAttr;
    this.allBananasBonus = la.bananaCounter === 0 ? this.fAllBananaBonus : 0;
    this.livesBonus = la.lives * this.fLives;
    this.timeBonus = Math.floor(Math.max(0, la.estTime - la.levelEndTime) * this.fTime);
    this.levelScore = la.levelScore + this.allBananasBonus + this.timeBonus + this.livesBonus;
  }

  OnGUI() {
    if (this.loading) {
      return;
    }
    if (this.skin) {
      this.world.gui.skin = this.skin;
    }
    this.ShowScore();
  }

  * NextLevel() {
    this.loading = true;
    yield new WaitForSeconds(1);
    const next = this.levelAttr.currentLevel + 1;
    this.world.game.loadLevel(next < PlayerPrefs.GetInt('Final Level', 15) + 1 ? 'level' + next : 'End');
  }

  * RestartLevel() {
    this.loading = true;
    yield new WaitForSeconds(1);
    this.world.game.loadLevel('level' + this.levelAttr.currentLevel);
  }

  Update() {
    if (this.loading && this.loadingCam) {
      const t = Math.min(1, this.Time.deltaTime * 6), p = this.transform.position, q = this.loadingCam.position;
      this.transform.position = p.map((v, i) => v + (q[i] - v) * t);
    }
  }

  // one score line per fruit: "n / goal = points [+ Bonus]"
  fruitLine(rect, count, goal, value) {
    let bonus = '';
    if (count > 0 && count >= goal) {
      bonus = ' + Bonus ' + value * 10;
      this.score += value * 10;
    }
    this.score += value * count;
    this.world.gui.color = BLACK;
    this.world.gui.Label(rect, count + ' / ' + goal + ' = ' + count * value + bonus);
  }

  ShowScore() {
    const GUI = this.world.gui, la = this.levelAttr;
    this.score = 0;
    const rect = [this.marginX * 3 - 16, this.heightUnit * 2, this.textWidth + 110, this.buttonSize];
    const buttonX = rect[0] + this.buttonSizeLong + this.marginX * 2 + 20;
    if (GUI.Button([buttonX, rect[1] - 10, this.buttonSizeLong, this.buttonSizeLong / 4], '')) {
      this.StartCoroutine(this.NextLevel());
    }
    this.fruitLine(rect, la.bananaCounter, la.goalBananas, this.bananaValue);
    GUI.color = WHITE;
    rect[1] += this.offsetY;
    if (GUI.Button([buttonX, rect[1] - 15, this.buttonSizeLong, this.buttonSizeLong / 4], '')) {
      this.StartCoroutine(this.RestartLevel());
    }
    this.fruitLine(rect, la.appleCounter, la.goalApples, this.appleValue);
    rect[1] += this.offsetY;
    this.fruitLine(rect, la.strawberryCounter, la.goalStrawberries, this.strawberryValue);
    rect[1] += this.offsetY;
    this.fruitLine(rect, la.cherryCounter, la.goalCherries, this.cherryValue);
    rect[1] += this.offsetY;
    GUI.Label(rect, 'Level ' + la.currentLevel + ' Score : ' + this.score);
    GUI.color = WHITE;
  }
}

// ------------------------------------------------------------------ id splash, start menu, end screen

// first scene: sets up PlayerPrefs defaults (and migrates old saves), then opens the start menu or the saved level
export class IdScreen extends MonoBehaviour {
  Awake() {
    const P = PlayerPrefs;
    P.SetInt('Final Level', 15);
    P.SetInt('Number of Characters', 5);
    const level = P.GetInt('Level');
    for (const k of ['Selected Character', 'Level Reached 0', 'Level Reached 1']) {
      if (!P.HasKey(k)) {
        P.SetInt(k, 0);
      }
    }
    for (const k of ['Character Unlocked 0', 'Character Unlocked 1']) {
      if (!P.HasKey(k)) {
        P.SetInt(k, 1);
      }
    }
    if (P.HasKey('Level Reached')) {
      P.SetInt('Selected Character', 1);
      P.SetInt('Level Reached 1', P.GetInt('Level Reached'));
      if (P.GetInt('Level Reached') >= P.GetInt('Final Level', 10)) {
        P.SetInt('Character Unlocked 2', 1);
        P.SetInt('Level Reached 2', 0);
        P.SetInt('Selected Character', 2);
      }
      P.DeleteKey('Level Reached');
    }
    if (!P.HasKey('Conversion A')) {
      for (const c of [0, 4]) {
        if (P.GetInt('Level Reached ' + c, 0) === 9) {
          P.SetInt('Level Reached ' + c, 10);
        }
      }
      for (let c = 2; c <= 5; c++) {
        if (P.HasKey('Character Unlocked ' + c) && P.GetInt('Level Reached ' + (c - 1), 0) < 10) {
          P.SetInt('Level Reached ' + (c - 1), 10);
        }
      }
    }
    P.SetString('Conversion A', '1');
    P.SetString('Vers', '1.6');
    // the original compares an int to "" (never equal), so it always loads level index Level + 1: 1 is the start menu
    this.world.game.loadLevel(level + 1);
  }
}

const Page = { Main: 1, Credits: 3, LevelSelect: 9, CharacterSelecta: 10 };
const CameraPosition = { Start: 0, LevelSelecta: 1, Credits: 2, Loading: 3, CharacterSelecta: 4 };

// the start screen: main buttons, credits, character select and level select are all invisible OnGUI buttons
// over scenery the camera glides between
export class StartMenu extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.levelReached = 0;
    this.pervPage = Page.Main;
    this.prevCamPosition = CameraPosition.Start;
    this.camPos = CameraPosition.Start;
  }

  Start() {
    this.currentPage = Page.Main;
    this.world.timeScale = 1;
    this.width = this.world.screenWidth / 3;
    this.characterSelecta = this.GetComponent('CharacterSelecta');
    this.buttonSize = this.width;
    this.myCamera = this.GetComponent('Camera');
    PlayerPrefs.DeleteKey('Level');
    PlayerPrefs.SetInt('LoadedLevel', 0);
    PlayerPrefs.DeleteKey('Arrow');
    this.world.audio.setMuted(PlayerPrefs.GetInt('Volume', 1) === 0);
  }

  SetupLevelList() {
    this.levelReached = PlayerPrefs.GetInt('Level Reached ' + PlayerPrefs.GetInt('Selected Character', 0), 0);
    const open = Math.min(this.levelReached + 1, PlayerPrefs.GetInt('Final Level', 2));
    this.levelButtonRenderers.forEach((r, i) => {
      if (r && i < PlayerPrefs.GetInt('Final Level', 9)) {
        r.enabled = i < open;
      }
    });
  }

  SetAnim(p) {
    this.camPos = p;
  }

  LateUpdate() {
    const t = Math.min(1, this.Time.deltaTime * 6), tr = this.transform;
    const target = this.camPositions[this.camPos].position, p = tr.position;
    tr.position = p.map((v, i) => v + (target[i] - v) * t);
    const cam = this.myCamera;
    cam.orthographicSize += (this.orthograpihcs[this.camPos] - cam.orthographicSize) * t;
  }

  OnGUI() {
    if (this.skin) {
      this.world.gui.skin = this.skin;
    }
    if (this.currentPage === Page.Main) {
      this.MainPage();
    } else if (this.currentPage === Page.Credits) {
      this.SetAnim(CameraPosition.Credits);
      this.ShowBackButton();
    } else if (this.currentPage === Page.LevelSelect) {
      this.ShowLevelSelect();
    } else if (this.currentPage === Page.CharacterSelecta) {
      this.ShowCharacterSelecta();
    }
  }

  Click() {
    if (this.clickSound) {
      this.world.audio.play(this.clickSound, { volume: 0.3 });
    }
  }

  ShowBackButton() {
    if (this.world.gui.Button([10, 15, 100, 60], '')) {
      this.Click();
      this.SetAnim(this.prevCamPosition);
      this.currentPage = this.pervPage;
    }
  }

  // three columns of five level buttons
  ShowLevelSelect() {
    const GUI = this.world.gui, n = this.width;
    this.pervPage = Page.CharacterSelecta;
    this.prevCamPosition = CameraPosition.CharacterSelecta;
    const open = Math.min(this.levelReached + 1, PlayerPrefs.GetInt('Final Level', 2));
    let selected = -1;
    for (let i = 1; i < 4; i++) {
      let y = n / 6;
      const x = 10 + (i - 1) * 140;
      for (let j = 1; j < 6; j++) {
        const level = j - 1 + (i - 1) * 5;
        if (level < open && GUI.Button([x + i * 10 - 5, y + n / 2.5, n - 10, n / 4], '')) {
          this.Click();
          selected = level;
          this.SetAnim(CameraPosition.Loading);
        }
        y += n / 4 + 1;
      }
    }
    if (selected > -1) {
      this.StartCoroutine(this.LoadSelected(selected));
    }
    this.ShowBackButton();
  }

  * LoadSelected(selected) {
    yield new WaitForSeconds(2);
    this.world.game.loadLevel(selected + 2);
  }

  // main page: the "Eco Punk" link (an App Store ad in the original, dropped), credits, play
  MainPage() {
    const GUI = this.world.gui, b = this.buttonSize, x = this.width * 2 - 20;
    this.pervPage = Page.Main;
    let up = -b / 3;
    if (GUI.Button([x, up + b / 2.5 + 10, b, b / 4], '')) {
      this.Click();
    }
    up += b / 4;
    if (GUI.Button([x, up + b / 2.5 + 18, b, b / 4], '')) {
      this.Click();
      this.currentPage = Page.Credits;
    }
    up += b / 4;
    if (GUI.Button([x, up + b / 2.5 + 28, b, b / 4], '')) {
      this.Click();
      this.SetAnim(CameraPosition.CharacterSelecta);
      this.currentPage = Page.CharacterSelecta;
    }
  }

  // a 2-wide grid of character buttons; picking one swaps the creature running around the menu
  ShowCharacterSelecta() {
    const GUI = this.world.gui, data = this.characterSelecta.characterData;
    this.pervPage = Page.Main;
    this.prevCamPosition = CameraPosition.Start;
    data.forEach((c, i) => {
      const x = 15 + (i % 2) * 65, y = 73 + Math.floor(i / 2) * 65;
      if (!c.locked && !c.selected && GUI.Button([x, y, 60, 60], '')) {
        this.Click();
        const la = LevelAttributes.GetInstance(this.world);
        la.SetUserActor(c.prefab);
        PlayerPrefs.SetInt('Selected Character', i);
        la.ReleaseUserToAir();
        la.deathSpawnDelay = 0;
        la.checkInversion = false;
        this.characterSelecta.DisplaySelector();
      }
    });
    this.ShowBackButton();
    if (GUI.Button([8, 270, 140, 30], '')) {
      this.SetAnim(CameraPosition.LevelSelecta);
      this.currentPage = Page.LevelSelect;
      this.SetupLevelList();
      this.Click();
    }
  }
}

const OFF_SCREEN = [999999, 999999, 999999];

// shows each character's button as selected / selectable / locked by moving the button meshes on or off screen
export class CharacterSelecta extends MonoBehaviour {
  Start() {
    this.DisplaySelector();
  }

  DisplaySelector() {
    const selected = PlayerPrefs.GetInt('Selected Character', 0);
    this.characterData.forEach((c, i) => {
      const unlocked = PlayerPrefs.HasKey('Character Unlocked ' + i);
      c.locked = !unlocked;
      c.selected = unlocked && i === selected;
      if (c.lockedButton) {
        c.lockedButton.position = unlocked ? OFF_SCREEN : c.buttonPosition.position;
      }
      c.activeButton.position = c.selected ? c.buttonPosition.position : OFF_SCREEN;
      c.inactiveButton.position = unlocked && !c.selected ? c.buttonPosition.position : OFF_SCREEN;
      if (c.selected) {
        const lp = c.text.localPosition;
        c.text.localPosition = [lp[0], lp[1], 5];
        c.text.dirty();
      } else {
        const p = c.text.position;
        c.text.position = [p[0], p[1], 50000];
      }
    });
  }
}

export class StartAnimationPlayer extends MonoBehaviour {
  Start() {
    this.animation.PlayQueued('idle0');
    this.StartCoroutine(this.DelayedLoop());
  }

  * DelayedLoop() {
    yield new WaitForSeconds(2);
    this.animation.wrapMode = 2;   // WrapMode.Loop
  }
}

// "the end": any tap goes back to the start menu
export class EndGame extends MonoBehaviour {
  OnGUI() {
    this.world.gui.skin = this.skin;
    if (this.world.gui.Button([0, 0, this.world.screenWidth, this.world.screenHeight], '')) {
      this.world.game.loadLevel('start');
    }
  }
}

// the end screen's title shows once per character still to play; it moves the selection on to the next character
export class EndGameTitleHide extends MonoBehaviour {
  Start() {
    if (PlayerPrefs.GetInt('Selected Character') === this.lastCharacter) {
      this.Destroy(this.gameObject);
    } else {
      PlayerPrefs.SetInt('Selected Character', PlayerPrefs.GetInt('Selected Character') + 1);
    }
  }
}

// editor-only leak report in the original
export class DetectLeaks extends MonoBehaviour {}
