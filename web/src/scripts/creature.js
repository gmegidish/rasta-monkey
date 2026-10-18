// The player creature: a body ball with four hands that roll it along branches (BodyBehaviour / HandBehaviour),
// its per-character tuning (CreatureConfiguration) and the touch controls that drive it.
import { MonoBehaviour, Random, WaitForSeconds, WaitForFixedUpdate } from './unity.js';
import { HingeJoint, ConfigurableJoint } from '../engine/physics.js';
import { Collider } from '../engine/physics.js';
import { v3, quat } from '../engine/math.js';
import { Item } from './items.js';
import { LevelAttributes, SoundSystem } from './level.js';

export const BodyState = {
  None: 0, Still: 1, Hanging: 2, Jumping: 3, Turning: 4, Air: 5, Paralyzed: 6, Unparalyze: 7, AboutToJump: 8,
  Rest: 9, Swinging: 10, Sliding: 11, InversionCheck: 12, Climbing: 13, AboutToReleaseSwing: 14, Fall: 15,
};
const BodySubState = { None: 0, TurningNoJump: 1, TurningJump: 2, AirNoJump: 3, AirJump: 4 };
export const HandState = { None: 0, Air: 1, Catching: 2, Hang: 3, HoldingAnItem: 4, AboutToReleaseItem: 5, ReleaseItem: 6, Paralyzed: 7 };
const ImpactType = { None: 0, Clash: 1, Fall: 2 };
const DRIVE_VELOCITY = 2;
const CharacterSFX = { Goal: 26 };

// ------------------------------------------------------------------ CreatureConfiguration
const USER_COMMON = {
  logicType: 'user', controlLogicType: 'ControlLogicUser', outerRing: false, outerRingSpring: 0.01, outerRingDamper: 1,
  selectiveHold: true, confJointLinearLimit: 3, confJointLinearSpring: 0, startRotatingBeforeJumpDelay: 0.2,
  rigidbodyDamper: 1, rigidbodyDrag: 0.2, rigidbodyAngularDrag: 0.1, handMass: 0.2, airSpringJointForce: 90,
  hangSpringJointForce: 90, stillSpringJointForce: 30, hangTimeThreshold: 0.1, airTimeThreshold: 0.2, withCaps: false,
};
const CREATURES = {
  monkey: { ...USER_COMMON, rotationForce: 100, rotationVelocity: 15, rotationVelocityMin: 10, rotationVelocityMax: 10, rotationVelocityDuration: 1.5, jumpRotationForce: 90, bodyMass: 0.5, bodyDrag: 0.2, jumpMultiplier: 4, inversionForce: 150 },
  superEasy: { ...USER_COMMON, rotationForce: 90, rotationVelocity: 8, rotationVelocityMin: 5, rotationVelocityMax: 5, rotationVelocityDuration: 1.5, jumpRotationForce: 120, bodyMass: 0.8, bodyDrag: 0.2, ropeJumpMultiplier: 1.3, springBranchMultiplier: 0.8, jumpMultiplier: 8.5, staticJumpMuliplier: 1.05, timeSwitchMultiplier: 3, fallingTreesAnimationSpeedFactor: 0.7, inversionForce: 150 },
  easyMonkey: { ...USER_COMMON, rotationForce: 90, rotationVelocity: 8, rotationVelocityMin: 8, rotationVelocityMax: 8, rotationVelocityDuration: 1.5, jumpRotationForce: 90, bodyMass: 0.5, bodyDrag: 0.2, jumpMultiplier: 4.5, acceleratorMultiplier: 1.2 },
  JahMon: { ...USER_COMMON, inversionForce: 150, gearFactor: 1.4, staticJumpMuliplier: 1.4, springBranchMultiplier: 2, rotationForce: 90, rotationVelocity: 15, rotationVelocityMin: 15, rotationVelocityMax: 15, rotationVelocityDuration: 1, jumpRotationForce: 90, bodyMass: 0.5, bodyDrag: 0.2, jumpMultiplier: 4 },
  RudeBowy: { ...USER_COMMON, inversionForce: 50, gearFactor: 1.3, springBranchMultiplier: 2, rotationForce: 90, rotationVelocity: 15, rotationVelocityMin: 10, rotationVelocityMax: 10, rotationVelocityDuration: 1, jumpRotationForce: 90, bodyMass: 0.2, bodyDrag: 0.05, jumpMultiplier: 28, staticJumpMuliplier: 4, bouncerMultiplier: 2.5, acceleratorMultiplier: 1.5, inversionTimeMultiplier: 2 },
  DreadMa: { ...USER_COMMON, inversionForce: 150, gearFactor: 1.2, bouncerMultiplier: 0.95, springBranchMultiplier: 1.2, rotationForce: 90, rotationVelocity: 9, rotationVelocityMin: 9, rotationVelocityMax: 9, rotationVelocityDuration: 1, jumpRotationForce: 90, bodyMass: 0.6, bodyDrag: 0.1, jumpMultiplier: 4.5, staticJumpMuliplier: 1.1, acceleratorMultiplier: 1.2, timeSwitchMultiplier: 1 },
  'devil user': { ...USER_COMMON, rotationForce: 1000, rotationVelocity: 80, rotationVelocityMin: 20, rotationVelocityMax: 20, rotationVelocityDuration: 1.5, jumpRotationForce: 1000, bodyMass: 2, bodyDrag: 0.2, jumpMultiplier: 4.5, handMass: 0.4, clashable: false },
  'ameba user': { ...USER_COMMON, rotationForce: 150, rotationVelocity: 15, rotationVelocityMin: 10, rotationVelocityMax: 10, rotationVelocityDuration: 1, jumpRotationForce: 150, bodyMass: 0.5, bodyDrag: 0.2, jumpMultiplier: 7 },
};
const ENEMY_COMMON = {
  outerRing: false, outerRingSpring: 10, outerRingDamper: 0, selectiveHold: false, jumpRotationForce: 70, bodyDrag: 0.1,
  confJointLinearLimit: 5.5, confJointLinearSpring: 80, bezierDesiredDistance: 5.5, rigidbodyDrag: 0, rigidbodyAngularDrag: 0.01,
  airSpringJointForce: 30, hangSpringJointForce: 100, hangTimeThreshold: 0.1, airTimeThreshold: 0.3, bezierSections: 2, withCaps: false,
};
const typeB = { ...ENEMY_COMMON, logicType: 'typeB', controlLogicType: 'ControlLogicTypeB' };
const typeDown = { ...ENEMY_COMMON, logicType: 'typeDown', controlLogicType: 'ControlLogicTypeDown' };
Object.assign(CREATURES, {
  amebaSmall: { ...typeB, rotationForce: 50, rotationVelocity: 7, bodyMass: 2, rigidbodyDamper: 1, handMass: 0.2, clashable: true },
  ameba: { ...typeB, rotationForce: 70, rotationVelocity: 20, bodyMass: 0.2, rigidbodyDamper: 1, handMass: 0.2, clashable: false },
  amebaV: { ...ENEMY_COMMON, logicType: 'typeV', controlLogicType: 'ControlLogicTypeVA', rotationForce: 70, rotationVelocity: 50, bodyMass: 0.2, rigidbodyDamper: 1, handMass: 0.2, impactType: ImpactType.Fall, clashable: false },
  amebaV2: { ...ENEMY_COMMON, logicType: 'typeV', controlLogicType: 'ControlLogicTypeV', rotationForce: 40, rotationVelocity: 20, bodyMass: 0.2, rigidbodyDamper: 1, handMass: 0.2, impactType: ImpactType.Fall },
  'ameba clashable': { ...typeB, rotationForce: 190, rotationVelocity: 20, bodyMass: 3, rigidbodyDamper: 1, handMass: 0.4, clashable: true },
  purpleDown: { ...typeDown, rotationForce: 250, rotationVelocity: 20, bodyMass: 4, rigidbodyDamper: 0, handMass: 0.4, clashable: false, impactType: ImpactType.Fall, inversionTimeMultiplier: 4 },
  purple: { ...typeB, rotationForce: 250, rotationVelocity: 20, bodyMass: 4, rigidbodyDamper: 0, handMass: 0.4, clashable: false },
  devil: { ...typeB, rotationForce: 1000, rotationVelocity: 10, bodyMass: 2, rigidbodyDamper: 0, handMass: 0.4, clashable: false },
  pokemon: { ...typeB, rotationForce: 1000, rotationVelocity: 5, bodyMass: 2, rigidbodyDamper: 0, handMass: 0.4, clashable: false },
  cop: { ...typeB, rotationForce: 1000, rotationVelocity: 9, bodyMass: 2, inversionTimeMultiplier: 4, rigidbodyDamper: 0, handMass: 0.4, clashable: false },
  mummy: { ...typeB, rotationForce: 1000, rotationVelocity: 3, bodyMass: 2, inversionTimeMultiplier: 4, rigidbodyDamper: 0, handMass: 0.4, clashable: false },
  punk: { ...typeB, rotationForce: 1000, rotationVelocity: 8, bodyMass: 2, inversionTimeMultiplier: 4, rigidbodyDamper: 0, handMass: 0.4, clashable: false },
  probe: { ...typeDown, rotationForce: 250, rotationVelocity: 20, bodyMass: 4, inversionTimeMultiplier: 5, rigidbodyDamper: 0, handMass: 0.4, clashable: false, impactType: ImpactType.Fall },
  probeSlow: { ...typeDown, rotationForce: 250, rotationVelocity: 20, bodyMass: 4, rigidbodyDamper: 0, handMass: 0.4, clashable: false, impactType: ImpactType.Fall },
});

export class CreatureConfiguration extends MonoBehaviour {
  constructor(go) {
    super(go);
    Object.assign(this, {
      jumpMultiplier: 2, staticJumpMuliplier: 1, bouncerMultiplier: 1, acceleratorMultiplier: 1, stillSpringJointForce: 30,
      startRotatingBeforeJumpDelay: 0.2, inversionTimeMultiplier: 1, timeSwitchMultiplier: 1, outerRing: false, outerRingSpring: 50,
      outerRingDamper: 1, ropeJumpMultiplier: 1.1, logicType: 'user', impactType: ImpactType.Clash, clashable: true,
      springBranchMultiplier: 1, fallingTreesAnimationSpeedFactor: 1, gearFactor: 1, inversionForce: 500, controlLogicType: null,
    });
  }

  Setup() {
    Object.assign(this, CREATURES[this.creature] || {});
  }
}

// ------------------------------------------------------------------ control
export class TouchControl extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.touch = [0, 0, 0];
    this.fingersDown = 0;
    this.lastRefreshFrame = -1;
  }

  Refresh() {
    if (this.lastRefreshFrame === this.world.frameCount) {
      return;
    }
    this.lastRefreshFrame = this.world.frameCount;
    const input = this.world.input;
    this.fingersDown = input.touchCount;
    if (this.fingersDown > 3) {
      this.fingersDown = 0;
    }
    if (this.fingersDown >= 1) {
      const p = input.GetTouch(0).position;
      this.touch = [p[0], p[1], 0];
    }
  }
}

export class ControlLogic extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.inputH = 0;
    this.inputV = 0;
    this.rightButton = false;
    this.leftButton = false;
    this.mode = 'setup';
    this.getKeys = false;
  }
  SetupBody(body) {
    this.bodyBehaviour = body;
    this.type = body.creatureConfig.logicType;
    this.levelAttr = LevelAttributes.GetInstance(this.world);
  }
  CancelLeft() { this.leftButton = false; }
  WakeUp() { this.mode = 'wakeup'; this.enabled = true; }
  Sleep() { this.mode = 'sleep'; this.enabled = false; }
  GetKeys() { this.getKeys = true; }
  RejectKeys() {
    this.getKeys = false;
    this.leftButton = false;
    this.rightButton = false;
  }
  Setup() {}
  Die() {}
}

// enemies: sleep until a Sleeper wakes them, then patrol; every 7th frame they re-plan, then drive their body
export class ControlLogicEnemy extends ControlLogic {
  constructor(go) {
    super(go);
    this.currentLoop = 0;
    this.activeLoop = 6;
  }

  SetupEnemy(body) {
    this.SetupBody(body);
    body.isEnemy = true;
    this.levelAttr.Register('enemy', this);
  }

  Setup(body) { this.SetupEnemy(body); }
  Die() { this.levelAttr.Collected('enemy', 1); }

  // the shared setup / wakeup / sleep states; patrol() is the per-type behaviour
  Update() {
    if (this.currentLoop === 0) {
      if (this.mode === 'setup') {
        this.mode = 'sleep';
      } else if (this.mode === 'wakeup') {
        [this.inputH, this.inputV] = this.wakeInput;
        this.mode = 'patrolling';
      } else if (this.mode === 'sleep') {
        this.inputH = 0;
        this.inputV = -1;
        this.mode = 'resting';
        this.enabled = false;
      } else if (this.mode === 'patrolling') {
        this.patrol();
      }
    }
    if (this.currentLoop++ === this.activeLoop) {
      this.currentLoop = 0;
    }
    if (this.bodyBehaviour.enabled) {
      this.bodyBehaviour.DoUpdate();
    }
  }

  userPosition() {
    const t = this.levelAttr.actorTransform;
    if (t) {
      this.lastUserPosition = t.position;
    }
    return this.lastUserPosition || [0, 0, 0];
  }

  // the user is around and not mid-turn
  userIsSteady() {
    const u = this.levelAttr.userBodyBehaviour;
    return u && u.bodyState !== BodyState.Turning;
  }
}

// chases the user along branches
export class ControlLogicTypeB extends ControlLogicEnemy {
  get wakeInput() { return [1, 1]; }

  patrol() {
    const user = this.userPosition(), body = this.bodyBehaviour;
    if (body.reachedTheEnd) {
      this.inputH *= -1;
      this.inputV = Random.Range(-1, 2);
    } else if (body.platform) {
      this.inputV = this.userIsSteady() && user[1] > body.platform.rightPoint[1] ? 1 : -1;
      this.inputH = user[0] > body.myTransform.position[0] ? -1 : 1;
    }
  }
}

// chases the user up and down poles
export class ControlLogicTypeV extends ControlLogicEnemy {
  get wakeInput() { return [1, 1]; }

  patrol() {
    const user = this.userPosition(), body = this.bodyBehaviour;
    if (body.reachedTheEnd) {
      this.inputV *= -1;
      this.inputH = Random.Range(-1, 2);
    } else if (body.platform) {
      this.inputH = this.userIsSteady() && user[0] < body.platform.rightPoint[0] ? 1 : -1;
      this.inputV = user[1] < body.myTransform.position[1] ? -1 : 1;
    }
  }
}

// bounces back and forth
export class ControlLogicTypeVA extends ControlLogicEnemy {
  get wakeInput() { return [1, 1]; }

  patrol() {
    if (this.bodyBehaviour.reachedTheEnd) {
      this.inputV *= -1;
      this.inputH *= -1;
    }
  }
}

// walks along, turning round at the end or when it has not moved for a second
export class ControlLogicTypeDown extends ControlLogicEnemy {
  get wakeInput() { return [1, -1]; }

  patrol() {
    if (!this.looping) {
      this.StartCoroutine(this.CheckIfStuck());
    }
    if (this.bodyBehaviour.reachedTheEnd) {
      this.inputV = -1;
      this.inputH *= -1;
    }
  }

  * CheckIfStuck() {
    this.looping = true;
    while (this.enabled) {
      const p = this.bodyBehaviour.myTransform.position;
      if (this.lastPosition && v3.dist(p, this.lastPosition) < 1) {
        this.inputH *= -1;
        this.inputV = -1;
      }
      this.lastPosition = p;
      yield new WaitForSeconds(1);
    }
    this.looping = false;
  }
}

export class ControlLogicUser extends ControlLogic {
  Setup(body) {
    this.SetupBody(body);
    body.isUser = true;
    this.getKeys = true;
    this.levelAttr.Register('user', body);
    this.touchControl = TouchControl.GetInstance(this.world);
    this.inputV = 0.1;
    body.StartCoroutine(body.SetInterpolation(1));
  }

  FixedUpdate() {
    if (this.getKeys) {
      const tc = this.touchControl;
      if (tc) {
        tc.Refresh();
        if (tc.fingersDown >= 1) {
          const W = this.world.screenWidth, H = this.world.screenHeight;
          const x = Math.max(Math.min(tc.touch[0], W), 0);
          const y = Math.max(Math.min(tc.touch[1], H), 0);
          this.inputH = (x / W - 0.5) * 2;
          this.inputV = (y / H - 0.5) * 2;
          this.rightButton = true;
          this.leftButton = tc.fingersDown >= 2;
        } else {
          this.inputH = 0;
          this.rightButton = false;
          this.leftButton = false;
        }
      } else {
        this.rightButton = true;
        this.inputV = -1;
      }
    }
    if (this.bodyBehaviour.enabled) {
      this.bodyBehaviour.DoUpdate();
    }
  }

  Die() {
    this.levelAttr.StartCoroutine(this.levelAttr.Death());
  }
}

// ------------------------------------------------------------------ body
export class BodyBehaviour extends Item {
  constructor(go) {
    super(go);
    Object.assign(this, {
      holdingAnItem: false, jumpTime: 0, hangingTime: 0, bodyAir: 0, bouncerMultiplier: 1, acceleratorMultiplier: 1,
      timeSwitchMultiplier: 1, formerH: 0, formerV: 0, collisionTime: 0, inverted: 1, checkedinversion: false,
      springBranchMultiplier: 1, inversionTimeMultiplier: 1, ropeJumpMultiplier: 1, fallingTreesAnimationSpeedFactor: 1,
      gearFactor: 1, inversionForce: 500, reachedGoal: false, bodyState: BodyState.None, bodySubState: BodySubState.None,
      platform: null, controlLogic: null, lastVelocity: [0, 0, 0], numHangingHands: 0, changedDir: false,
    });
  }

  CacheConfig() {
    const c = this.creatureConfig;
    if (!c) {
      return;
    }
    for (const k of ['rotationForce', 'rotationVelocity', 'rotationVelocityMin', 'rotationVelocityMax', 'rotationVelocityDuration',
      'jumpRotationForce', 'bodyMass', 'bodyDrag', 'outerRing', 'jumpMultiplier', 'airTimeThreshold', 'startRotatingBeforeJumpDelay',
      'impactType', 'clashable', 'springBranchMultiplier', 'staticJumpMuliplier', 'bouncerMultiplier', 'acceleratorMultiplier',
      'inversionTimeMultiplier', 'timeSwitchMultiplier', 'ropeJumpMultiplier', 'fallingTreesAnimationSpeedFactor', 'gearFactor', 'inversionForce']) {
      this[k] = c[k];
    }
    // the original destroys the configuration here; HandBehaviour.CacheConfig still reads it right after (same frame)
    this.Destroy(c);
  }

  GetBouncerMultiplier() { return this.bouncerMultiplier; }
  GetAcceleratorMultiplier() { return this.acceleratorMultiplier; }
  GetVelocity() { return this.myRigidbody.velocity; }

  Start() {
    this.levelAttr = LevelAttributes.GetInstance(this.world);
    this.myTransform = this.transform;
    this.myRigidbody = this.rigidbody;
    this.creatureConfig = this.GetComponent('CreatureConfiguration');
    if (this.creatureConfig) {
      this.creatureConfig.Setup();
    }
    const config = this.creatureConfig;
    this.CacheConfig();
    this.hangingHands = [];
    if (this.levelAttr.cameraScrolling) {
      this.levelAttr.cameraScrolling.SetTarget(this.myTransform);
    }
    if (this.bodyMass > 0) {
      this.myRigidbody.mass = this.bodyMass;
    }
    this.myRigidbody.drag = this.bodyDrag;
    this.reachedTheEnd = false;
    this.hitable = true;
    this.releaser = true;
    if (config && config.controlLogicType) {
      this.controlLogic = this.gameObject.AddComponent(config.controlLogicType);
      this.controlLogic.Setup(this);
      this.controlLogic.WakeUp();
    }
    this.sfxLib = this.GetComponent('CharacterSFXLib');
    const cj = this.gameObject.AddComponent(ConfigurableJoint);
    this.configurableJoint = cj;
    cj.xMotion = 2;
    cj.yMotion = 2;
    cj.angularYZDrive.mode = DRIVE_VELOCITY;
    this.handBehaviourArray = this.handsArray.map((h) => h.GetComponent('HandBehaviour'));
    for (const hb of this.handBehaviourArray) {
      hb.papa = this.gameObject;
      hb.Setup(config);
    }
    this.collider.isTrigger = false;
    this.myCollider = this.collider;
    this.ChangeState(BodyState.InversionCheck);
  }

  CheckInversion() {
    this.inverted = (this.myRigidbody.angularVelocity[2] > 0) !== (this.configurableJoint.targetAngularVelocity[2] > 0) ? -1 : 1;
    this.checkedinversion = true;
  }

  setDrive(maxForce, target) {
    const cj = this.configurableJoint;
    if (maxForce !== null) {
      cj.angularYZDrive.maximumForce = maxForce;
    }
    if (target !== undefined) {
      cj.targetAngularVelocity = [0, 0, target];
    }
  }

  ChangeState(toState) {
    this.enabled = true;
    if (toState === this.bodyState) {
      return;
    }
    const cj = this.configurableJoint;
    this.bodySubState = BodySubState.None;
    switch (toState) {
      case BodyState.Still:
        this.doTriggers = true;
        break;
      case BodyState.InversionCheck:
        this.hangingTime = this.Time.time;
        this.setDrive(this.inversionForce, 50);
        break;
      case BodyState.Hanging:
        this.doTriggers = true;
        if (this.bodyState !== BodyState.Still) {
          this.hangingTime = this.Time.time;
          this.reachedTheEnd = false;
        } else {
          this.UnlockHangingHands();
        }
        break;
      case BodyState.Climbing:
        this.doTriggers = true;
        this.UnlockHangingHands();
        break;
      case BodyState.Sliding:
      case BodyState.Swinging:
        this.doTriggers = true;
        this.hangingTime = this.Time.time;
        this.reachedTheEnd = false;
        break;
      case BodyState.Jumping:
        this.doTriggers = true;
        this.jumpTime = 0;
        this.reachedTheEnd = false;
        break;
      case BodyState.Turning:
        this.doTriggers = false;
        this.jumpTime = this.Time.time;
        this.numHangingHands = 1;
        this.ReleaseExtraHands(this.controlLogic.inputH);
        this.reachedTheEnd = false;
        this.setDrive(0, 0);
        this.bodySubState = BodySubState.TurningJump;
        break;
      case BodyState.Air:
        this.doTriggers = true;
        this.bodyAir = this.Time.time;
        this.FreeOthers(null);
        this.reachedTheEnd = false;
        this.ClearPlatform();
        this.bodySubState = BodySubState.AirNoJump;
        this.setDrive(0.1);
        break;
      case BodyState.Paralyzed:
        this.doTriggers = true;
        this.ChangeState(BodyState.Air);
        this.ParalyzeAll();
        this.reachedTheEnd = false;
        this.ClearPlatform();
        break;
      case BodyState.Unparalyze:
        this.doTriggers = true;
        this.UnparalyzeAll();
        this.ChangeState(BodyState.Air);
        this.reachedTheEnd = false;
        return;
      case BodyState.AboutToJump:
        this.doTriggers = false;
        this.aboutToJumpTime = this.Time.time;
        break;
      case BodyState.AboutToReleaseSwing:
        this.aboutToJumpTime = this.Time.time;
        break;
      case BodyState.Rest:
        this.doTriggers = true;
        this.setDrive(0);
        return;
      case BodyState.Fall:
        this.doTriggers = false;
        return;
    }
    cj.angularYZDrive.mode = DRIVE_VELOCITY;
    this.bodyState = toState;
  }

  DoUpdate() {
    const cl = this.controlLogic;
    const now = this.Time.time;
    this.lastVelocity = this.myRigidbody.velocity;
    this.Lock2d(0);
    this.absInputV = cl.inputV < 0 ? -1 : 1;
    this.absInputH = cl.inputH < 0 ? -1 : 1;
    this.still = Math.abs(cl.inputH) < 0.2;
    this.newDir = this.absInputH;
    const cj = this.configurableJoint;
    const platform = this.platform;
    switch (this.bodyState) {
      case BodyState.InversionCheck:
        if (!this.levelAttr.checkInversion || now - this.hangingTime > 0.3 * this.inversionTimeMultiplier) {
          this.CheckInversion();
          cj.xMotion = 2;
          cj.yMotion = 2;
          this.ChangeState(BodyState.Air);
        } else {
          cj.xMotion = 0;
          cj.yMotion = 0;
        }
        break;
      case BodyState.Still:
        this.updateStill();
        break;
      case BodyState.Hanging:
        if (!platform) {
          this.ChangeState(BodyState.Air);
          break;
        }
        if (platform.constantV !== 0) {
          this.absInputV = platform.constantV;
        }
        if (this.formerH !== this.newDir || this.absInputV !== this.formerV) {
          this.formerH = this.newDir;
          this.formerV = this.absInputV;
          this.reachedTheEnd = false;
        }
        this.xPos = this.myTransform.position[0];
        if ((!(this.xPos < platform.rightPoint[0]) && this.formerH < 0) || (!(this.xPos > platform.leftPoint[0]) && this.formerH > 0)) {
          this.reachedTheEnd = true;
        }
        if (this.still || this.reachedTheEnd) {
          this.ChangeState(BodyState.Still);
          break;
        }
        this.numHangingHands = 1;
        this.ReleaseExtraHands(cl.inputH);
        this.setDrive(this.rotationForce * Math.abs(cl.inputH), this.absInputH * this.rotationVelocity * this.absInputV * this.inverted);
        if (cl.leftButton) {
          this.ChangeState(BodyState.Turning);
        }
        break;
      case BodyState.Climbing:
        if (!platform) {
          this.ChangeState(BodyState.Air);
          break;
        }
        if (this.absInputV !== this.formerV) {
          this.formerV = this.absInputV;
          this.reachedTheEnd = false;
        }
        this.yPos = this.myTransform.position[1];
        if ((this.yPos < platform.rightPoint[1] && this.formerV < 0) || (this.yPos > platform.leftPoint[1] && this.formerV > 0)) {
          this.reachedTheEnd = true;
        }
        if (!this.checkedinversion) {
          this.ChangeState(BodyState.InversionCheck);
          break;
        }
        this.numHangingHands = 1;
        this.ReleaseExtraHands(cl.inputV);
        this.setDrive(this.rotationForce * Math.abs(cl.inputV), this.absInputH * -1 * this.rotationVelocity * this.absInputV * this.inverted);
        if (cl.leftButton) {
          this.ChangeState(BodyState.Turning);
        }
        break;
      case BodyState.Swinging:
        if (!platform) {
          this.ChangeState(BodyState.Air);
          break;
        }
        this.myRigidbody.AddForce([cl.inputH * -1 * 60, 0, 0]);
        if (this.absInputV !== this.formerV) {
          this.formerV = this.absInputV;
          this.reachedTheEnd = false;
        }
        this.yPos = this.myTransform.position[1];
        if ((this.yPos > platform.rightPoint[1] && this.formerV < 0) || (this.yPos < platform.leftPoint[1] && this.formerV > 0)) {
          this.reachedTheEnd = true;
        }
        if (!this.reachedTheEnd) {
          this.setDrive(this.rotationForce * Math.abs(cl.inputV), (cl.inputH * -1) * cl.inputV * this.rotationVelocity * this.absInputV * this.inverted);
        } else {
          this.setDrive(0, 0);
        }
        this.numHangingHands = 1;
        this.ReleaseExtraHands(cl.inputV);
        if (cl.leftButton) {
          this.ChangeState(BodyState.AboutToReleaseSwing);
        }
        break;
      case BodyState.AboutToReleaseSwing:
        if (now - this.aboutToJumpTime < 0.08) {
          if (!cl.leftButton) {
            this.ChangeState(BodyState.Swinging);
          }
        } else {
          this.myRigidbody.velocity = v3.scale(this.myRigidbody.velocity, this.ropeJumpMultiplier);
          this.ChangeState(BodyState.Air);
        }
        break;
      case BodyState.Turning:
        if (this.updateTurning()) {
          return;
        }
        break;
      case BodyState.Air: {
        const v = this.myRigidbody.velocity;
        this.myRigidbody.velocity = [v[0], v[1], 0];
        break;
      }
      case BodyState.Paralyzed:
        this.paralyzeCounter -= this.world.deltaTime;
        if (!(this.paralyzeCounter > 0)) {
          this.ChangeState(BodyState.Unparalyze);
        }
        break;
      case BodyState.AboutToJump:
        this.updateAboutToJump();
        break;
    }
    for (const hb of this.handBehaviourArray) {
      if (hb.enabled) {
        hb.DoUpdate();
      }
    }
    if (this.arrow && this.levelAttr.GetArrow()) {
      this.arrow.DoUpdate();
    }
  }

  updateStill() {
    const cl = this.controlLogic;
    const platform = this.platform;
    if (platform.constantV !== 0) {
      this.absInputV = platform.constantV;
    }
    if (!this.checkedinversion) {
      this.ChangeState(BodyState.InversionCheck);
      return;
    }
    this.changedDirection = false;
    if (this.formerH !== this.newDir || this.absInputV !== this.formerV || cl.inputH === 0) {
      this.formerH = this.newDir;
      this.formerV = this.absInputV;
      this.changedDirection = true;
      this.reachedTheEnd = false;
    }
    if (!this.still && (this.changedDirection || !this.reachedTheEnd)) {
      this.ChangeState(BodyState.Hanging);
    }
    if (this.absInputV > 0) {
      const first = this.hangingHands[0];
      this.numHangingHands = first && this.myTransform.position[1] - 0.5 > first.myTransform.position[1] ? 2 : 1;
      if (this.hangingHands.length < 2) {
        this.setDrive(this.rotationForce, this.newDir * this.rotationVelocity * this.absInputV * this.inverted * 0.7);
      } else {
        this.setDrive(0.1, 0);
        this.LockHangingHands();
      }
    } else {
      this.setDrive(0.1, 0);
      this.numHangingHands = 1;
    }
    this.ReleaseExtraHands(cl.inputH);
    if (cl.leftButton) {
      this.ChangeState(BodyState.Turning);
    }
  }

  // returns true when the state changed and the rest of DoUpdate must be skipped
  updateTurning() {
    const cl = this.controlLogic;
    const now = this.Time.time;
    this.lastVelocity = v3.scale(this.lastVelocity, Math.min((now - this.jumpTime) * 5, 3));
    if (this.bodySubState === BodySubState.TurningJump) {
      if (!cl.leftButton) {
        this.ChangeState(BodyState.AboutToJump);
        return true;
      }
      this.reachedTheEnd = false;
    } else if (this.bodySubState === BodySubState.TurningNoJump) {
      if (!cl.rightButton || !cl.leftButton) {
        this.ChangeState(BodyState.Hanging);
        cl.CancelLeft();
      }
    }
    if (now - this.jumpTime > this.startRotatingBeforeJumpDelay) {
      cl.inputH = cl.inputH < 0 ? -1 : 1;
      this.changedDir = false;
      if (this.formerH !== this.newDir || this.absInputV !== this.formerV) {
        this.formerH = this.newDir;
        this.formerV = this.absInputV;
        this.changedDir = true;
        this.jumpTime = now;
      }
      const vel = this.rotationVelocityMin + (this.rotationVelocityMax - this.rotationVelocityMin) * 1;
      this.setDrive(this.jumpRotationForce, cl.inputH * vel * this.absInputV * this.inverted);
    }
    return false;
  }

  updateAboutToJump() {
    const cl = this.controlLogic;
    const now = this.Time.time;
    if (now - this.aboutToJumpTime >= 0.2) {
      this.ChangeState(BodyState.Hanging);
      return;
    }
    if (cl.rightButton) {
      return;
    }
    const k = Math.min((now - this.jumpTime) * 0.75, 1);
    const platform = this.platform;
    if (platform && !platform.isGear) {
      const v = this.myRigidbody.velocity;
      if (!platform.kinematic || platform.animated) {
        this.myRigidbody.velocity = v3.scale(v, Math.max(1, this.jumpMultiplier * k));
      } else {
        this.myRigidbody.velocity = v3.scale(v3.norm(v), 165 * k * this.staticJumpMuliplier);
      }
    }
    this.ChangeState(BodyState.Air);
  }

  ParalyzeAll() {
    for (const hb of this.handBehaviourArray) {
      hb.ChangeState(HandState.Paralyzed);
    }
  }

  UnparalyzeAll() {
    for (const hb of this.handBehaviourArray) {
      hb.Unparalize();
    }
  }

  Die() {
    if (this.sfxLib) {
      this.sfxLib.Play(6 + Random.Range(0, 3), 0.3);
    }
    if (this.controlLogic) {
      this.controlLogic.Die();
    }
    for (const hb of this.handBehaviourArray) {
      if (hb && !hb.gameObject.destroyed) {
        hb.Die();
      }
    }
    if (this.arrow) {
      this.arrow.Die();
    }
    this.Destroy(this.gameObject);
  }

  Paralyze(t) {
    this.paralyzeCounter = t;
    this.ChangeState(BodyState.Paralyzed);
  }

  SetPlatform(plat) {
    if (this.platform === plat) {
      return;
    }
    this.ClearPlatform();
    this.platform = plat;
    this.platform.enabled = true;
    this.reachedTheEnd = false;
    if (plat.hangable) {
      this.ChangeState(BodyState.Hanging);
    } else if (plat.swingable) {
      this.ChangeState(BodyState.Swinging);
    } else if (plat.isClimbable) {
      this.ChangeState(BodyState.Climbing);
    }
  }

  ClearPlatform() {
    if (this.platform) {
      this.platform.enabled = false;
      this.platform = null;
    }
  }

  Clash(velocity) {
    const v = this.myRigidbody.velocity;
    this.myRigidbody.velocity = [velocity[0] - v[0], 120, v[2]];
    this.Paralyze(0);
    if (this.sfxLib) {
      this.sfxLib.Play(9 + Random.Range(0, 10), 0.3);
    }
  }

  OnCollisionEnter(collision) {
    this.WakeUp();
    if (!collision || !collision.collider) {
      return;
    }
    const item = collision.gameObject.GetComponent('Item');
    if (!item) {
      return;
    }
    if (item.IsCreature()) {
      if (this.impactType === ImpactType.Clash) {
        if (v3.sqrLen(collision.relativeVelocity) > 30 && this.Time.time - this.collisionTime > 1) {
          this.collisionTime = this.Time.time;
          if (item.clashable) {
            item.Clash(this.lastVelocity);
          }
        }
      } else if (this.impactType === ImpactType.Fall) {
        item.Paralyze(0);
      }
    }
    if (item.isTrampoline) {
      this.myRigidbody.AddForce([this.controlLogic.inputH * -6000, 0, 0]);
    }
  }

  * OnCollisionStay() {
    yield WaitForFixedUpdate;
    if (this.controlLogic) {
      this.myRigidbody.AddForce([this.controlLogic.inputH * -50, 0, 0]);
    }
  }

  Hit(hit, force, direction) {
    this.Paralyze(30);
    this.myRigidbody.velocity = v3.scale(v3.norm(direction), 500);
  }

  * SetInterpolation(inter) {
    yield new WaitForSeconds(1);
    this.myRigidbody.interpolation = inter;
    for (const hb of this.handBehaviourArray) {
      hb.SetInterpolation(inter);
    }
  }

  Sleep() {
    if (this.isSleeping || this.bodyState === BodyState.InversionCheck) {
      return;
    }
    if (this.controlLogic) {
      this.controlLogic.Sleep();
    }
    for (const hb of this.handBehaviourArray || []) {
      hb.Sleep();
    }
    if (this.myRigidbody) {
      this.myRigidbody.isKinematic = true;
    }
    if (this.checkedinversion) {
      this.ChangeState(BodyState.Rest);
    }
    this.enabled = false;
    this.isSleeping = true;
  }

  WakeUp() {
    if (!this.isSleeping) {
      return;
    }
    this.controlLogic.WakeUp();
    for (const hb of this.handBehaviourArray) {
      hb.WakeUp();
    }
    this.myRigidbody.isKinematic = false;
    this.myRigidbody.WakeUp();
    if (!this.checkedinversion) {
      this.ChangeState(BodyState.InversionCheck);
    }
    this.enabled = true;
    this.isSleeping = false;
  }

  FreeOthers(exceptMe) {
    const keep = exceptMe ? 1 : 0;
    while (this.hangingHands.length > keep) {
      if (this.hangingHands[0] !== exceptMe) {
        this.hangingHands.shift().FreeMe();
      }
    }
  }

  // let go with every hand but the numHangingHands that lead in the direction of input
  ReleaseExtraHands(input) {
    const hh = this.hangingHands;
    while (hh.length > 1 && hh.length > this.numHangingHands) {
      const a = hh[0].myTransform.position, b = hh[1].myTransform.position;
      let dropLast;
      if (this.bodyState === BodyState.Climbing || this.bodyState === BodyState.Swinging) {
        dropLast = (a[1] < b[1]) !== (input > 0);
      } else {
        dropLast = (a[0] > b[0]) !== (input > 0);
      }
      (dropLast ? hh.pop() : hh.shift()).FreeMe();
    }
  }

  SetHanging(hand, item) {
    this.SetPlatform(item);
    this.hangingHands.push(hand);
  }

  LockHangingHands() {}
  UnlockHangingHands() {}
  RejectKeys() {}
  GetKeys() {}

  ShouldCatch(hand, item) {
    const cl = this.controlLogic;
    if (item.hangable || item.swingable || item.slidable || item.isClimbable) {
      if (item.enemyExclusive && this.isUser) {
        return false;
      }
      const first = this.hangingHands[0];
      switch (this.bodyState) {
        case BodyState.Fall:
          return false;
        case BodyState.Air:
          if (this.Time.time - this.bodyAir > this.airTimeThreshold) {
            return true;
          }
          break;
        case BodyState.Jumping:
          return false;
        case BodyState.Hanging:
          if ((first.myTransform.position[0] < hand.myTransform.position[0]) === !(cl.inputH > 0)) {
            return true;
          }
          break;
        case BodyState.Climbing:
        case BodyState.Swinging:
          if ((first.myTransform.position[1] > hand.myTransform.position[1]) === !(cl.inputV > 0)) {
            return true;
          }
          break;
        case BodyState.Still:
          if (item !== this.platform) {
            return true;
          }
          if (this.platform.constantV !== 0) {
            cl.inputV = this.platform.constantV;
          }
          if (cl.inputV > 0 && this.myTransform.position[1] - 0.5 > hand.myTransform.position[1]) {
            return true;
          }
          break;
      }
    }
    return !!(item.suspendable && !this.holdingAnItem);
  }

  Suspend() { this.Paralyze(32000); }
  Unsuspend() { this.ChangeState(BodyState.Unparalyze); }

  MakeHandsIgnore(other) {
    for (const hb of this.handBehaviourArray) {
      hb.IgnoreCollision(other);
    }
  }

  GetBranchSpringinessFactor() { return this.springBranchMultiplier; }

  ReachedGoal() {
    if (!this.reachedGoal) {
      this.reachedGoal = true;
      if (this.sfxLib) {
        this.sfxLib.Play(CharacterSFX.Goal, 1);
      }
    }
  }

  PlaySound(i, v) {
    if (this.sfxLib) {
      this.sfxLib.Play(i, v);
    }
  }

  SetGravity() {}
}

// ------------------------------------------------------------------ hands
export class HandBehaviour extends Item {
  constructor(go) {
    super(go);
    this.handState = HandState.None;
    this.lastHoldTime = 0;
    this.lastHangTime = 0;
    this.tempState = false;
    this.item = null;
  }

  CacheConfig(c) {
    this.rigidbodyDrag = c.rigidbodyDrag;
    this.rigidbodyAngularDrag = c.rigidbodyAngularDrag;
    this.handMass = c.handMass;
  }

  Setup(config) {
    this.bodyBehaviour = this.papa.GetComponent('BodyBehaviour');
    this.CacheConfig(config);
    this.myRigidbody = this.rigidbody;
    this.myTransform = this.transform;
    this.startDir = v3.sub(this.bodyBehaviour.myTransform.position, this.myTransform.position);
    this.springJoint = this.gameObject.AddComponent(HingeJoint);
    this.springJoint.axis = [0, 0, 1];
    this.springJoint.anchor = [0, 0, 0];
    this.springJoint.connectedBody = this.papa.rigidbody;
    const rb = this.myRigidbody;
    rb.drag = this.rigidbodyDrag;
    rb.angularDrag = this.rigidbodyAngularDrag;
    rb.mass = this.handMass;
    this.destroyInDeathZone = false;
    if (!this.collider) {
      const sc = new Collider(this.gameObject, 'SphereCollider', { trigger: true, radius: 2, center: [0, 0, 0] });
      this.gameObject.components.push(sc);
      this.world.added(sc);
    }
    this.collider.isTrigger = true;
    this.controlLogic = this.bodyBehaviour.controlLogic;
    this.ChangeState(HandState.Air);
    this.hitable = true;
    this.releaser = true;
  }

  Release() {
    this.bodyBehaviour.ChangeState(BodyState.Air);
  }

  ChangeState(toState) {
    this.tempState = false;
    switch (toState) {
      case HandState.Air:
        this.myRigidbody.isKinematic = false;
        if (this.hangingHingeJoint) {
          this.Destroy(this.hangingHingeJoint);
          this.hangingHingeJoint = null;
        }
        if (this.item && this.item.releasable) {
          this.item.Release(this);
        }
        this.item = null;
        break;
      case HandState.Catching:
        if (this.Time.time - this.lastHangTime > 0.1 && this.bodyBehaviour.ShouldCatch(this, this.item)) {
          this.ChangeState(HandState.Hang);
        }
        this.tempState = true;
        break;
      case HandState.Hang:
        this.hang();
        break;
      case HandState.Paralyzed:
        this.ChangeState(HandState.Air);
        break;
      // ponytail: HoldingAnItem / ReleaseItem only matter for suspendable items, which no level uses
    }
    if (!this.tempState) {
      this.handState = toState;
    }
  }

  // grab the branch at the nearest point of its centre line
  hang() {
    const item = this.item;
    const itemTrans = item.GetHandle(this).transform;
    const rigid = item.GetRigidbody(this);
    const local = itemTrans.InverseTransformPoint(this.myTransform.position);
    const lp = [Math.max(Math.min(local[0], 0.5), -0.5), 0, 0];
    this.myTransform.position = itemTrans.TransformPoint(lp);
    item.Hang(this);
    if (!rigid) {
      this.myRigidbody.isKinematic = true;
    } else {
      if (!this.hangingHingeJoint) {
        this.hangingHingeJoint = this.gameObject.AddComponent(HingeJoint);
        this.hangingHingeJoint.axis = [0, 0, 1];
        this.hangingHingeJoint.anchor = [0, 0, 0];
      }
      this.hangingHingeJoint.connectedBody = rigid;
      this.hangingHingeJoint.useSpring = false;
    }
    this.bodyBehaviour.SetHanging(this, item);
    this.lastHangTime = this.Time.time;
  }

  FreeMe() {
    if (this.handState === HandState.Hang) {
      this.ChangeState(HandState.Air);
    }
  }

  Unparalize() { this.ChangeState(HandState.Air); }
  Die() { this.Destroy(this.gameObject); }

  DoUpdate() {
    if (this.handState === HandState.Hang || this.handState === HandState.Air) {
      this.Sleep();
    } else if (this.handState === HandState.Paralyzed) {
      this.paralyzeTimer -= this.world.deltaTime;
      if (!(this.paralyzeTimer > 0)) {
        this.ChangeState(HandState.Air);
      }
    }
  }

  OnTriggerEnter(other) {
    if (!this.bodyBehaviour || !this.bodyBehaviour.doTriggers) {
      return;
    }
    this.WakeUp();
    if (this.handState !== HandState.Air || !other) {
      return;
    }
    this.item = other.GetComponent('Item');
    const item = this.item;
    if (!item) {
      this.bodyBehaviour.MakeHandsIgnore(other);
      return;
    }
    if (item.hangable || item.isClimbable) {
      this.ChangeState(HandState.Catching);
    } else if (item.suspendable) {
      this.ChangeState(HandState.HoldingAnItem);
    } else if (item.swingable) {
      this.ChangeState(HandState.Catching);
    } else if (item.triggerable) {
      item.Trigger(this.bodyBehaviour);
    }
  }

  IgnoreCollision(other) {
    this.world.physics.IgnoreCollision(other, this.collider);
  }

  Hit(hit, force, direction) {
    this.bodyBehaviour.Paralyze(30);
    this.rigidbody.velocity = v3.scale(v3.norm(direction), 500);
  }

  Paralyze(t) {
    this.paralyzeTimer = t;
    this.ChangeState(HandState.Paralyzed);
  }

  Sleep() {
    if (!this.isSleeping) {
      this.isSleeping = true;
      this.enabled = false;
    }
  }

  WakeUp() {
    if (this.isSleeping) {
      this.isSleeping = false;
      this.enabled = true;
    }
  }

  GetKeys() { this.bodyBehaviour.GetKeys(); }
  RejectKeys() { this.bodyBehaviour.RejectKeys(); }
  SetInterpolation(inter) { this.myRigidbody.interpolation = inter; }

  MoveHangingTo(position) {
    if (this.handState === HandState.Hang) {
      this.myTransform.position = position;
    }
  }

  GetBranchSpringinessFactor() { return this.bodyBehaviour.GetBranchSpringinessFactor(); }
  SetGravity(g) { this.myRigidbody.useGravity = g; }
}

// ------------------------------------------------------------------ helpers on the creature
export class ArrowJumpHelper extends MonoBehaviour {
  Start() {
    this.myTransform = this.transform;
    this.arrowRenderer.enabled = false;
    this.hidden = true;
    this.hiding = false;
  }

  Die() { this.Destroy(this.gameObject); }

  DrawArrow() {
    if (this.hidden) {
      this.arrowRenderer.enabled = true;
    }
    const body = this.bodyBehaviour;
    const dir = v3.norm(body.GetVelocity());
    const bp = body.myTransform.position;
    this.myTransform.position = v3.add(v3.add(bp, v3.scale(dir, 20)), [0, 0, 3]);
    // LookAt(body, up = forward): local z points back at the body, local y along world z
    const f = v3.norm(v3.sub(bp, this.myTransform.position));
    this.myTransform.rotation = lookRotation(f, [0, 0, 1]);
    this.hidden = false;
  }

  * HideArrow() {
    this.DrawArrow();
    this.hiding = true;
    if (!this.hidden) {
      yield new WaitForSeconds(0.7);
      this.arrowRenderer.enabled = false;
      this.hidden = true;
    }
    this.hiding = false;
  }

  DoUpdate() {
    if (this.bodyBehaviour.bodyState === BodyState.Turning) {
      this.DrawArrow();
    } else if (!this.hiding && !this.hidden) {
      this.StartCoroutine(this.HideArrow());
    }
  }
}

// Quaternion.LookRotation(forward, up)
function lookRotation(f, up) {
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  let r = cross(up, f);
  if (v3.len(r) < 1e-6) {
    r = [1, 0, 0];
  }
  r = v3.norm(r);
  const u = cross(f, r);
  const m00 = r[0], m01 = u[0], m02 = f[0], m10 = r[1], m11 = u[1], m12 = f[1], m20 = r[2], m21 = u[2], m22 = f[2];
  const tr = m00 + m11 + m22;
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return quat.normalize(q);
}

export class CharacterSFXLib extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.volumeMultiplier = 1;
    this.clips = [];
  }

  Start() {
    const spin = this.gameObject.AddComponent(SpinSound);
    spin.audioClip = this.clips[0];
    spin.myRigidbody = this.rigidbody;
  }

  Play(i, volume) {
    if (i < this.clips.length && this.clips[i]) {
      SoundSystem.Play(this.world, this.clips[i], volume * this.volumeMultiplier);
    }
  }
}

export class SpinSound extends Item {
  constructor(go) {
    super(go);
    this.intervals = 0.2;
    this.lastSpinSoundTime = 0;
  }

  OnTriggerEnter(other) {
    const item = other.gameObject.GetComponent('Item');
    if (item && item.isSwooshable) {
      this.CheckSpinForSound();
    }
  }

  CheckSpinForSound() {
    const now = this.Time.time;
    if (this.myRigidbody && now - this.lastSpinSoundTime > this.intervals && Math.abs(this.myRigidbody.angularVelocity[2]) > 4) {
      if (this.audioClip) {
        SoundSystem.Play(this.world, this.audioClip, 0.1);
      }
      this.lastSpinSoundTime = now;
    }
  }
}

