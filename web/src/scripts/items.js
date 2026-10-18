// Things the creature interacts with: the Item base class, branches (Hangable / PlatformBehaviour), fruit and death zones.
import { MonoBehaviour, PlayerPrefs, vecString, WaitForSeconds } from './unity.js';
import { quat } from '../engine/math.js';
import { LevelAttributes, ReleasePool, SoundSystem } from './level.js';

const ITEM_FLAGS = ['hitable', 'suspendable', 'fireable', 'unsuspendable', 'hangable', 'looseHold', 'deathZone', 'paralyzable',
  'paralyzing', 'clashable', 'wakeuper', 'isGoal', 'triggerable', 'untriggerable', 'releaser', 'isUser', 'isEnemy', 'swingable',
  'isTrampoline', 'releasable', 'isSwooshable', 'slidable', 'isClimbable', 'isSleeping'];

export class Item extends MonoBehaviour {
  constructor(go) {
    super(go);
    for (const f of ITEM_FLAGS) {
      this[f] = false;
    }
    this.destroyInDeathZone = true;
    this.myTransform = null;
  }

  Lock2d(zLock) {
    const t = this.myTransform;
    if (t.localPosition[2] !== zLock) {
      t.localPosition = [t.localPosition[0], t.localPosition[1], zLock];
      t.dirty();
    }
  }

  IsCreature() { return this.isUser || this.isEnemy; }
  // the original logs "not implemented" for these
  Suspend() { return null; }
  Unsuspend() {}
  Hit() {}
  HoldingPoint() { return [0, 0, 0]; }
  Fire() {}
  Hang() { return null; }
  GetHandle() { return null; }
  GetCollider() { return null; }
  Release() {}
  Paralyze() {}
  Clash() {}
  GetRigidbody() { return null; }
  Trigger() {}
  Untrigger() {}
  RejectKeys() {}
  GetKeys() {}
  Sleep() {}
  WakeUp() {}
  Die() {}
  Uncombine() {
    if (this.renderer) {
      this.renderer.enabled = true;
    }
  }
}

export class Hangable extends Item {
  constructor(go) {
    super(go);
    this.leftPoint = [0, 0, 0];
    this.rightPoint = [0, 0, 0];
    this.kinematic = false;
    this.enemyExclusive = false;
    this.animated = false;
    this.isGear = false;
    this.constantV = 0;
  }

  // the two ends of the branch's centre line, ordered left/right (or top/bottom for climbables)
  UpdateHangingPoints() {
    if (!this.myTransform) {
      this.myTransform = this.transform;
    }
    const a = this.myTransform.TransformPoint([0.5, 0, 0]);
    const b = this.myTransform.TransformPoint([-0.5, 0, 0]);
    if (this.hangable || this.swingable) {
      [this.leftPoint, this.rightPoint] = a[0] < b[0] ? [a, b] : [b, a];
    }
    if (this.isClimbable) {
      [this.leftPoint, this.rightPoint] = a[1] > b[1] ? [a, b] : [b, a];
    }
  }

  GetHandle() { return this.gameObject; }

  HangableSetup() {
    this.myTransform = this.transform;
    this.UpdateHangingPoints();
  }
}

export class PlatformBehaviour extends Hangable {
  constructor(go) {
    super(go);
    this.hangingHandsCount = 0;
    this.myRigid = null;
  }

  AbstractStart() {
    this.animated = false;
    this.myTransform = this.transform;
    const p = this.myTransform.position;
    if (p[2] !== 0) {
      this.myTransform.position = [p[0], p[1], 0];
    }
    this.myGameObject = this.gameObject;
    this.hangable = true;
    this.hitable = true;
    this.paralyzable = false;
    this.releasable = true;
    this.isSwooshable = true;
    this.myHinge = this.GetComponent('HingeJoint');
    if (this.myHinge) {
      this.originalSpriginess = this.myHinge.spring.spring;
    }
    this.HangableSetup();
    this.collider.isTrigger = true;
    if (this.rigidbody) {
      this.myRigid = this.rigidbody;
      this.kinematic = this.myRigid.isKinematic;
      this.myRigid.interpolation = 0;
    } else {
      this.kinematic = true;
    }
    if (this.GetComponent('AnimationTriggerPlatform')) {
      this.animated = true;
    }
    this.SuperSleep();
  }

  Start() {
    this.AbstractStart();
  }

  SuperHang(hand) {
    if (this.myHinge) {
      this.myHinge.spring = { ...this.myHinge.spring, spring: this.originalSpriginess * hand.GetBranchSpringinessFactor() };
    }
    const atp = this.GetComponent('AnimationTriggerPlatform');
    if (atp && atp.Trigger) {
      atp.Trigger();
    }
    this.hangingHandsCount++;
    this.SuperWakeUp();
  }

  GetHandle() { return this.myGameObject; }

  SuperRelease() {
    if (this.hangingHandsCount > 0) {
      this.hangingHandsCount--;
    }
    this.releaseTime = this.Time.time;
    this.StartCoroutine(this.TestSleep());
  }

  * TestSleep() {
    this.testSleepTime = this.Time.time;
    yield new WaitForSeconds(0.5);
    if (this.hangingHandsCount <= 0 && this.Time.time - this.testSleepTime > 0.45) {
      this.SuperSleep();
    }
  }

  GetRigidbody() { return this.myRigid; }
  Hang(hand) { this.SuperHang(hand); return null; }
  Release(hand) { this.SuperRelease(hand); }

  SuperSleep() {
    if (this.isSleeping) {
      return;
    }
    if (this.myRigid) {
      this.myRigid.isKinematic = true;
    }
    this.enabled = false;
    this.isSleeping = true;
  }

  Sleep() { this.SuperSleep(); }

  SuperWakeUp() {
    if (!this.isSleeping) {
      return;
    }
    if (this.myRigid) {
      this.myRigid.isKinematic = this.kinematic;
    }
    this.isSleeping = false;
    this.enabled = true;
  }

  WakeUp() { this.SuperWakeUp(); }
  GetCollider() { return this.collider; }

  Hit(hit, force, direction) {
    if (!this.rigidbody.isKinematic) {
      const l = Math.hypot(...direction) || 1;
      this.rigidbody.velocity = direction.map((x) => (x / l) * 200);
    }
  }
}

export class BranchEnd extends MonoBehaviour {}

// spreads `amount` fruit systems along the branch it sits on
export class BranchFruitSystemCreator extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.amount = 5;
  }

  Awake() {
    if (!(this.amount > 0)) {
      this.Destroy(this);
      return;
    }
    const packet = this.world.createGameObject('fruit packet');
    const branch = packet.transform;
    branch.localScale = this.transform.localScale.slice();
    branch.SetParent(this.transform);
    branch.localPosition = [0, 0, 0];
    branch.localRotation = [0, 0, 0, 1];
    branch.dirty();
    for (let i = 0; i < this.amount; i++) {
      const go = this.Instantiate(this.fruitSystemPrefab, this.transform.position, [0, 0, 0, 1]);
      ReleasePool.GetInstance(this.world).Add(go);
      const fs = go.GetComponent('FruitSystem');
      fs.position = (i + 0.8) / this.amount;
      fs.transform.position = branch.TransformPoint([fs.position - 0.5, 0, 0]);
      fs.branch = branch;
      fs.up = this.up;
    }
  }
}

export class FruitSystem extends MonoBehaviour {
  Start() {
    let ez = 0;
    if (this.branch) {
      ez = quat.zAngle(this.branch.rotation) * 180 / Math.PI;
    }
    const p = this.transform.position, o = this.fruitOffset;
    if (!this.up) {
      this.fruit = this.Instantiate(this.fruitPrefab, [p[0] - o[0], p[1] - o[1], p[2] - o[2]], quat.euler(0, 0, 180 + ez));
    } else {
      this.fruit = this.Instantiate(this.fruitPrefab, [p[0] + o[0], p[1] + o[1], p[2] + o[2]], quat.euler(0, 0, ez));
    }
    ReleasePool.GetInstance(this.world).Add(this.fruit);
    if (this.branch) {
      this.fruit.transform.SetParent(this.branch);
    }
    this.Destroy(this.gameObject);
  }
}

export class CollectableBehaviour extends Item {
  constructor(go) {
    super(go);
    this.qunantity = 1;
    this.volume = 1;
    this.collected = false;
  }

  StartAbstract() {
    this.myTransform = this.transform;
    const la = LevelAttributes.GetInstance(this.world);
    this.levelAttributes = la;
    this.Serialized();
    if (la.loadedLevel && PlayerPrefs.HasKey(this.serialText) && PlayerPrefs.GetInt(this.serialText, 0) === 1) {
      la.Collected(this.type, this.qunantity);
      this.Destroy(this.gameObject);
      return;
    }
    PlayerPrefs.SetInt(this.serialText, 0);
    this.gameObject.tag = 'collectable';
    this.triggerable = true;
    this.collider.isTrigger = true;
    const p = this.myTransform.position;
    if (p[2] !== 0) {
      this.myTransform.position = [p[0], p[1], 0];
    }
    la.Register(this.type, this);
    this.myMeshFilter = this.GetComponent('MeshFilter');
    if (this.graphics) {
      this.myMeshFilter.mesh = this.graphics;
    }
  }

  Start() {
    this.StartAbstract();
  }

  TriggerAbstract(body) {
    if (this.collected || !body.isUser) {
      return;
    }
    this.levelAttributes.Collected(this.type, this.qunantity);
    PlayerPrefs.SetInt(this.serialText, 1);
    const p = this.myTransform.position;
    this.myTransform.position = [p[0], p[1], 100000];
    this.collected = true;
    if (this.sfx) {
      SoundSystem.Play(this.world, this.sfx, this.volume, false, 1);
    }
  }

  Trigger(body) {
    this.TriggerAbstract(body);
  }

  Serialized() {
    this.serialText = 'Level' + this.levelAttributes.currentLevel + 'Collectable_' + this.type + vecString(this.myTransform.position);
    return this.serialText;
  }
}

// ponytail: the particle "explosion" emitter is not reproduced; the fruit just disappears
export class ExplodingCollectable extends CollectableBehaviour {}

export class DeathZoneBehaviour extends Item {
  Start() {
    this.deathZone = true;
  }

  OnTriggerEnter(other) {
    const item = other.GetComponent('Item');
    if (item && item.destroyInDeathZone) {
      item.Die();
    } else {
      this.IgnoreCollision(other, this.collider);
    }
  }
}
