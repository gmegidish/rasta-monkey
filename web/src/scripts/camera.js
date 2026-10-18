// The follow camera: CameraScrolling eases toward its target, whose CameraTargetAttributes set offset, zoom and springiness.
import { MonoBehaviour } from './unity.js';
import { v3 } from '../engine/math.js';
import { LevelAttributes } from './level.js';

const BodyState = { Still: 1, Hanging: 2, Turning: 4, Air: 5, Swinging: 10 };
const CameraSubState = { None: 0, Phase1: 1 };

export class CameraScrolling extends MonoBehaviour {
  constructor(go) {
    super(go);
    this.distance = 0;
    this.springiness = 2;
    this.heightOffset = 0;
    this.horizontalOffset = 0;
    this.staticCamera = false;
  }

  Awake() {
    this.myTransform = this.transform;
    this.levelAttributes = LevelAttributes.GetInstance(this.world);
    this.springiness = 2;
  }

  SetTarget(t, snap = false) {
    this.target = t;
    this.targetRigidbody = t ? t.gameObject.GetComponent('Rigidbody') : null;
    if (snap) {
      this.myTransform.position = this.GetGoalPosition();
    }
    this.cameraTargetAttributes = t ? t.gameObject.GetComponent('CameraTargetAttributes') : null;
  }

  GetTarget() { return this.target; }

  LateUpdate() {
    const goal = this.GetGoalPosition();
    const a = this.cameraTargetAttributes;
    if (a && !a.gameObject.destroyed) {
      a.DoUpdate();
      this.heightOffset = a.heightOffset;
      this.horizontalOffset = a.horizontalOffset;
      this.goalOrthographicSize = a.orthographicSize;
      this.springiness = a.springiness;
      this.staticCamera = a.staticCamera;
      this.staticPosition = a.staticPosition;
    }
    this.myTransform.position = v3.lerp(this.myTransform.position, goal, Math.min(1, this.world.deltaTime * this.springiness));
    this.distance = this.goalOrthographicSize;
  }

  // target + offsets, pulled back along z by twice the "orthographic size" (the camera is a perspective one)
  GetGoalPosition() {
    if (!this.target || this.target.gameObject.destroyed) {
      return this.myTransform.position;
    }
    const base = this.staticCamera ? this.staticPosition : this.target.position;
    return v3.add(base, [this.horizontalOffset, this.heightOffset, (this.distance || 0) * 2]);
  }
}

export class CameraTargetAttributes extends MonoBehaviour {
  constructor(go) {
    super(go);
    Object.assign(this, { heightOffset: 0, horizontalOffset: 0, distanceModifier: 1, springiness: 2, orthographicSize: 40, staticCamera: false });
  }

  SetData(a) {
    for (const k of ['heightOffset', 'horizontalOffset', 'distanceModifier', 'velocityLookAhead', 'maxLookAhead', 'springiness',
      'orthographicSize', 'staticCamera', 'staticPosition']) {
      this[k] = a[k];
    }
  }

  Start() {
    this.staticPosition = this.transform.position;
  }

  DoUpdate() {}
}

// zooms and frames the creature by its state; CameraDirectionOverride triggers can take over
export class CreatureCameraTargetAttributes extends CameraTargetAttributes {
  constructor(go) {
    super(go);
    this.override = false;
    this.zoomFactor = 0.6;
    this.state = 0;
    this.cameraSubState = CameraSubState.None;
  }

  Start() {
    this.bodyBehaviour = this.GetComponent('BodyBehaviour');
    this.controlLogic = this.GetComponent('ControlLogic');
  }

  ChangeState(toState) {
    const z = this.zoomFactor;
    switch (toState) {
      case BodyState.Air: this.springiness = 4; this.tempF = 50 * z; this.heightOffset = 0; break;
      case BodyState.Turning: this.tempF = 50; this.springiness = 1; break;
      case BodyState.Swinging: this.springiness = 4; this.tempF = 45 * z; this.heightOffset = 0; break;
      case BodyState.Still:
        if (this.cameraSubState === CameraSubState.None) {
          this.springiness = 2;
          this.tempF = 40 * z;
        } else if (this.cameraSubState === CameraSubState.Phase1) {
          this.springiness = 1;
          this.tempF = 20 * z;
        }
        break;
      case BodyState.Hanging: this.springiness = 2; this.tempF = 40 * z; this.heightOffset = 0; break;
    }
    this.orthographicSize = this.tempF;
    this.state = toState;
    this.timeStateStarted = this.Time.time;
  }

  DoUpdate() {
    if (this.override) {
      return;
    }
    const body = this.bodyBehaviour;
    if (!this.controlLogic) {
      this.controlLogic = this.GetComponent('ControlLogic');
    }
    if (body.bodyState !== this.state) {
      this.cameraSubState = CameraSubState.None;
      this.ChangeState(body.bodyState);
    }
    this.horizontalOffset = 0;
    this.heightOffset = 0;
    this.staticCamera = false;
    const cl = this.controlLogic;
    if (!cl) {
      return;
    }
    if (body.bodyState === BodyState.Still) {
      if (this.Time.time - this.timeStateStarted > 3 && this.cameraSubState === CameraSubState.None) {
        this.cameraSubState = CameraSubState.Phase1;
        this.ChangeState(body.bodyState);
      }
      this.heightOffset = cl.inputV > 0 ? 10 : -9;
      if (this.cameraSubState === CameraSubState.Phase1) {
        this.heightOffset = cl.inputV > 0 ? 3 : -2;
      }
    } else if (body.bodyState === BodyState.Hanging) {
      this.heightOffset = cl.inputV > 0 ? 10 : -9;
    }
  }

  CancelOverride() {
    this.override = false;
    this.DoUpdate();
  }

  SetOverride(o) {
    this.SetData(o);
    this.override = true;
  }
}

export class CameraDirectionOverride extends CameraTargetAttributes {
  OnTriggerEnter(other) {
    const t = other.gameObject.GetComponent('CreatureCameraTargetAttributes');
    if (t) {
      t.SetOverride(this);
    } else {
      this.IgnoreCollision(other, this.collider);
    }
  }

  OnTriggerExit(other) {
    const t = other.gameObject.GetComponent('CreatureCameraTargetAttributes');
    if (t) {
      t.CancelOverride();
    }
  }
}
