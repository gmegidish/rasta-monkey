// Level mechanics: accelerators, bouncers, ropes, sleep zones, climbable poles and character-only objects.
import { MonoBehaviour, WaitForFixedUpdate, WaitForSeconds } from './unity.js';
import { v3, quat } from '../engine/math.js';
import { Item, Hangable, PlatformBehaviour } from './items.js';
import { LevelAttributes, ReleasePool, SoundSystem } from './level.js';
import { BodyState, HandState, TouchControl } from './creature.js';

const CHARACTER_NONE = 0;
const CHARACTER_ALL = 13;

// pushes creatures along its up axis: once on entry (oneShot) and/or every physics step while inside (additive)
export class AcceleratorBehaviour extends Item {
  constructor(go) {
    super(go);
    this.directional = true;
    this.maximizer = 0;
    this.item = null;
  }

  Start() {
    this.myCollider = this.collider;
  }

  // the trigger / collision callbacks all funnel here; non-creatures stop colliding with the accelerator
  handle(other, wantTrigger, apply) {
    const item = other.gameObject.GetComponent('Item');
    if (item && item.IsCreature()) {
      if (this.myCollider.isTrigger === wantTrigger) {
        apply(item);
      }
    } else {
      this.IgnoreCollision(other.collider || other, this.myCollider);
    }
  }

  OnTriggerEnter(c) { this.handle(c, true, (i) => this.StartCoroutine(this.ApplyEnter(i))); }
  OnTriggerStay(c) { this.handle(c, true, (i) => this.StartCoroutine(this.ApplyStay(i))); }
  OnTriggerExit(c) { this.handle(c, true, (i) => this.ApplyExit(i)); }
  OnCollisionEnter(c) { this.handle(c, false, (i) => this.StartCoroutine(this.ApplyEnter(i))); }
  OnCollisionStay(c) { this.handle(c, false, (i) => this.StartCoroutine(this.ApplyStay(i))); }
  OnCollisionExit(c) { this.handle(c, false, (i) => this.ApplyExit(i)); }

  * ApplyEnter(item) {
    yield WaitForFixedUpdate;
    if (this.oneShot || this.additive) {
      this.item = item;
      this.rigid = item.gameObject.GetComponent('Rigidbody');
    }
    if (this.item && this.oneShot) {
      this.rigid.AddForce(v3.scale(this.transform.up, this.oneShotForce * this.item.GetAcceleratorMultiplier()));
    }
  }

  * ApplyStay(item) {
    yield WaitForFixedUpdate;
    if (!this.additive || !this.item || item !== this.item) {
      return;
    }
    const v = this.rigid.velocity;
    if (this.maximizer !== 0 && this.maximizer <= v3.dot(v, v)) {
      return;
    }
    const dir = this.directional ? this.transform.up : v3.norm(v);
    this.rigid.AddForce(v3.scale(dir, this.additiveForce * this.item.GetAcceleratorMultiplier()));
  }

  ApplyExit(item) {
    if (this.item && item === this.item) {
      this.item = null;
    }
  }
}

// puts its items (branches, ropes ...) to sleep 4 s into the level and wakes them while the wakeuper (or the user) is inside
export class Sleeper extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.userBased = false;
    this.count = 0;
  }

  Start() {
    this.items = (this.sendToArray || []).concat(this.sendTo ? [this.sendTo] : []).filter(Boolean);
    this.enabled = true;
    this.levelAttr = LevelAttributes.GetInstance(this.world);
  }

  wakes(other) {
    if (!this.userBased) {
      return other === this.levelAttr.wakeuper;
    }
    return other === this.levelAttr.GetUserCollider();
  }

  OnTriggerStay(other) {
    if (this.Time.time < 0.5 || !other) {
      return;
    }
    // checks every 10th physics step
    if (this.count++ !== 10) {
      return;
    }
    this.count = 0;
    if (!this.wakes(other)) {
      this.IgnoreCollision(other, this.collider);
      return;
    }
    for (const item of this.items) {
      if (item.isSleeping) {
        item.WakeUp();
      }
    }
  }

  OnTriggerExit(other) {
    const item = other.gameObject.GetComponent('Item');
    if (this.userBased ? item && item.isUser : other === this.levelAttr.wakeuper) {
      this.enabled = true;
    }
  }

  Update() {
    if (this.Time.time < 4) {
      return;
    }
    this.enabled = false;
    for (const item of this.items) {
      if (!item.isSleeping) {
        item.Sleep();
      } else {
        this.enabled = true;
      }
    }
  }
}

// sends whatever leaves it off at a fixed speed (scaled by the creature's bounciness)
export class Bouncer extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.killOnImpact = false;
  }

  OnCollisionEnter() {
    if (this.sfx) {
      SoundSystem.Play(this.world, this.sfx, 1, false);
    }
  }

  OnCollisionExit(collision) {
    const rb = collision.rigidbody;
    if (rb) {
      const body = collision.gameObject.GetComponent('BodyBehaviour');
      rb.velocity = v3.scale(v3.norm(rb.velocity), this.power * (body ? body.GetBouncerMultiplier() : 1));
    }
    if (this.killOnImpact) {
      this.Destroy(this.gameObject);
    }
  }
}

export class SlideSoundPlayer extends MonoBehaviour {
  OnCollisionEnter() {
    if (this.sfx) {
      SoundSystem.Play(this.world, this.sfx, 0.2, true);
    }
  }

  OnCollisionExit() {
    SoundSystem.Stop(this.world);
  }
}

// a chain of hinged link prefabs hanging from the rope's position
export class RopeBehaviour extends Item {
  constructor(go) {
    super(go);
    this.sections = 7;
    this.linkScale = [1, 1, 1];
  }

  Start() {
    this.myTransform = this.transform;
    let position = this.myTransform.position;
    this.links = [];
    for (let i = 0; i < this.sections; i++) {
      const last = i === this.sections - 1 && this.endLink;
      const go = this.Instantiate(last ? this.endLink : this.link, position, this.myTransform.rotation);
      if (!last) {
        go.transform.localScale = this.linkScale.slice();
        go.transform.dirty();
      }
      this.links.push(go);
      const hinge = go.GetComponent('HingeJoint');
      if (i > 0) {
        hinge.connectedBody = this.links[i - 1].GetComponent('Rigidbody');
      } else if (this.connectedTo) {
        hinge.connectedBody = this.connectedTo;
      }
      go.transform.SetParent(this.myTransform);
      const lb = go.GetComponent('LinkBehaviour');
      if (lb) {
        lb.papaRope = this;
        position = go.transform.TransformPoint(v3.sub(lb.nextLinkPosition.localPosition, hinge.anchor));
      }
    }
    this.startTransform = this.links[0].transform;
    this.endTransform = this.links[this.sections - 1].transform;
    this.Sleep();
  }

  eachLink(fn) {
    for (const go of this.links || []) {
      const lb = go.GetComponent('LinkBehaviour');
      if (lb) {
        fn(lb);
      }
    }
  }

  Sleep() {
    if (this.isSleeping) {
      return;
    }
    this.isSleeping = true;
    this.enabled = false;
    this.eachLink((l) => l.Sleep());
  }

  WakeUp() {
    if (!this.isSleeping) {
      return;
    }
    this.isSleeping = false;
    this.enabled = true;
    this.eachLink((l) => l.WakeUp());
  }
}

export class LinkBehaviour extends Hangable {
  AbstractStart() {
    this.rigid = this.rigidbody;
  }

  Start() {
    this.AbstractStart();
  }

  Sleep() {
    this.rigidbody.isKinematic = true;
    this.enabled = false;
    this.isSleeping = true;
  }

  WakeUp() {
    this.rigidbody.isKinematic = false;
    this.rigidbody.WakeUp();
    this.enabled = true;
    this.isSleeping = false;
  }

  GetHandle() { return this.gameObject; }
  GetRigidbody() { return this.rigid; }
  GetCollider() { return this.collider; }
  Hang() { return this.rigid; }
}

export class RopeLinkBehaviour extends LinkBehaviour {
  Start() {
    this.AbstractStart();
    this.gameObject.tag = 'trunk';
    this.swingable = true;
    this.HangableSetup();
    this.collider.isTrigger = true;
  }
}

// plays one of the creature's own sounds when the user passes through
export class SoundTrigger extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.volume = 1;
  }

  OnTriggerEnter(other) {
    const item = other.gameObject.GetComponent('Item');
    if (!item || !item.isUser) {
      this.IgnoreCollision(other, this.collider);
    } else {
      item.PlaySound(this.characterSFX, this.volume);
    }
  }
}

// removes objects meant for other characters
export class CharacterSpecific extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.autoDestruct = true;
    this.master = true;
  }

  Awake() {
    if (!this.master) {
      return;
    }
    if (!this.CharacterReady()) {
      this.Destroy(this.gameObjectToDestroy || this.gameObject);
    } else if (this.autoDestruct) {
      this.Destroy(this);
    }
  }

  CharacterReady(theChar = LevelAttributes.GetInstance(this.world).GetCharacterType()) {
    if (this.character === CHARACTER_NONE || this.character === CHARACTER_ALL) {
      return true;
    }
    return [this.character, this.character1, this.character2, this.character3, this.character4].includes(theChar);
  }
}

// a branch that moves by animation while awake
export class AnimatedPlatform extends PlatformBehaviour {
  Sleep() {
    this.animation.Stop();
    this.isSleeping = true;
  }

  WakeUp() {
    this.animation.Play();
    this.isSleeping = false;
  }
}

// a vertical pole the creature climbs
export class VPlatform extends Hangable {
  Start() {
    this.isClimbable = true;
    this.HangableSetup();
  }

  GetHandle() { return this.gameObject; }
  Hang() { return null; }
  Release() {}
  GetRigidbody() { return this.rigidbody || null; }
}

// editor gizmo only
export class BezierPoint extends MonoBehaviour {}

// De Casteljau over the control points' world positions
function bezier(points, t) {
  let ps = points.map((tr) => tr.position);
  while (ps.length > 1) {
    ps = ps.slice(1).map((p, i) => v3.lerp(ps[i], p, t));
  }
  return ps[0];
}

// lays `density` pickups along a Bezier curve
// ponytail: the curve's LineRenderer (an editor guide) is not exported or drawn
export class PickupLineBehaviour extends MonoBehaviour {
  Start() {
    for (let i = 0; i < this.density; i++) {
      const t = i / (this.density - 1);
      if (t < this.pickupStart || t > this.pickupEnd) {
        continue;
      }
      const c = bezier(this.points, t);
      c[2] = 0;
      let obj = null;
      if (this.centerGrowth) {
        obj = this.Instantiate(this.kind, c, this.transform.rotation);
      }
      if (this.leftGrowth) {
        obj = this.Instantiate(this.kind, [c[0] + this.growthDistance, c[1], 0], [0, 0, 0, 1]);
      }
      if (this.rightGrowth) {
        obj = this.Instantiate(this.kind, [c[0] - this.growthDistance, c[1], 0], [0, 0, 0, 1]);
      }
      ReleasePool.GetInstance(this.world).Add(obj);
    }
  }
}

// bounces the user back: flips vertical speed on entry and pushes along its up axis
export class Rejector extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.directional = true;
    this.maximizer = 0;
    this.hardLimit = false;
  }

  Start() {
    this.myCollider = this.collider;
  }

  userItem(other) {
    const item = other.gameObject.GetComponent('Item');
    return item && item.isUser ? item : null;
  }

  OnTriggerEnter(other) {
    const item = this.userItem(other);
    if (item) {
      this.ApplyEnter(item);
    } else {
      this.IgnoreCollision(other, this.collider);
    }
  }

  OnTriggerStay(other) {
    const item = this.userItem(other);
    if (item) {
      this.StartCoroutine(this.ApplyStay(item));
    }
  }

  OnTriggerExit(other) {
    const item = this.userItem(other);
    if (item && item === this.item) {
      this.item = null;
    }
  }

  OnCollisionEnter(collision) {
    const item = collision.gameObject.GetComponent('Item');
    if (!this.myCollider.isTrigger && item) {
      this.ApplyEnter(item);
    }
  }

  ApplyEnter(item) {
    this.item = item;
    const rigid = this.rigid = item.gameObject.GetComponent('Rigidbody');
    if (this.oneShot || this.additive || this.reflector) {
      const v = rigid.velocity;
      rigid.velocity = [v[0], -v[1], 0];
    }
    if (this.oneShot) {
      rigid.AddForce(v3.scale(this.transform.up, this.oneShotForce));
    }
    if (this.hardLimit) {
      // the original snaps to the collider bounds' closest point to a far-away position, 3 units up
      const b = this.collider.bounds, p = v3.scale(item.myTransform.position, 500);
      const closest = p.map((x, i) => Math.min(Math.max(x, b.min[i]), b.max[i]));
      item.myTransform.position = v3.add(closest, v3.scale(this.transform.up, 3));
      rigid.velocity = [0, 0, 0];
    }
  }

  * ApplyStay(item) {
    yield WaitForFixedUpdate;
    const v = this.rigid && this.rigid.velocity;
    if (this.additive && this.item && item === this.item && (this.maximizer === 0 || this.maximizer > v3.dot(v, v))) {
      this.rigid.AddForce(v3.scale(this.transform.up, this.additiveForce));
    }
  }
}

// opens (plays its "Default" animation forward) while triggered; closes again `counter` seconds after the last trigger
export class Door extends Item {
  constructor(go) {
    super(go);
    this.isOpen = false;
    this.actorFactor = 1;
    this.checking = false;
    this.lastTriggerTime = 0;
  }

  Start() {
    this.myAnimation = this.animation;
    this.defaultAnimation = this.myAnimation.get('Default');
  }

  swing(speed) {
    this.defaultAnimation.speed = speed;
    if (!this.myAnimation.isPlaying) {
      // resume from where the swing is rather than rewinding
      const t = this.defaultAnimation.time;
      this.myAnimation.Play('Default');
      this.defaultAnimation.time = Math.min(Math.max(t, 0), this.defaultAnimation.length);
    }
    if (this.sfx) {
      SoundSystem.Play(this.world, this.sfx, 0.3, false);
    }
  }

  Untrigger() {
    if (this.isOpen) {
      this.swing(-1);
      this.isOpen = false;
    }
    this.enabled = false;
  }

  Trigger() {
    if (!this.isOpen) {
      this.swing(1);
      this.isOpen = true;
    }
    this.enabled = true;
    this.lastTriggerTime = this.Time.time;
    if (!this.checking) {
      this.StartCoroutine(this.Check());
    }
  }

  * Check() {
    this.checking = true;
    const bb = LevelAttributes.GetInstance(this.world).userBodyBehaviour;
    if (bb) {
      this.actorFactor = bb.timeSwitchMultiplier;
    }
    while (this.Time.time - this.lastTriggerTime <= this.counter * this.actorFactor) {
      yield new WaitForSeconds(1);
    }
    this.Untrigger();
    this.checking = false;
  }
}

// a lever branch: while it hangs rotated into its click range it keeps the door open
export class Switch extends PlatformBehaviour {
  constructor(go) {
    super(go);
    // shadows Behaviour's `time` getter so the serialized field can be stored (unused, like in the original)
    Object.defineProperty(this, 'time', { value: 10, writable: true });
    this.counter = -1;
    this.lowClickAngle = 190;
    this.highClickAngle = 350;
  }

  Update() {
    const z = ((quat.zAngle(this.myTransform.rotation) * 180 / Math.PI) % 360 + 360) % 360;
    if (z >= this.lowClickAngle && z <= this.highClickAngle && this.door) {
      this.door.Trigger(null);
    }
  }
}

// opens (plays its animation) once the level's fruit condition is met, checking every 4 s
export class DoorCondition extends MonoBehaviour {
  Start() {
    this.condition = this.GetComponent('FruitsCondition');
    this.StartCoroutine(this.CheckFruits());
  }

  * CheckFruits() {
    while (!this.condition || !this.condition.Check()) {
      yield new WaitForSeconds(4);
    }
    this.animation.Play();
  }
}

// the tree that falls when grabbed and raises itself again; its speed depends on the character
export class AnimationTriggerPlatform extends MonoBehaviour {
  Start() {
    this.StartCoroutine(this.Check());
  }

  * Check() {
    let bb = null;
    while (!(bb = LevelAttributes.GetInstance(this.world).userBodyBehaviour)) {
      yield new WaitForSeconds(1);
    }
    for (const st of Object.values(this.anim ? this.anim.states : {})) {
      st.speed = bb.fallingTreesAnimationSpeedFactor;
    }
  }

  Trigger() {
    if (this.anim && !this.anim.isPlaying) {
      this.anim.Play('TreeFall');
      this.anim.PlayQueued('TreeRaise');
    }
  }
}

// a lever driven by touch: the left part of the screen plays its animation backwards, the right part forwards
// (the original tests inputH < 0.5, i.e. the left three quarters)
export class FlipperHandle extends Item {
  constructor(go) {
    super(go);
    this.stopable = false;
    this.stopSpeed = 10;
    this.startSpeed = 5;
    this.speed = 1;
    this.ease = true;
    this.formerH = 0;
    this.desiredSpeed = 0;
  }

  Start() {
    this.touchControl = TouchControl.GetInstance(this.world);
    this.isOn = false;
    this.myTransform = this.transform;
    this.myAnimation = this.animation;
    this.enabled = false;
    this.defaultAnimation = this.myAnimation.get('Default');
  }

  setDirection(h) {
    if (this.formerH === h) {
      return;
    }
    this.desiredSpeed = this.speed * h;
    if (!this.ease) {
      this.defaultAnimation.speed = this.desiredSpeed;
    }
    this.formerH = h;
    if (this.sfx1) {
      SoundSystem.Play(this.world, this.sfx1, 0.1, false);
    }
  }

  Update() {
    const tc = this.touchControl, st = this.defaultAnimation, dt = this.Time.deltaTime;
    tc.Refresh();
    if (tc.fingersDown === 0) {
      if (this.stopable && (this.formerH !== 0 || this.ease)) {
        this.desiredSpeed = 0;
        this.formerH = 0;
        st.speed = this.ease ? st.speed + (0 - st.speed) * Math.min(dt * this.stopSpeed, 1) : 0;
      }
    } else {
      const W = this.world.screenWidth;
      const inputH = (Math.max(Math.min(tc.touch[0], W), 0) / W - 0.5) * 2;
      this.setDirection(inputH < 0.5 ? -1 : 1);
      if (this.ease) {
        st.speed += (this.desiredSpeed - st.speed) * Math.min(dt * this.startSpeed, 1);
      }
    }
    if (!this.myAnimation.isPlaying) {
      this.myAnimation.Play('Default');
    }
  }

  Sleep() {
    this.enabled = false;
    this.isSleeping = true;
    if (this.myAnimation) {
      this.myAnimation.Stop();
    }
  }

  WakeUp() {
    this.enabled = true;
    this.isSleeping = false;
  }
}

// a hinged flipper whose motor turns one way while the left of the screen is touched, the other way on the right
export class Flipper extends Item {
  constructor(go) {
    super(go);
    this.onVelocity = 500;
    this.offVelocity = -500;
    this.stopable = false;
    this.formerH = 0;
  }

  Start() {
    this.touchControl = TouchControl.GetInstance(this.world);
    this.myTransform = this.transform;
    this.myHinge = this.GetComponent('HingeJoint');
    this.myRigid = this.rigidbody;
    this.enabled = false;
  }

  setMotor(v) {
    this.myHinge.motor = { ...this.myHinge.motor, targetVelocity: v };
  }

  Update() {
    const tc = this.touchControl;
    tc.Refresh();
    if (tc.fingersDown === 0) {
      if (this.stopable) {
        this.formerH = 0;
        this.setMotor(0);
      }
      return;
    }
    const W = this.world.screenWidth;
    const h = (Math.max(Math.min(tc.touch[0], W), 0) / W - 0.5) * 2 < 0.5 ? -1 : 1;
    if (h !== this.formerH) {
      this.formerH = h;
      this.setMotor(h < 0 ? this.onVelocity : this.offVelocity);
      if (this.sfx1) {
        SoundSystem.Play(this.world, this.sfx1, 0.1, false);
      }
    }
  }

  Sleep() {
    this.enabled = false;
    this.isSleeping = true;
    this.myRigid.isKinematic = true;
  }

  WakeUp() {
    this.enabled = true;
    this.myRigid.isKinematic = false;
    this.isSleeping = false;
  }
}

// a spinning wheel: hands hang on a handle object moved to where they grab; jumping off flings at the rim speed
export class Gear extends Hangable {
  Start() {
    this.myTransform = this.transform;
    this.enabled = false;
    this.isGear = true;
    this.originalSpeed = this.speed;
  }

  FixedUpdate() {
    const t = this.myTransform;
    t.localRotation = quat.mul(t.localRotation, quat.fromZ(this.Time.fixedDeltaTime * this.speed * Math.PI / 180));
    t.dirty();
  }

  GetHandle(hand) {
    this.handle.transform.position = hand.myTransform.position;
    return this.handle;
  }

  GetRigidbody() { return this.handle.GetComponent('Rigidbody'); }

  Hang(hand) {
    this.speed = this.originalSpeed * hand.bodyBehaviour.gearFactor;
    return null;
  }

  Release(hand) {
    const body = hand.bodyBehaviour;
    if (body.bodyState === BodyState.AboutToJump) {
      const rb = body.myRigidbody;
      rb.velocity = v3.scale(v3.norm(rb.velocity), this.myTransform.localScale[0] * 0.05 * this.speed);
    }
  }
}

// the magnet's lightning: stretched from the magnet to the user while the magnet pulls, hidden 3 frames after
export class Bolt extends MonoBehaviour {
  Start() {
    const t = this.myTransform;
    t.SetParent(null);
    const p = t.position;
    t.position = [p[0], p[1], -2];
    t.localScale = [t.localScale[0], 4, t.localScale[2]];
    t.dirty();
    this.checking = false;
    this.Stop();
  }

  RenderFrame(target) {
    this.lastCall = this.world.frameCount;
    if (!target) {
      return;
    }
    this.myRenderers[0].enabled = true;
    this.myRenderers[1].enabled = true;
    const t = this.myTransform, to = v3.add(target.position, [0, 0, -2]);
    t.rotation = lookAt(v3.sub(to, t.position));
    t.localScale = [t.localScale[0], t.localScale[1], v3.dist(target.position, t.position) * 2];
    t.dirty();
    if (!this.checking) {
      this.StartCoroutine(this.Check());
    }
  }

  * Check() {
    this.checking = true;
    while (this.world.frameCount <= this.lastCall + 3) {
      yield null;
    }
    this.Stop();
    this.checking = false;
  }

  Stop() {
    this.myRenderers[0].enabled = false;
    this.myRenderers[1].enabled = false;
  }
}

// pulls the user along its up axis while a finger is down and the user is inside
export class Magnet extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.force = 10;
    this.renderFrame = false;
    this.activeFrame = false;
  }

  Start() {
    this.touchControl = TouchControl.GetInstance(this.world);
    this.bolt = this.gameObject.GetComponentInChildren('Bolt');
    this.appliedForce = v3.scale(this.transform.up, this.force);
    this.enabled = true;
  }

  Update() {
    if (!this.renderFrame) {
      this.enabled = false;
      return;
    }
    if (this.bolt) {
      this.bolt.RenderFrame(this.affectedTransform);
    }
    this.renderFrame = false;
  }

  OnTriggerStay(other) {
    this.touchControl.Refresh();
    if (this.touchControl.fingersDown === 0) {
      this.activeFrame = false;
      return;
    }
    const body = other.gameObject.GetComponent('BodyBehaviour');
    if (!body) {
      this.IgnoreCollision(other, this.collider);
      return;
    }
    if (body.isUser) {
      this.affectedTransform = this.affectedTransform || other.transform;
      this.renderFrame = true;
      this.activeFrame = true;
      this.enabled = true;
    }
    if (this.activeFrame) {
      body.myRigidbody.AddForce(this.appliedForce);
    }
  }
}

// low gravity (a fifth) while the user is inside
export class NoGravityZone extends MonoBehaviour {
  Start() {
    this.originalGravity = this.world.physics.gravity;
  }

  userBody(other) {
    const body = other.gameObject.GetComponent('BodyBehaviour');
    if (!body || !body.isUser) {
      this.IgnoreCollision(other, this.collider);
      return null;
    }
    return body;
  }

  OnTriggerStay(other) {
    const body = this.userBody(other);
    if (body && !this.bodyBehaviour) {
      this.bodyBehaviour = body;
      this.world.physics.gravity = v3.scale(this.originalGravity, 0.2);
    }
  }

  OnTriggerExit(other) {
    // like the original, bodyBehaviour stays set, so the zone only lowers gravity on the first visit
    if (this.userBody(other) && this.bodyBehaviour) {
      this.world.physics.gravity = this.originalGravity;
    }
  }
}

export class Chainsaw extends Item {
  Start() {
    this.anim = this.animation;
  }

  Sleep() {
    if (!this.isSleeping) {
      this.anim.Stop();
      this.enabled = false;
      this.isSleeping = true;
    }
  }

  WakeUp() {
    if (this.isSleeping) {
      this.anim.Play();
      this.enabled = true;
      this.isSleeping = false;
    }
  }
}

// a belt that drags hanging hands by moveVector each step and lets go of them past its ends
export class ConveyorBelt extends Hangable {
  constructor(go) {
    super(go);
    this.moveVector = [5, 0, 0];
    this.hangingHands = [];
  }

  Start() {
    this.HangableSetup();
  }

  FixedUpdate() {
    if (this.hangingHands.length === 0) {
      this.enabled = false;
      return;
    }
    for (const hand of this.hangingHands.slice()) {
      const x = hand.myTransform.position[0];
      // world +x shows on screen-left, so "left" has the larger x
      if (x < this.left.position[0] && x > this.right.position[0]) {
        hand.myTransform.position = v3.add(hand.myTransform.position, this.moveVector);
      } else {
        hand.Release();
      }
    }
  }

  Hang(hand) {
    this.hangingHands.push(hand);
    this.enabled = true;
    return null;
  }

  Release(hand) {
    this.hangingHands = this.hangingHands.filter((h) => h !== hand);
    if (this.hangingHands.length === 0) {
      this.enabled = false;
    }
  }

  GetRigidbody() { return null; }
}

// knocks hanging creatures off (into the air)
export class HandReleaserBehaviour extends MonoBehaviour {
  OnTriggerStay(other) {
    const hand = other.gameObject.GetComponent('HandBehaviour');
    if (hand && hand.bodyBehaviour.bodyState !== BodyState.Air && hand.handState === HandState.Hang) {
      hand.bodyBehaviour.ChangeState(BodyState.Air);
    }
  }
}

export class SetPhysicalMaterials extends MonoBehaviour {
  Start() {
    for (const c of this.gameObject.GetComponentsInChildren('Collider')) {
      c.material = this.mat;
      this.world.physics.colliderChanged(c);
    }
    this.Destroy(this);
  }
}

export class IgnoreCollisions extends MonoBehaviour {
  Awake() {
    for (const c of this.colliders || []) {
      this.IgnoreCollision(this.collider, c);
    }
  }
}

export class Peg extends MonoBehaviour {}

// rotation whose local z axis points along f (Transform.LookAt with world up)
function lookAt(f) {
  const z = v3.norm(f);
  const up = Math.abs(z[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const x = v3.norm(cross(up, z)), y = cross(z, x);
  const t = x[0] + y[1] + z[2];
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    return [(y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s, s / 4];
  }
  if (x[0] > y[1] && x[0] > z[2]) {
    const s = Math.sqrt(1 + x[0] - y[1] - z[2]) * 2;
    return [s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s, (y[2] - z[1]) / s];
  }
  if (y[1] > z[2]) {
    const s = Math.sqrt(1 + y[1] - x[0] - z[2]) * 2;
    return [(y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s, (z[0] - x[2]) / s];
  }
  const s = Math.sqrt(1 + z[2] - x[0] - y[1]) * 2;
  return [(z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4, (x[1] - y[0]) / s];
}
