import * as THREE from 'three';
import { CHART } from './Chart';
import { CONFIG } from './config';
import { Track } from './Track';
import type {
  JudgementEvent,
  JudgementLabel,
  LaserChartNote,
  NoteCueEvent,
  SwingChartNote,
  TapChartNote,
} from './types';

interface TapRuntime {
  note: TapChartNote;
  group: THREE.Group;
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  hitTarget: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  approach: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shell: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  resolved: boolean;
  prepareCued: boolean;
  readyCued: boolean;
}

interface LaserRuntime {
  note: LaserChartNote;
  group: THREE.Group;
  railOuter: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  tube: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  railGlow: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
  head: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  hitTarget: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  approach: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  ballOutline: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  startMarker: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  endMarker: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  shell: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  resolved: boolean;
  started: boolean;
  startQuality: number;
  trackedTime: number;
  directedDragDistance: number;
  offPathTime: number;
  dragging: boolean;
  prepareCued: boolean;
  readyCued: boolean;
  releasePrepareCued: boolean;
  releaseReadyCued: boolean;
}

interface SwingRuntime {
  note: SwingChartNote;
  group: THREE.Group;
  anchor: THREE.Mesh<THREE.OctahedronGeometry, THREE.MeshStandardMaterial>;
  hitTarget: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  approach: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  shell: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  light: THREE.PointLight;
  resolved: boolean;
  started: boolean;
  startQuality: number;
  holdTime: number;
  prepareCued: boolean;
  readyCued: boolean;
  releasePrepareCued: boolean;
  releaseReadyCued: boolean;
}

interface Burst {
  group: THREE.Group;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  particles: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  age: number;
  strength: number;
}

export interface ActionResult {
  hit: boolean;
  point: THREE.Vector3;
  message: string;
}

export interface ActiveSwingState {
  anchor: THREE.Vector3;
  side: -1 | 1;
  progress: number;
}

function timingLabel(delta: number): JudgementLabel {
  const error = Math.abs(delta);
  if (error <= CONFIG.perfectWindow) return 'PERFECT';
  if (error <= CONFIG.greatWindow) return 'GREAT';
  if (error <= CONFIG.goodWindow) return 'GOOD';
  if (error <= CONFIG.badWindow) return 'BAD';
  return 'MISS';
}

function timingQuality(delta: number): number {
  const label = timingLabel(delta);
  if (label === 'PERFECT') return 1;
  if (label === 'GREAT') return 0.84;
  if (label === 'GOOD') return 0.66;
  if (label === 'BAD') return 0.4;
  return 0;
}

function labelFromQuality(quality: number): JudgementLabel {
  if (quality >= 0.9) return 'PERFECT';
  if (quality >= 0.76) return 'GREAT';
  if (quality >= 0.56) return 'GOOD';
  if (quality >= 0.3) return 'BAD';
  return 'MISS';
}

function pointsForLabel(label: JudgementLabel): number {
  if (label === 'PERFECT') return 1000;
  if (label === 'GREAT') return 800;
  if (label === 'GOOD') return 550;
  if (label === 'BAD') return 250;
  return 0;
}

export class NoteSystem {
  private readonly taps: TapRuntime[] = [];
  private readonly lasers: LaserRuntime[] = [];
  private readonly swings: SwingRuntime[] = [];
  private readonly bursts: Burst[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly screenCenter = new THREE.Vector2();
  private readonly fallbackPoint = new THREE.Vector3();
  private readonly dragScreenNow = new THREE.Vector3();
  private readonly dragScreenNext = new THREE.Vector3();
  private readonly dragWorldNext = new THREE.Vector3();
  private readonly expectedDragDirection = new THREE.Vector2();
  private readonly inputDragDirection = new THREE.Vector2();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly track: Track,
    private readonly onJudgement: (event: JudgementEvent) => void,
    private readonly onCue: (event: NoteCueEvent) => void,
  ) {
    this.raycaster.far = CONFIG.shotRange;
    for (const note of CHART) {
      if (note.kind === 'tap') this.createTap(note);
      if (note.kind === 'laser') this.createLaser(note);
      if (note.kind === 'swing') this.createSwing(note);
    }
  }

  reset(): void {
    for (const tap of this.taps) {
      tap.resolved = false;
      tap.prepareCued = false;
      tap.readyCued = false;
      tap.group.visible = false;
    }
    for (const laser of this.lasers) {
      laser.resolved = false;
      laser.started = false;
      laser.startQuality = 0;
      laser.trackedTime = 0;
      laser.directedDragDistance = 0;
      laser.offPathTime = 0;
      laser.dragging = false;
      laser.prepareCued = false;
      laser.readyCued = false;
      laser.releasePrepareCued = false;
      laser.releaseReadyCued = false;
      laser.group.visible = false;
    }
    for (const swing of this.swings) {
      swing.resolved = false;
      swing.started = false;
      swing.startQuality = 0;
      swing.holdTime = 0;
      swing.prepareCued = false;
      swing.readyCued = false;
      swing.releasePrepareCued = false;
      swing.releaseReadyCued = false;
      swing.group.visible = false;
    }
    for (const burst of this.bursts) this.scene.remove(burst.group);
    this.bursts.length = 0;
  }

  update(
    time: number,
    dt: number,
    camera: THREE.Camera,
    rightHeld: boolean,
    leftHeld: boolean,
    dragMotion: THREE.Vector2,
  ): void {
    this.updateTaps(time, camera);
    this.updateLasers(time, dt, camera, rightHeld, dragMotion);
    this.updateSwings(time, dt, camera, leftHeld);
    this.updateBursts(dt, camera);
  }

  pressRight(camera: THREE.Camera, time: number): ActionResult {
    const rayPoint = this.getFallbackPoint(camera);
    const activeLaser = this.lasers.find((laser) => laser.started && !laser.resolved);
    if (activeLaser) {
      return { hit: true, point: activeLaser.head.position.clone(), message: 'SLIDER TRACK' };
    }

    const laserHits = this.getIntersections(
      camera,
      this.lasers
        .filter((laser) => !laser.resolved && laser.group.visible)
        .map((laser) => laser.hitTarget),
    );
    const laserHit = laserHits[0];
    if (laserHit) {
      const runtime = this.lasers.find((laser) => laser.hitTarget === laserHit.object);
      if (runtime) {
        const delta = time - runtime.note.time;
        if (Math.abs(delta) <= CONFIG.badWindow) {
          runtime.started = true;
          runtime.startQuality = timingQuality(delta);
          return { hit: true, point: runtime.head.position.clone(), message: 'SLIDER LOCK' };
        }
        return { hit: false, point: runtime.head.position.clone(), message: delta < 0 ? 'WAIT FOR RING' : 'TOO LATE' };
      }
    }

    const tapHits = this.getIntersections(
      camera,
      this.taps.filter((tap) => !tap.resolved && tap.group.visible).map((tap) => tap.hitTarget),
    );
    const tapHit = tapHits[0];
    if (!tapHit) return { hit: false, point: rayPoint, message: 'EMPTY SHOT' };
    const runtime = this.taps.find((tap) => tap.hitTarget === tapHit.object);
    if (!runtime) return { hit: false, point: rayPoint, message: 'EMPTY SHOT' };
    const delta = time - runtime.note.time;
    if (Math.abs(delta) > CONFIG.badWindow) {
      return {
        hit: false,
        point: runtime.group.position.clone(),
        message: delta < 0 ? 'WAIT FOR RING' : 'TOO LATE',
      };
    }
    const label = timingLabel(delta);
    runtime.resolved = true;
    runtime.group.visible = false;
    this.createBurst(runtime.group.position, 0xff3f82, this.impactStrength(label));
    this.onJudgement({ label, points: pointsForLabel(label), timingDelta: delta, kind: 'tap' });
    return { hit: true, point: runtime.group.position.clone(), message: label };
  }

  releaseRight(time: number): void {
    const active = this.lasers.find((laser) => laser.started && !laser.resolved);
    if (active) this.finalizeLaser(active, time);
  }

  pressLeft(camera: THREE.Camera, time: number): ActionResult {
    const hits = this.getIntersections(
      camera,
      this.swings.filter((swing) => !swing.resolved && swing.group.visible).map((swing) => swing.hitTarget),
    );
    const hit = hits[0];
    if (!hit) return { hit: false, point: this.getFallbackPoint(camera), message: 'NO ANCHOR' };
    const runtime = this.swings.find((swing) => swing.hitTarget === hit.object);
    if (!runtime) return { hit: false, point: this.getFallbackPoint(camera), message: 'NO ANCHOR' };
    const delta = time - runtime.note.time;
    if (Math.abs(delta) > CONFIG.badWindow) {
      return {
        hit: false,
        point: runtime.group.position.clone(),
        message: delta < 0 ? 'WAIT FOR RING' : 'TOO LATE',
      };
    }
    runtime.started = true;
    runtime.startQuality = timingQuality(delta);
    return { hit: true, point: runtime.group.position.clone(), message: 'WEB LOCK' };
  }

  releaseLeft(time: number): void {
    const active = this.swings.find((swing) => swing.started && !swing.resolved);
    if (active) this.finalizeSwing(active, time);
  }

  hasAim(camera: THREE.Camera, time: number): boolean {
    const targets: THREE.Object3D[] = [];
    for (const tap of this.taps) {
      if (!tap.resolved && tap.group.visible && Math.abs(time - tap.note.time) <= CONFIG.badWindow) {
        targets.push(tap.hitTarget);
      }
    }
    for (const laser of this.lasers) {
      if (!laser.resolved && laser.group.visible && (laser.started || Math.abs(time - laser.note.time) <= CONFIG.badWindow)) {
        targets.push(laser.hitTarget);
      }
    }
    for (const swing of this.swings) {
      if (!swing.resolved && swing.group.visible && (swing.started || Math.abs(time - swing.note.time) <= CONFIG.badWindow)) {
        targets.push(swing.hitTarget);
      }
    }
    return this.getIntersections(camera, targets).length > 0;
  }

  getActiveSwing(time: number): ActiveSwingState | null {
    const active = this.swings.find((swing) => swing.started && !swing.resolved);
    if (!active) return null;
    return {
      anchor: active.group.position.clone(),
      side: active.note.side,
      progress: THREE.MathUtils.clamp((time - active.note.time) / active.note.duration, 0, 1),
    };
  }

  isLaserActive(): boolean {
    return this.lasers.some((laser) => laser.started && !laser.resolved);
  }

  isLaserDragging(): boolean {
    return this.lasers.some((laser) => laser.started && !laser.resolved && laser.dragging);
  }

  getTotalNotes(): number {
    return CHART.length;
  }

  getNearestTimingDelta(time: number): number | null {
    let nearest: number | null = null;
    const consider = (delta: number): void => {
      if (delta < -CONFIG.badWindow || delta > CONFIG.notePrepareCueTime) return;
      if (nearest === null || Math.abs(delta) < Math.abs(nearest)) nearest = delta;
    };
    for (const tap of this.taps) if (!tap.resolved) consider(tap.note.time - time);
    for (const laser of this.lasers) {
      if (laser.resolved) continue;
      consider((laser.started ? laser.note.time + laser.note.duration : laser.note.time) - time);
    }
    for (const swing of this.swings) {
      if (swing.resolved) continue;
      consider((swing.started ? swing.note.time + swing.note.duration : swing.note.time) - time);
    }
    return nearest;
  }

  private updateTaps(time: number, camera: THREE.Camera): void {
    for (const runtime of this.taps) {
      const timeToHit = runtime.note.time - time;
      if (!runtime.resolved && time > runtime.note.time + CONFIG.badWindow) {
        runtime.resolved = true;
        runtime.group.visible = false;
        this.onJudgement({ label: 'MISS', points: 0, timingDelta: time - runtime.note.time, kind: 'tap' });
        continue;
      }
      runtime.group.visible = !runtime.resolved
        && timeToHit <= CONFIG.noteApproachTime
        && timeToHit >= -CONFIG.noteCullAfter;
      if (!runtime.group.visible) continue;
      if (!runtime.prepareCued && timeToHit <= CONFIG.notePrepareCueTime) {
        runtime.prepareCued = true;
        this.onCue({ kind: 'tap', stage: 'prepare', pan: this.panForLane(runtime.note.lane) });
      }
      if (!runtime.readyCued && timeToHit <= CONFIG.noteReadyCueTime) {
        runtime.readyCued = true;
        this.onCue({ kind: 'tap', stage: 'ready', pan: this.panForLane(runtime.note.lane) });
      }
      runtime.group.quaternion.copy(camera.quaternion);
      const approach = THREE.MathUtils.clamp(timeToHit / CONFIG.noteApproachTime, 0, 1);
      runtime.approach.scale.setScalar(1 + approach * 2.4);
      runtime.approach.material.opacity = 0.34 + (1 - approach) * 0.66;
      this.applyTimingVisual(
        runtime.core,
        runtime.approach,
        runtime.shell,
        runtime.light,
        timeToHit,
        0xff3979,
        time,
      );
    }
  }

  private updateLasers(
    time: number,
    dt: number,
    camera: THREE.Camera,
    rightHeld: boolean,
    dragMotion: THREE.Vector2,
  ): void {
    for (const runtime of this.lasers) {
      runtime.dragging = false;
      const endTime = runtime.note.time + runtime.note.duration;
      if (!runtime.started && !runtime.resolved && time > runtime.note.time + CONFIG.badWindow) {
        runtime.resolved = true;
        runtime.group.visible = false;
        this.onJudgement({ label: 'MISS', points: 0, timingDelta: time - runtime.note.time, kind: 'laser' });
        continue;
      }
      if (runtime.started && !runtime.resolved && time >= endTime) {
        this.finalizeLaser(runtime, endTime);
        continue;
      }
      runtime.group.visible = !runtime.resolved
        && time >= runtime.note.time - CONFIG.noteApproachTime
        && time <= endTime + CONFIG.noteCullAfter;
      if (!runtime.group.visible) continue;
      const sampleTime = THREE.MathUtils.clamp(time, runtime.note.time, endTime);
      this.getLaserPoint(runtime.note, sampleTime, runtime.head.position);
      runtime.head.quaternion.copy(camera.quaternion);
      runtime.startMarker.quaternion.copy(camera.quaternion);
      runtime.endMarker.quaternion.copy(camera.quaternion);
      const insideFollowCircle = runtime.started && this.isInsideLaserFollowCircle(runtime, camera);
      if (runtime.started) {
        runtime.offPathTime = insideFollowCircle ? 0 : runtime.offPathTime + dt;
        if (runtime.offPathTime >= 0.06) {
          this.failLaser(runtime, time);
          continue;
        }
      }
      const timeToStart = runtime.note.time - time;
      if (!runtime.started && !runtime.prepareCued && timeToStart <= CONFIG.notePrepareCueTime) {
        runtime.prepareCued = true;
        this.onCue({ kind: 'laser', stage: 'prepare', pan: this.panForLane(runtime.note.lane) });
      }
      if (!runtime.started && !runtime.readyCued && timeToStart <= CONFIG.noteReadyCueTime) {
        runtime.readyCued = true;
        this.onCue({ kind: 'laser', stage: 'ready', pan: this.panForLane(runtime.note.lane) });
      }
      const timeToRelease = endTime - time;
      if (runtime.started && !runtime.releasePrepareCued && timeToRelease <= CONFIG.notePrepareCueTime) {
        runtime.releasePrepareCued = true;
        this.onCue({ kind: 'laser', stage: 'release-prepare', pan: this.panForLane(runtime.note.endLane) });
      }
      if (runtime.started && !runtime.releaseReadyCued && timeToRelease <= CONFIG.noteReadyCueTime) {
        runtime.releaseReadyCued = true;
        this.onCue({ kind: 'laser', stage: 'release-ready', pan: this.panForLane(runtime.note.endLane) });
      }
      const approach = THREE.MathUtils.clamp(timeToStart / CONFIG.noteApproachTime, 0, 1);
      runtime.approach.scale.setScalar(1 + approach * 2.6);
      runtime.approach.material.opacity = runtime.started ? 0 : 0.42 + (1 - approach) * 0.58;
      runtime.railOuter.material.opacity = runtime.started ? 1 : 0.88;
      runtime.tube.material.opacity = runtime.started ? 0.96 : 0.82;
      runtime.railGlow.material.opacity = runtime.started ? 0.64 : 0.34;
      runtime.startMarker.material.opacity = runtime.started ? 0.34 : 0.86;
      runtime.endMarker.material.opacity = runtime.started ? 0.78 : 0.66;
      const visualDelta = runtime.started ? timeToRelease : timeToStart;
      this.applyTimingVisual(
        runtime.head,
        runtime.approach,
        runtime.shell,
        runtime.light,
        visualDelta,
        0xff5eae,
        time,
      );
      if (runtime.started) runtime.shell.material.opacity = 0;
      const dragDistance = dragMotion.length();
      const directionQuality = this.getLaserDragDirectionQuality(runtime, time, camera, dragMotion);
      const directionalDrag = dragDistance >= 0.35 && directionQuality >= 0.25;
      const tracking = insideFollowCircle && rightHeld && directionalDrag;
      runtime.dragging = tracking;
      runtime.tube.material.color.setHex(tracking ? 0xffa3dc : 0xd94194);
      runtime.railGlow.material.color.setHex(tracking ? 0xffffff : 0xff58ad);
      runtime.ballOutline.material.color.setHex(tracking ? 0x8dffd1 : 0xfff0f8);
      if (runtime.started) runtime.head.material.color.setHex(tracking ? 0x75ffc2 : 0xff5eae);
      if (runtime.started && time >= runtime.note.time && time <= endTime && rightHeld) {
        if (insideFollowCircle) runtime.trackedTime += dt;
        if (tracking) runtime.directedDragDistance += dragDistance * directionQuality;
      }
    }
  }

  private updateSwings(
    time: number,
    dt: number,
    camera: THREE.Camera,
    leftHeld: boolean,
  ): void {
    for (const runtime of this.swings) {
      const endTime = runtime.note.time + runtime.note.duration;
      if (!runtime.started && !runtime.resolved && time > runtime.note.time + CONFIG.badWindow) {
        runtime.resolved = true;
        runtime.group.visible = false;
        this.onJudgement({ label: 'MISS', points: 0, timingDelta: time - runtime.note.time, kind: 'swing' });
        continue;
      }
      if (runtime.started && !runtime.resolved && time > endTime + CONFIG.badWindow) {
        this.finalizeSwing(runtime, time);
      }
      runtime.group.visible = !runtime.resolved
        && time >= runtime.note.time - CONFIG.noteApproachTime
        && time <= endTime + CONFIG.noteCullAfter;
      if (!runtime.group.visible) continue;
      runtime.group.quaternion.copy(camera.quaternion);
      const timeToStart = runtime.note.time - time;
      if (!runtime.started && !runtime.prepareCued && timeToStart <= CONFIG.notePrepareCueTime) {
        runtime.prepareCued = true;
        this.onCue({ kind: 'swing', stage: 'prepare', pan: this.panForLane(runtime.note.lane) });
      }
      if (!runtime.started && !runtime.readyCued && timeToStart <= CONFIG.noteReadyCueTime) {
        runtime.readyCued = true;
        this.onCue({ kind: 'swing', stage: 'ready', pan: this.panForLane(runtime.note.lane) });
      }
      const timeToRelease = endTime - time;
      if (runtime.started && !runtime.releasePrepareCued && timeToRelease <= CONFIG.notePrepareCueTime) {
        runtime.releasePrepareCued = true;
        this.onCue({ kind: 'swing', stage: 'release-prepare', pan: this.panForLane(runtime.note.lane) });
      }
      if (runtime.started && !runtime.releaseReadyCued && timeToRelease <= CONFIG.noteReadyCueTime) {
        runtime.releaseReadyCued = true;
        this.onCue({ kind: 'swing', stage: 'release-ready', pan: this.panForLane(runtime.note.lane) });
      }
      const approach = THREE.MathUtils.clamp(timeToStart / CONFIG.noteApproachTime, 0, 1);
      runtime.approach.scale.setScalar(1 + approach * 2.7);
      runtime.approach.material.opacity = runtime.started ? 1 : 0.35 + (1 - approach) * 0.65;
      this.applyTimingVisual(
        runtime.anchor,
        runtime.approach,
        runtime.shell,
        runtime.light,
        runtime.started ? timeToRelease : timeToStart,
        0x55f7ff,
        time,
      );
      runtime.anchor.rotation.z += dt * 1.4;
      if (runtime.started && time >= runtime.note.time && time <= endTime && leftHeld) {
        runtime.holdTime += dt;
      }
    }
  }

  private finalizeLaser(runtime: LaserRuntime, time: number): void {
    const endTime = runtime.note.time + runtime.note.duration;
    const tracking = THREE.MathUtils.clamp(runtime.trackedTime / runtime.note.duration, 0, 1);
    const requiredDragDistance = 120 + runtime.note.duration * 40;
    const directedDrag = THREE.MathUtils.clamp(
      runtime.directedDragDistance / requiredDragDistance,
      0,
      1,
    );
    const baseQuality = runtime.startQuality * 0.15 + tracking * 0.55 + directedDrag * 0.3;
    const quality = directedDrag < 0.18
      ? 0
      : baseQuality * (0.3 + directedDrag * 0.7);
    const label = labelFromQuality(quality);
    runtime.resolved = true;
    runtime.group.visible = false;
    this.createBurst(runtime.head.position, 0xff58ad, this.impactStrength(label));
    this.onJudgement({ label, points: Math.round(quality * 1000), timingDelta: time - endTime, kind: 'laser' });
  }

  private failLaser(runtime: LaserRuntime, time: number): void {
    runtime.resolved = true;
    runtime.dragging = false;
    runtime.group.visible = false;
    this.createBurst(runtime.head.position, 0xff315f, 0.76);
    this.onJudgement({
      label: 'MISS',
      points: 0,
      timingDelta: time - (runtime.note.time + runtime.note.duration),
      kind: 'laser',
    });
  }

  private finalizeSwing(runtime: SwingRuntime, time: number): void {
    const endTime = runtime.note.time + runtime.note.duration;
    const holdRatio = THREE.MathUtils.clamp(runtime.holdTime / runtime.note.duration, 0, 1);
    const releaseQuality = timingQuality(time - endTime);
    const quality = runtime.startQuality * 0.35 + holdRatio * 0.4 + releaseQuality * 0.25;
    const label = labelFromQuality(quality);
    runtime.resolved = true;
    runtime.group.visible = false;
    this.createBurst(runtime.group.position, 0x58f6ff, this.impactStrength(label));
    this.onJudgement({ label, points: Math.round(quality * 1000), timingDelta: time - endTime, kind: 'swing' });
  }

  private createTap(note: TapChartNote): void {
    const group = new THREE.Group();
    group.position.copy(this.track.getNotePosition(note.time, note.lane, note.height));
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 20, 14),
      new THREE.MeshStandardMaterial({
        color: 0xff3979,
        emissive: 0xff174f,
        emissiveIntensity: 2.2,
        roughness: 0.28,
        metalness: 0.15,
      }),
    );
    const hitTarget = this.createAimVolume(2.8);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.42, 44),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.92, side: THREE.DoubleSide }),
    );
    const approach = new THREE.Mesh(
      new THREE.RingGeometry(1.55, 1.72, 52),
      new THREE.MeshBasicMaterial({ color: 0xff719d, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
    );
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.38, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffc247,
        wireframe: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const light = new THREE.PointLight(0xff3979, 0, 11, 2);
    group.add(core, hitTarget, inner, approach, shell, light);
    group.visible = false;
    this.scene.add(group);
    this.taps.push({
      note,
      group,
      core,
      hitTarget,
      approach,
      shell,
      light,
      resolved: false,
      prepareCued: false,
      readyCued: false,
    });
  }

  private createLaser(note: LaserChartNote): void {
    const points: THREE.Vector3[] = [];
    const samples = 32;
    for (let index = 0; index <= samples; index += 1) {
      const time = note.time + note.duration * (index / samples);
      points.push(this.getLaserPoint(note, time, new THREE.Vector3()));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const railOuter = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, 1.08, 16, false),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.88,
        depthWrite: false,
      }),
    );
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, 0.82, 16, false),
      new THREE.MeshBasicMaterial({
        color: 0xd94194,
        transparent: true,
        opacity: 0.82,
        depthWrite: false,
      }),
    );
    const railGlow = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 80, 0.28, 10, false),
      new THREE.MeshBasicMaterial({
        color: 0xff58ad,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    railOuter.renderOrder = 4;
    tube.renderOrder = 5;
    railGlow.renderOrder = 6;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(1.14, 22, 16),
      new THREE.MeshBasicMaterial({ color: 0xff5eae }),
    );
    head.position.copy(points[0]);
    head.renderOrder = 9;
    const hitTarget = this.createAimVolume(1.95);
    const approach = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.74, 52),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
    );
    const ballOutline = new THREE.Mesh(
      new THREE.SphereGeometry(1.36, 22, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.96,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    ballOutline.renderOrder = 8;
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.2, 1),
      new THREE.MeshBasicMaterial({
        color: 0xff6fbd,
        wireframe: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const light = new THREE.PointLight(0xff58ad, 0, 12, 2);
    const startMarker = this.createSliderMarker(points[0], 0xff4fa5);
    const endMarker = this.createSliderMarker(points[points.length - 1], 0xd45cff);
    startMarker.renderOrder = 7;
    endMarker.renderOrder = 7;
    head.add(hitTarget, approach, ballOutline, shell, light);
    const group = new THREE.Group();
    group.add(railOuter, tube, railGlow, startMarker, endMarker, head);
    group.visible = false;
    this.scene.add(group);
    this.lasers.push({
      note,
      group,
      railOuter,
      tube,
      railGlow,
      head,
      hitTarget,
      approach,
      ballOutline,
      startMarker,
      endMarker,
      shell,
      light,
      resolved: false,
      started: false,
      startQuality: 0,
      trackedTime: 0,
      directedDragDistance: 0,
      offPathTime: 0,
      dragging: false,
      prepareCued: false,
      readyCued: false,
      releasePrepareCued: false,
      releaseReadyCued: false,
    });
  }

  private createSliderMarker(
    position: THREE.Vector3,
    color: number,
  ): THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> {
    const marker = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 56),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const outline = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.78, 56),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    marker.position.copy(position);
    marker.add(outline);
    return marker;
  }

  private createSwing(note: SwingChartNote): void {
    const group = new THREE.Group();
    group.position.copy(this.track.getNotePosition(note.time, note.lane, note.height));
    const anchor = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.88, 0),
      new THREE.MeshStandardMaterial({
        color: 0x72faff,
        emissive: 0x25dceb,
        emissiveIntensity: 2.4,
        roughness: 0.24,
      }),
    );
    const hitTarget = this.createAimVolume(3.4);
    const inner = new THREE.Mesh(
      new THREE.RingGeometry(1.25, 1.42, 6),
      new THREE.MeshBasicMaterial({ color: 0xe1ffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    const approach = new THREE.Mesh(
      new THREE.RingGeometry(1.55, 1.72, 42),
      new THREE.MeshBasicMaterial({ color: 0x55f7ff, transparent: true, opacity: 0.82, side: THREE.DoubleSide, depthWrite: false, depthTest: false }),
    );
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.28, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffc247,
        wireframe: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const light = new THREE.PointLight(0x55f7ff, 0, 13, 2);
    group.add(anchor, hitTarget, inner, approach, shell, light);
    group.visible = false;
    this.scene.add(group);
    this.swings.push({
      note,
      group,
      anchor,
      hitTarget,
      approach,
      shell,
      light,
      resolved: false,
      started: false,
      startQuality: 0,
      holdTime: 0,
      prepareCued: false,
      readyCued: false,
      releasePrepareCued: false,
      releaseReadyCued: false,
    });
  }

  private getLaserPoint(note: LaserChartNote, time: number, target: THREE.Vector3): THREE.Vector3 {
    const progress = THREE.MathUtils.clamp((time - note.time) / note.duration, 0, 1);
    const lane = THREE.MathUtils.lerp(note.lane, note.endLane, progress)
      + Math.sin(progress * Math.PI * 2) * note.wave;
    const verticalRange = 1.7 + Math.abs(note.wave) * 0.55;
    const height = note.height
      + Math.sin(progress * Math.PI * 2) * verticalRange
      + Math.sin(progress * Math.PI) * 1.2;
    return this.track.getNotePosition(time, lane, height, target);
  }

  private getLaserDragDirectionQuality(
    runtime: LaserRuntime,
    time: number,
    camera: THREE.Camera,
    dragMotion: THREE.Vector2,
  ): number {
    if (dragMotion.lengthSq() < 0.12) return 0;
    const endTime = runtime.note.time + runtime.note.duration;
    const nextTime = Math.min(endTime, time + 0.075);
    this.dragScreenNow.copy(runtime.head.position).project(camera);
    this.getLaserPoint(runtime.note, nextTime, this.dragWorldNext);
    this.dragScreenNext.copy(this.dragWorldNext).project(camera);
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
    this.expectedDragDirection.set(
      (this.dragScreenNext.x - this.dragScreenNow.x) * aspect,
      this.dragScreenNow.y - this.dragScreenNext.y,
    );
    if (this.expectedDragDirection.lengthSq() < 0.000001) return 1;
    this.expectedDragDirection.normalize();
    this.inputDragDirection.copy(dragMotion).normalize();
    const alignment = this.expectedDragDirection.dot(this.inputDragDirection);
    return THREE.MathUtils.clamp((alignment + 0.2) / 1.2, 0, 1);
  }

  private isInsideLaserFollowCircle(runtime: LaserRuntime, camera: THREE.Camera): boolean {
    this.dragScreenNow.copy(runtime.head.position).project(camera);
    if (this.dragScreenNow.z < -1 || this.dragScreenNow.z > 1) return false;
    const offsetX = this.dragScreenNow.x * window.innerWidth * 0.5;
    const offsetY = this.dragScreenNow.y * window.innerHeight * 0.5;
    return Math.hypot(offsetX, offsetY) <= 58;
  }

  private createAimVolume(radius: number): THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> {
    return new THREE.Mesh(
      new THREE.SphereGeometry(radius, 10, 8),
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    );
  }

  private getIntersections(camera: THREE.Camera, objects: THREE.Object3D[]): THREE.Intersection[] {
    if (objects.length === 0) return [];
    this.raycaster.setFromCamera(this.screenCenter, camera);
    return this.raycaster.intersectObjects(objects, false);
  }

  private getFallbackPoint(camera: THREE.Camera): THREE.Vector3 {
    this.raycaster.setFromCamera(this.screenCenter, camera);
    return this.fallbackPoint.copy(this.raycaster.ray.origin)
      .addScaledVector(this.raycaster.ray.direction, 42)
      .clone();
  }

  private panForLane(lane: number): number {
    return THREE.MathUtils.clamp(lane / 7, -0.85, 0.85);
  }

  private impactStrength(label: JudgementLabel): number {
    if (label === 'PERFECT') return 1.5;
    if (label === 'GREAT') return 1.22;
    if (label === 'GOOD') return 1;
    return 0.76;
  }

  private applyTimingVisual(
    core: THREE.Mesh,
    approach: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>,
    shell: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>,
    light: THREE.PointLight,
    timeToHit: number,
    baseColor: number,
    time: number,
  ): void {
    const error = Math.abs(timeToHit);
    const color = new THREE.Color(baseColor);
    let readiness = 0;
    let pulse = 0;

    if (timeToHit <= CONFIG.notePrepareCueTime) {
      readiness = THREE.MathUtils.clamp(
        1 - Math.max(0, timeToHit - CONFIG.badWindow)
          / (CONFIG.notePrepareCueTime - CONFIG.badWindow),
        0,
        1,
      );
      color.lerp(new THREE.Color(0xffbd3f), 0.72 + readiness * 0.28);
    }
    if (timeToHit <= CONFIG.badWindow && timeToHit >= -CONFIG.badWindow) {
      if (error <= CONFIG.perfectWindow) {
        color.setHex(0xffffff);
        pulse = 1;
      } else if (timeToHit >= 0) {
        color.setHex(0x70ffb3);
        pulse = 1 - error / CONFIG.badWindow;
      } else {
        color.setHex(0xff784f);
        pulse = 1 - error / CONFIG.badWindow;
      }
      readiness = 1;
    }

    const material = core.material;
    if (!Array.isArray(material)) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.copy(color);
        material.emissive.copy(color);
        material.emissiveIntensity = 1.8 + readiness * 3.8 + pulse * 2.4;
      } else if (material instanceof THREE.MeshBasicMaterial) {
        material.color.copy(color);
      }
    }
    approach.material.color.copy(color);
    shell.material.color.copy(color);
    const rhythmicPulse = Math.max(0, Math.sin(time * 28)) * 0.07 * readiness;
    core.scale.setScalar(1 + readiness * 0.12 + pulse * 0.2 + rhythmicPulse);
    shell.scale.setScalar(1 + readiness * 0.14 + rhythmicPulse * 1.8);
    shell.material.opacity = readiness * (0.25 + pulse * 0.65);
    light.color.copy(color);
    light.intensity = readiness * (3 + pulse * 12);
  }

  private createBurst(position: THREE.Vector3, color: number, strength: number): void {
    const group = new THREE.Group();
    group.position.copy(position);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.05, 38),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.72, 12, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const particleCount = Math.round(24 + strength * 16);
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3;
      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.5,
        Math.random() - 0.5,
      ).normalize();
      const speed = (5 + Math.random() * 11) * strength;
      velocities[offset] = direction.x * speed;
      velocities[offset + 1] = direction.y * speed;
      velocities[offset + 2] = direction.z * speed;
    }
    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particles = new THREE.Points(
      particleGeometry,
      new THREE.PointsMaterial({
        color,
        size: 0.22 * strength,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(ring, flash, particles);
    this.scene.add(group);
    this.bursts.push({ group, ring, flash, particles, velocities, age: 0, strength });
  }

  private updateBursts(dt: number, camera: THREE.Camera): void {
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      burst.age += dt;
      const progress = Math.min(1, burst.age / 0.5);
      burst.ring.quaternion.copy(camera.quaternion);
      burst.ring.scale.setScalar(1 + progress * 7 * burst.strength);
      burst.flash.scale.setScalar(1 + progress * 3.2 * burst.strength);
      burst.ring.material.opacity = (1 - progress) * 0.92;
      burst.flash.material.opacity = (1 - progress) * 0.68;
      const positions = burst.particles.geometry.attributes.position as THREE.BufferAttribute;
      for (let particle = 0; particle < positions.count; particle += 1) {
        const offset = particle * 3;
        positions.setXYZ(
          particle,
          positions.getX(particle) + burst.velocities[offset] * dt,
          positions.getY(particle) + burst.velocities[offset + 1] * dt,
          positions.getZ(particle) + burst.velocities[offset + 2] * dt,
        );
      }
      positions.needsUpdate = true;
      burst.particles.material.opacity = 1 - progress;
      if (progress < 1) continue;
      this.scene.remove(burst.group);
      burst.ring.geometry.dispose();
      burst.ring.material.dispose();
      burst.flash.geometry.dispose();
      burst.flash.material.dispose();
      burst.particles.geometry.dispose();
      burst.particles.material.dispose();
      this.bursts.splice(index, 1);
    }
  }
}
