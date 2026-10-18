// Level flow: LevelAttributes (spawning, lives, fruit counters), spawn points, the goal and small scene helpers.
import { MonoBehaviour, PlayerPrefs, Random, vecString, WaitForSeconds } from './unity.js';

export class LevelAttributes extends MonoBehaviour {
  constructor(go) {
    super(go);
    Object.assign(this, {
      fallOutBuffer: 5, colliderThickness: 10, lastSpawn: 100, levelScore: 0, bananaCounter: 0, appleCounter: 0, cherryCounter: 0,
      strawberryCounter: 0, enemyCounter: 0, startingLives: 2, deathSpawnDelay: 1, checkInversion: true, arrow: true, refreshTime: 2,
    });
  }

  Awake() {
    const now = this.Time.time;
    this.deathSpawnDelay = 0;
    this.selectedCharacter = PlayerPrefs.GetInt('Selected Character', 0);
    this.actorPrefab = this.characterPrefabs[this.selectedCharacter] || this.characterPrefabs[0];
    this.loadedLevel = PlayerPrefs.GetInt('LoadedLevel', 0) === 1;
    const p = this.transform.position, s = this.transform.localScale;
    this.bounds = [p[0], p[1], s[0], s[1]];
    const sp = this.world.Find('SpawnPoint');
    if (!this.originalSpawnPoint && sp) {
      this.originalSpawnPoint = sp.GetComponent('SpawnPointBehaviour');
    }
    this.pauseMenu = this.pauseMenu || this.world.FindObjectOfType('PauseMenu');
    this.cameraScrolling = this.cameraScrolling || this.world.FindObjectOfType('CameraScrolling');
    this.goal = this.goal || this.world.FindObjectOfType('GoalBehaviour');
    this.levelStartTime = now;
    this.lastSpawn = now - 2;
    this.currentLevel = this.world.game.levelIndex(this.world.sceneName) - 1;
    this.goalClear = false;
    let text = null;
    if (this.loadedLevel) {
      text = PlayerPrefs.GetString(this.currentLevel + 'SpawnPoint');
    } else {
      PlayerPrefs.SetString(this.currentLevel + 'SpawnPoint', 'SpawnPoint');
    }
    const saved = text ? this.world.Find(text) : null;
    this.spawnPoint = this.loadedLevel && saved ? saved.GetComponent('SpawnPointBehaviour') : this.originalSpawnPoint;
    this.StartCoroutine(this.Spawn());
    this.lives = this.startingLives;
    PlayerPrefs.SetInt('Level', this.currentLevel);
    PlayerPrefs.SetInt('LoadedLevel', 1);
  }

  * Death() {
    this.lives--;
    if (this.lives < 0) {
      return;
    }
    yield new WaitForSeconds(this.deathSpawnDelay);
    this.StartCoroutine(this.Spawn());
  }

  * Spawn() {
    yield new WaitForSeconds(0.1);
    if (this.Time.time - this.lastSpawn > 1 && this.spawnPoint) {
      this.actor = this.spawnPoint.Spawn(this.actorPrefab);
      this.lastSpawn = this.Time.time;
    }
  }

  Register(type, obj) {
    switch (type) {
      case 'banana': this.originalBananaCounter = (this.originalBananaCounter || 0) + 1; break;
      case 'cherry': this.originalCherryCounter = (this.originalCherryCounter || 0) + 1; break;
      case 'strawberry': this.originalStrawberryCounter = (this.originalStrawberryCounter || 0) + 1; break;
      case 'apple': this.originalAppleCounter = (this.originalAppleCounter || 0) + 1; break;
      case 'enemy':
        this.enemyCounter++;
        this.originalEnemyCounter = (this.originalEnemyCounter || 0) + 1;
        this.levelWithEnemies = true;
        break;
      case 'goal':
        this.goal = obj;
        if (obj.condition) {
          this.goalBananas = obj.condition.bananasNeeded;
          this.goalCherries = obj.condition.cherriesNeeded;
          this.goalStrawberries = obj.condition.strawberriesNeeded;
          this.goalApples = obj.condition.applesNeeded;
        }
        break;
      case 'spawn': this.spawnPoint = obj; break;
      case 'user':
        this.actorTransform = obj.myTransform;
        this.userBodyBehaviour = obj;
        break;
      case 'fruitsText':
        this.fruitsText = obj;
        this.StartCoroutine(this.UpdateScore());
        break;
      case 'wakeuper': this.wakeuper = obj.gameObject.collider; break;
    }
  }

  ReachedGoal() {
    if (!this.goalClear) {
      this.levelEndTime = this.Time.time;
      this.goalClear = true;
    }
    this.world.game.goalReached(this);
  }

  AddScore(n) { this.levelScore += n; }

  Update() {
    this.StartCoroutine(this.UpdateScore());
    this.enabled = false;
  }

  // the fruit counter label: "b3/5 c1/2 ..." (letters are glyphs in the counter font)
  * UpdateScore() {
    this.refreshTime = this.Time.time;
    yield new WaitForSeconds(1);
    if (this.Time.time - this.refreshTime <= 0.99) {
      return;
    }
    const cond = this.goal && this.goal.condition;
    if (cond && this.fruitsText) {
      const part = (letter, have, need) => (need <= 0 && have <= 0 ? '' : `${letter}${have}/${need} `);
      this.fruitsText.text = part('b', this.bananaCounter, cond.bananasNeeded) + part('c', this.cherryCounter, cond.cherriesNeeded)
        + part('a', this.appleCounter, cond.applesNeeded) + part('s', this.strawberryCounter, cond.strawberriesNeeded);
      if (this.fruitsText.Refresh) {
        this.fruitsText.Refresh();
      }
      this.enabled = false;
    } else {
      this.enabled = true;
    }
  }

  Collected(type, qnt) {
    switch (type) {
      case 'banana': this.bananaCounter += qnt; this.levelScore += 50; break;
      case 'apple': this.appleCounter += qnt; this.levelScore += 25; break;
      case 'strawberry': this.strawberryCounter += qnt; this.levelScore += 50; break;
      case 'cherry': this.cherryCounter += qnt; this.levelScore += 25; break;
      case 'enemy': this.enemyCounter -= qnt; this.levelScore += 500; break;
      case 'life': this.lives += qnt; break;
    }
    this.StartCoroutine(this.UpdateScore());
  }

  KillLevel() {}
  SetArrow(v) { this.arrow = v; }
  GetArrow() { return this.arrow; }
  SetUserActor(go) { this.actorPrefab = go; }

  ReleaseUserToAir() {
    if (this.userBodyBehaviour) {
      this.userBodyBehaviour.ChangeState(5);    // Air
      this.userBodyBehaviour.ChangeState(15);   // Fall
    }
  }

  GetUserCollider() {
    if (this.userBodyBehaviour) {
      this.actorCollider = this.userBodyBehaviour.myCollider;
    }
    return this.actorCollider;
  }

  GetCharacterType() {
    return this.characterOrder[PlayerPrefs.GetInt('Selected Character')];
  }
}

export class SpawnPointBehaviour extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.on = false;
  }

  Start() {
    this.levelAttr = LevelAttributes.GetInstance(this.world);
    const p = this.transform.position;
    this.spawnPosition = [p[0], p[1] + 20, 0];
    this.condition = this.GetComponent('FruitsCondition');
    if (this.levelAttr.loadedLevel) {
      if (PlayerPrefs.GetInt(this.Serialized(), 0) === 1) {
        this.TurnOn();
      }
    } else {
      PlayerPrefs.SetInt(this.Serialized(), 0);
    }
  }

  Spawn(actor) {
    if (!this.enabled) {
      return null;
    }
    this.TurnOn();
    return this.Instantiate(actor, this.spawnPosition, [0, 0, 0, 1]);
  }

  TurnOff() { this.on = false; }

  Serialized() {
    return this.levelAttr.currentLevel + 'SpawnPoint' + vecString(this.transform.position);
  }

  TurnOn() {
    if (!this.on) {
      if (this.anim) {
        this.anim.Play();
      }
      this.on = true;
    }
  }

  OnTriggerEnter(other) {
    const user = other.gameObject.GetComponent('Item');
    if (!user || !user.isUser) {
      this.IgnoreCollision(other, this.collider);
      return;
    }
    if (this.on || !this.condition || !this.condition.Check()) {
      return;
    }
    const la = this.levelAttr;
    PlayerPrefs.SetString(la.currentLevel + 'SpawnPoint', this.gameObject.name);
    PlayerPrefs.SetInt('LoadedLevel', 1);
    PlayerPrefs.SetInt(this.Serialized(), 1);
    if (la.spawnPoint !== this) {
      la.Register('spawn', this);
      this.on = true;
      if (this.anim) {
        this.anim.Play();
      }
      if (this.sfxClips && this.sfxClips[0]) {
        SoundSystem.Play(this.world, this.sfxClips[0], 1);
      }
    }
  }
}

export class FruitsCondition extends MonoBehaviour {
  Start() {
    this.levelAttr = LevelAttributes.GetInstance(this.world);
  }

  Check() {
    const la = this.levelAttr || LevelAttributes.GetInstance(this.world);
    if (!this.enabled) {
      return true;
    }
    this.enoughBananas = la.bananaCounter >= this.bananasNeeded;
    this.enoughApples = la.appleCounter >= this.applesNeeded;
    this.enoughCherries = la.cherryCounter >= this.cherriesNeeded;
    this.enoughStrawberries = la.strawberryCounter >= this.strawberriesNeeded;
    this.conditionReached = this.enoughBananas && this.enoughApples && this.enoughCherries && this.enoughStrawberries;
    const instr = this.conditionReached ? this.conditionReachedInstruction : this.conditionNotReachedInstruction;
    if (instr && instr.Show) {
      instr.Show();
    }
    return this.conditionReached;
  }

  toString() {
    const texts = [];
    const add = (n, one, many) => {
      if (n === 1) {
        texts.push(one);
      } else if (n > 1) {
        texts.push(`${n} ${many}`);
      }
    };
    add(this.bananasNeeded, '1 banana', 'bananas');
    add(this.applesNeeded, '1 apple', 'apples');
    add(this.cherriesNeeded, '1 cherry', 'cherries');
    add(this.strawberriesNeeded, '1 sweet strawberry', 'strawberries');
    if (!texts.length) {
      return '';
    }
    let s = texts[0];
    for (let i = 1; i < texts.length - 1; i++) {
      s += ' ,' + texts[i];
    }
    if (texts.length > 1) {
      s += ' and ' + texts[texts.length - 1];
    }
    return s;
  }
}

export class GoalBehaviour extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.goalActive = true;
    this.reached = false;
    this.timeOfEnter = -1;
  }

  Start() {
    this.condition = this.GetComponent('FruitsCondition');
    LevelAttributes.GetInstance(this.world).Register('goal', this);
    this.enabled = false;
  }

  DoEnd() {
    LevelAttributes.GetInstance(this.world).ReachedGoal();
    this.reached = true;
  }

  * Reached() {
    if (this.condition && !this.condition.Check()) {
      return;
    }
    this.bodyBehaviour.ReachedGoal();
    if (this.fireworksGenerator) {
      this.fireworksGenerator.Go();
    }
    yield new WaitForSeconds(3);
    if (!this.instructor) {
      const character = this.bodyBehaviour.character;
      this.instructor = this.gameObject.GetComponentsInChildren('Instructor')
        .find((i) => i.instructionType === INSTRUCTION_GOAL && i.FeetsTheCharacter && i.FeetsTheCharacter(character)) || null;
    }
    if (this.instructor && this.instructor.Show) {
      this.enabled = true;
      this.instructor.Show();
    } else {
      this.DoEnd();
    }
  }

  Update() {
    if (this.instructor && this.instructor.ended) {
      this.DoEnd();
      this.enabled = false;
    }
  }

  OnTriggerEnter(other) {
    const item = other.GetComponent('Item');
    if (item && item.isUser) {
      this.timeOfEnter = this.Time.time;
      this.bodyBehaviour = item;
    } else {
      this.IgnoreCollision(other, this.collider);
    }
  }

  OnTriggerStay() {
    if (this.timeOfEnter > 0 && this.Time.time - this.timeOfEnter > 1) {
      this.StartCoroutine(this.Reached());
      this.timeOfEnter = -1;
    }
  }
}
const INSTRUCTION_GOAL = 1;   // InstructionType.Goal

export class FireworksGenerator extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.stopFireworks = true;
  }

  * CreateFireworks() {
    const tl = this.transform.position, s = this.transform.localScale;
    const br = [tl[0] - s[0], tl[1] - s[1]];
    for (;;) {
      yield new WaitForSeconds(Random.Range(this.minDelay, this.maxDelay));
      this.Instantiate(this.fireworksPrefab, [Random.Range(tl[0], br[0]), Random.Range(tl[1], br[1]), 0], [0, 0, 0, 1]);
      SoundSystem.Play(this.world, this.sfx[Random.Range(0, this.sfx.length - 1)], 1);
      if (this.stopFireworks) {
        return;
      }
    }
  }

  Go() {
    this.stopFireworks = false;
    this.StartCoroutine(this.CreateFireworks());
  }

  Stop() { this.stopFireworks = true; }
}

export class WakeuperBehaviour extends MonoBehaviour {
  Start() {
    LevelAttributes.GetInstance(this.world).Register('wakeuper', this);
  }
}

// ponytail: the original's Release() is empty, so the pool only collects references
export class ReleasePool extends MonoBehaviour {
  static GetInstance(world) {
    return super.GetInstance.call(ReleasePool, world) || { Add() {} };
  }
  Add() {}
}

export class ReleaseMe extends MonoBehaviour {
  Start() {
    this.Destroy(this);
  }
}

export class SkinManager extends MonoBehaviour {
  Start() {
    this.Destroy(this.gameObject);
  }
}

// the level-1 tutorial arrows: shown from t1 to t2 seconds, only for the first two characters
export class HideMe extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.t1 = 0.1;
    this.t2 = 15;
  }

  Start() {
    if (PlayerPrefs.GetInt('Selected Character', 1) > 1) {
      this.Destroy(this.gameObject);
      return;
    }
    this.renderer.enabled = false;
    this.enabled = true;
  }

  Update() {
    const t = this.Time.time;
    if (t < this.t2) {
      if (t > this.t1) {
        this.renderer.enabled = true;
      }
    } else {
      this.renderer.enabled = false;
      this.enabled = false;
    }
  }
}

// two audio channels on the main camera; channel 0 can loop (music-like clips) and be stopped
export class SoundSystem extends MonoBehaviour {
  static instance(world) {
    return world.FindObjectOfType('SoundSystem');
  }

  static Play(world, clip, volume, loop = false, channel = 0) {
    const s = SoundSystem.instance(world);
    if (s) {
      s.PlayClip(clip, volume, loop, channel);
    }
  }

  static Stop(world) {
    const s = SoundSystem.instance(world);
    if (s) {
      s.StopClip();
    }
  }

  static IsPlaying(world, clip) {
    const s = SoundSystem.instance(world);
    return !!s && s.looping && s.looping.clip === clip && s.looping.voice.playing;
  }

  PlayClip(clip, volume, loop, channel) {
    const audio = this.world.audio;
    if (!clip || audio.muted) {
      return;
    }
    if (!loop) {
      audio.play(clip, { volume });
      return;
    }
    if (channel === 0) {
      this.StopClip();
      this.looping = { clip, voice: audio.play(clip, { volume, loop: true }) };
    } else {
      audio.play(clip, { volume, loop: true });
    }
  }

  StopClip() {
    if (this.looping && this.looping.voice) {
      this.looping.voice.stop();
    }
    this.looping = null;
  }

  OnDestroy() {
    this.StopClip();
  }
}
