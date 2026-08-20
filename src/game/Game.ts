import * as THREE from 'three';
import { AudioSystem } from './AudioSystem';
import { City } from './City';
import { CONFIG } from './config';
import { NoteSystem } from './NoteSystem';
import { Track } from './Track';
import type { JudgementEvent, JudgementLabel, NoteCueEvent } from './types';

interface HudElements {
  score: HTMLElement;
  combo: HTMLElement;
  accuracy: HTMLElement;
  timer: HTMLElement;
  progress: HTMLElement;
  reticle: HTMLElement;
  feedback: HTMLElement;
  timingCue: HTMLElement;
  timingCueLabel: HTMLElement;
  impactFlash: HTMLElement;
  overlay: HTMLElement;
  overlayEyebrow: HTMLElement;
  overlayTitle: HTMLElement;
  overlayCopy: HTMLElement;
  summary: HTMLElement;
  startButton: HTMLButtonElement;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`필수 화면 요소를 찾을 수 없습니다: #${id}`);
  return element as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(92, window.innerWidth / window.innerHeight, 0.08, 1600);
  private readonly track = new Track();
  private readonly notes: NoteSystem;
  private readonly audio = new AudioSystem();
  private readonly hud: HudElements;

  private readonly weaponRig = new THREE.Group();
  private readonly leftMuzzle = new THREE.Object3D();
  private readonly rightMuzzle = new THREE.Object3D();
  private readonly rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.045, 1, 7),
    new THREE.MeshBasicMaterial({
      color: 0x66f8ff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  private readonly laserBeam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.11, 1, 8),
    new THREE.MeshBasicMaterial({
      color: 0xff63b5,
      transparent: true,
      opacity: 0.84,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  private readonly tracer = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.075, 1, 7),
    new THREE.MeshBasicMaterial({
      color: 0xff6d9d,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  private readonly muzzleFlash = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.12, 0),
    new THREE.MeshBasicMaterial({
      color: 0xffe9b0,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  private readonly ropeUp = new THREE.Vector3(0, 1, 0);
  private readonly visualStart = new THREE.Vector3();
  private readonly visualDelta = new THREE.Vector3();
  private readonly laserEnd = new THREE.Vector3();
  private readonly swingOffset = new THREE.Vector3();
  private readonly swingVelocity = new THREE.Vector3();
  private readonly desiredSwingOffset = new THREE.Vector3();
  private readonly cameraBase = new THREE.Vector3();
  private readonly frameDragMotion = new THREE.Vector2();

  private running = false;
  private starting = false;
  private elapsed = 0;
  private lastFrameTime = performance.now();
  private yawOffset = 0;
  private pitch = -0.04;
  private leftHeld = false;
  private rightHeld = false;
  private tracerLife = 0;
  private muzzleLife = 0;
  private recoil = 0;
  private cameraShake = 0;
  private impactFov = 0;
  private score = 0;
  private earnedPoints = 0;
  private resolvedNotes = 0;
  private combo = 0;
  private maxCombo = 0;
  private readonly judgementCounts: Record<JudgementLabel, number> = {
    PERFECT: 0,
    GREAT: 0,
    GOOD: 0,
    BAD: 0,
    MISS: 0,
  };

  constructor(root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.44;
    this.renderer.domElement.setAttribute('aria-label', 'SWING BEAT 3D rhythm prototype');
    root.prepend(this.renderer.domElement);

    this.scene.background = this.createSkyTexture();
    this.scene.fog = new THREE.FogExp2(0x173247, 0.0062);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.addLights();
    new City(this.scene, this.track);

    this.hud = this.collectHud();
    this.notes = new NoteSystem(this.scene, this.track, this.handleJudgement, this.handleNoteCue);
    this.createWeaponRig();
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    this.laserBeam.visible = false;
    this.laserBeam.frustumCulled = false;
    this.muzzleFlash.visible = false;
    this.tracer.frustumCulled = false;
    this.scene.add(this.rope, this.laserBeam, this.tracer);

    this.bindEvents();
    this.updateCamera(0);
    this.updateHud();
    void this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setAnimationLoop(this.frame);
  }

  private readonly frame = (timestamp: number): void => {
    const dt = clamp((timestamp - this.lastFrameTime) / 1000, 0, 0.05);
    this.lastFrameTime = timestamp;
    if (this.running) {
      this.elapsed = this.audio.getChartTime();
      this.updateSwingMotion(dt);
      this.updateCamera(dt);
      this.notes.update(
        this.elapsed,
        dt,
        this.camera,
        this.rightHeld,
        this.leftHeld,
        this.frameDragMotion,
      );
      this.audio.setLaser(this.rightHeld && this.notes.isLaserActive());
      if (this.elapsed >= CONFIG.chartDuration) this.finishRun();
    } else {
      this.updateSwingMotion(dt);
      this.updateCamera(dt);
      this.notes.update(this.elapsed, 0, this.camera, false, false, this.frameDragMotion);
    }
    this.frameDragMotion.set(0, 0);
    this.updateWeaponEffects(dt);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  private updateSwingMotion(dt: number): void {
    const activeSwing = this.notes.getActiveSwing(this.elapsed);
    if (activeSwing && this.leftHeld) {
      const arc = Math.sin(activeSwing.progress * Math.PI);
      this.desiredSwingOffset.set(
        activeSwing.side * (6.5 + arc * 14.5),
        arc * 10.5,
        -Math.sin(activeSwing.progress * Math.PI * 2) * 3.8,
      );
      this.integrateSpring(this.desiredSwingOffset, CONFIG.swingSpring, CONFIG.swingDamping, dt);
    } else {
      this.desiredSwingOffset.set(0, 0, 0);
      this.integrateSpring(this.desiredSwingOffset, CONFIG.returnSpring, CONFIG.returnDamping, dt);
    }
  }

  private integrateSpring(target: THREE.Vector3, spring: number, damping: number, dt: number): void {
    this.visualDelta.copy(target).sub(this.swingOffset).multiplyScalar(spring * dt);
    this.swingVelocity.add(this.visualDelta);
    this.swingVelocity.multiplyScalar(Math.exp(-damping * dt));
    this.swingOffset.addScaledVector(this.swingVelocity, dt);
  }

  private updateCamera(dt: number): void {
    const basis = this.track.getBasis(this.elapsed);
    this.cameraBase.copy(basis.position)
      .addScaledVector(basis.right, this.swingOffset.x)
      .addScaledVector(basis.tangent, this.swingOffset.z);
    this.cameraBase.y += this.swingOffset.y;
    this.camera.position.copy(this.cameraBase);
    const flightShake = this.running ? 0.055 + Math.abs(Math.sin(this.elapsed * 13)) * 0.018 : 0;
    const shakeAmount = flightShake + this.cameraShake * this.cameraShake * 0.13;
    if (this.running) this.camera.position.y += Math.sin(this.elapsed * 17) * 0.045;
    this.camera.position.x += (Math.random() - 0.5) * shakeAmount;
    this.camera.position.y += (Math.random() - 0.5) * shakeAmount;
    this.camera.position.z += (Math.random() - 0.5) * shakeAmount;
    const heading = this.track.getHeading(this.elapsed);
    const routePitch = Math.asin(clamp(basis.tangent.y, -1, 1));
    const headingBefore = this.track.getHeading(Math.max(0, this.elapsed - 0.18));
    const headingAfter = this.track.getHeading(this.elapsed + 0.18);
    const headingDelta = Math.atan2(
      Math.sin(headingAfter - headingBefore),
      Math.cos(headingAfter - headingBefore),
    );
    const turnRoll = clamp(headingDelta * 6.8, -0.42, 0.42);
    const activeSwing = this.notes.getActiveSwing(this.elapsed);
    const swingRoll = activeSwing
      ? -activeSwing.side * Math.sin(activeSwing.progress * Math.PI) * 0.27
      : 0;
    const rotationShake = this.running ? 0.0018 + shakeAmount * 0.026 : shakeAmount * 0.018;
    this.camera.rotation.set(
      routePitch + this.pitch + (Math.random() - 0.5) * rotationShake,
      heading + this.yawOffset + (Math.random() - 0.5) * rotationShake,
      turnRoll + swingRoll + Math.sin(this.elapsed * 8) * 0.006 + this.swingOffset.x * -0.0025,
    );
    const swingEnergy = clamp(this.swingVelocity.length() / 18, 0, 1);
    const targetFov = 92 + swingEnergy * 9 + this.impactFov * 4.6;
    const nextFov = THREE.MathUtils.damp(this.camera.fov, targetFov, 7, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 17, dt);
    this.cameraShake = THREE.MathUtils.damp(this.cameraShake, 0, 11, dt);
    this.impactFov = THREE.MathUtils.damp(this.impactFov, 0, 9, dt);
    const rightDevice = this.weaponRig.getObjectByName('right-device');
    if (rightDevice) rightDevice.position.z = -0.66 + this.recoil * 0.2;
    const bob = this.running ? Math.sin(this.elapsed * 18) * 0.022 : 0;
    this.weaponRig.position.y = bob;
    this.weaponRig.position.x = this.running ? Math.cos(this.elapsed * 9) * 0.01 : 0;
  }

  private updateWeaponEffects(dt: number): void {
    this.camera.updateMatrixWorld();
    const swing = this.notes.getActiveSwing(this.elapsed);
    if (swing && this.leftHeld) {
      this.leftMuzzle.getWorldPosition(this.visualStart);
      this.setBeamTransform(this.rope, this.visualStart, swing.anchor);
      this.rope.visible = true;
    } else {
      this.rope.visible = false;
    }

    if (this.notes.isLaserActive() && this.rightHeld) {
      this.rightMuzzle.getWorldPosition(this.visualStart);
      this.camera.getWorldDirection(this.visualDelta);
      this.laserEnd.copy(this.camera.position).addScaledVector(this.visualDelta, CONFIG.shotRange * 0.75);
      this.setBeamTransform(this.laserBeam, this.visualStart, this.laserEnd);
      const pulse = 0.75 + Math.sin(this.elapsed * 45) * 0.18;
      (this.laserBeam.material as THREE.MeshBasicMaterial).opacity = pulse;
      this.laserBeam.visible = true;
    } else {
      this.laserBeam.visible = false;
    }

    this.tracerLife = Math.max(0, this.tracerLife - dt);
    const tracerMaterial = this.tracer.material as THREE.MeshBasicMaterial;
    tracerMaterial.opacity = clamp(this.tracerLife / 0.12, 0, 1);
    this.tracer.visible = this.tracerLife > 0;
    this.muzzleLife = Math.max(0, this.muzzleLife - dt);
    const muzzleMaterial = this.muzzleFlash.material as THREE.MeshBasicMaterial;
    muzzleMaterial.opacity = clamp(this.muzzleLife / 0.07, 0, 1);
    this.muzzleFlash.scale.setScalar(1 + (1 - clamp(this.muzzleLife / 0.07, 0, 1)) * 2.2);
    this.muzzleFlash.visible = this.muzzleLife > 0;
  }

  private setBeamTransform(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
    this.visualDelta.copy(end).sub(start);
    const length = this.visualDelta.length();
    if (length <= 0.001) return;
    mesh.position.copy(start).addScaledVector(this.visualDelta, 0.5);
    mesh.quaternion.setFromUnitVectors(this.ropeUp, this.visualDelta.normalize());
    mesh.scale.set(1, length, 1);
  }

  private showTracer(end: THREE.Vector3): void {
    this.camera.updateMatrixWorld();
    this.rightMuzzle.getWorldPosition(this.visualStart);
    this.setBeamTransform(this.tracer, this.visualStart, end);
    this.tracerLife = 0.12;
    this.tracer.visible = true;
  }

  private readonly handleJudgement = (event: JudgementEvent): void => {
    this.resolvedNotes += 1;
    this.earnedPoints += event.points;
    this.judgementCounts[event.label] += 1;
    if (event.label === 'MISS') {
      this.combo = 0;
    } else {
      this.combo += 1;
      this.maxCombo = Math.max(this.maxCombo, this.combo);
    }
    const comboMultiplier = 1 + Math.min(this.combo, 50) * 0.012;
    this.score += Math.round(event.points * comboMultiplier);
    const timing = Math.round(event.timingDelta * 1000);
    const sign = timing > 0 ? '+' : '';
    const impactStrength = event.label === 'PERFECT'
      ? 1.6
      : event.label === 'GREAT'
        ? 1.25
        : event.label === 'GOOD'
          ? 0.95
          : event.label === 'BAD'
            ? 0.6
            : 0.28;
    this.cameraShake = Math.max(this.cameraShake, impactStrength);
    this.impactFov = Math.max(this.impactFov, impactStrength);
    this.recoil = Math.max(this.recoil, impactStrength);
    this.hud.impactFlash.dataset.label = event.label;
    this.hud.impactFlash.classList.remove('pulse');
    void this.hud.impactFlash.offsetWidth;
    this.hud.impactFlash.classList.add('pulse');
    this.showFeedback(event.label, event.label === 'MISS' ? 'NOTE LOST' : `${sign}${timing} ms`);
    this.audio.judgement(event.label);
  };

  private readonly handleNoteCue = (event: NoteCueEvent): void => {
    this.audio.cue(event);
  };

  private showFeedback(label: string, detail: string): void {
    this.hud.feedback.innerHTML = `<strong>${label}</strong><span>${detail}</span>`;
    this.hud.feedback.dataset.label = label;
    this.hud.feedback.classList.remove('pulse');
    void this.hud.feedback.offsetWidth;
    this.hud.feedback.classList.add('pulse');
  }

  private requestPlay(): void {
    if (this.starting) return;
    this.audio.start();
    this.audio.stopMusic();
    this.audio.setJet(false);
    this.running = false;
    this.starting = true;
    document.body.classList.remove('playing');
    this.hud.overlayEyebrow.textContent = 'LOADING MUSIC CHART';
    this.hud.overlayTitle.innerHTML = 'TRACK<br><em>SYNC</em>';
    this.hud.overlayCopy.textContent = '140 BPM 음원을 불러오고 노트와 비행 코스를 같은 시계에 맞추는 중입니다.';
    this.hud.summary.classList.add('hidden');
    this.hud.startButton.disabled = true;
    this.hud.startButton.textContent = '음악 불러오는 중…';
    this.hud.overlay.classList.remove('hidden');
    const lockRequest = this.renderer.domElement.requestPointerLock();
    if (lockRequest instanceof Promise) void lockRequest.catch(() => undefined);
    void this.beginRun();
  }

  private async beginRun(): Promise<void> {
    try {
      await this.audio.startMusic();
      this.resetRunState();
      this.lastFrameTime = performance.now();
      this.running = true;
      document.body.classList.add('playing');
      this.audio.setJet(true);
      this.hud.overlay.classList.add('hidden');
      this.hud.feedback.innerHTML = '<strong>READY</strong><span>140 BPM // MUSIC SYNC</span>';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.audio.stopMusic();
      this.audio.setJet(false);
      this.hud.overlayEyebrow.textContent = 'AUDIO LOAD ERROR';
      this.hud.overlayTitle.innerHTML = '재생<br><em>실패</em>';
      this.hud.overlayCopy.textContent = message;
      this.hud.startButton.textContent = '다시 시도';
      this.hud.overlay.classList.remove('hidden');
      console.error(error);
    } finally {
      this.starting = false;
      this.hud.startButton.disabled = false;
    }
  }

  private resetRunState(): void {
    this.audio.reset();
    this.notes.reset();
    this.elapsed = 0;
    this.score = 0;
    this.earnedPoints = 0;
    this.resolvedNotes = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.yawOffset = 0;
    this.pitch = -0.04;
    this.swingOffset.set(0, 0, 0);
    this.swingVelocity.set(0, 0, 0);
    this.frameDragMotion.set(0, 0);
    this.recoil = 0;
    this.cameraShake = 0;
    this.impactFov = 0;
    this.tracerLife = 0;
    this.muzzleLife = 0;
    this.leftHeld = false;
    this.rightHeld = false;
    for (const label of Object.keys(this.judgementCounts) as JudgementLabel[]) {
      this.judgementCounts[label] = 0;
    }
  }

  private finishRun(): void {
    if (!this.running) return;
    this.running = false;
    this.leftHeld = false;
    this.rightHeld = false;
    this.audio.stopMusic();
    this.audio.setLaser(false);
    this.audio.setJet(false);
    document.body.classList.remove('playing');
    if (document.pointerLockElement) void document.exitPointerLock();
    const accuracy = this.resolvedNotes > 0
      ? (this.earnedPoints / (this.resolvedNotes * 1000)) * 100
      : 0;
    this.hud.overlayEyebrow.textContent = 'PROTOTYPE RUN COMPLETE';
    this.hud.overlayTitle.innerHTML = `RUN<br><em>COMPLETE</em>`;
    this.hud.overlayCopy.textContent = '세 가지 노트와 복합 패턴을 모두 통과했습니다. 결과를 확인하고 바로 다시 조정할 수 있습니다.';
    this.hud.summary.innerHTML = `
      <div><span>SCORE</span><strong>${this.score.toString().padStart(7, '0')}</strong></div>
      <div><span>ACCURACY</span><strong>${accuracy.toFixed(1)}%</strong></div>
      <div><span>MAX COMBO</span><strong>${this.maxCombo}</strong></div>
      <div><span>PERFECT / MISS</span><strong>${this.judgementCounts.PERFECT} / ${this.judgementCounts.MISS}</strong></div>
    `;
    this.hud.summary.classList.remove('hidden');
    this.hud.startButton.textContent = '다시 플레이';
    this.hud.overlay.classList.remove('hidden');
  }

  private updateHud(): void {
    const accuracy = this.resolvedNotes > 0
      ? (this.earnedPoints / (this.resolvedNotes * 1000)) * 100
      : 100;
    this.hud.score.textContent = this.score.toString().padStart(7, '0');
    this.hud.combo.textContent = `${this.combo}x`;
    this.hud.combo.classList.toggle('active', this.combo >= 5);
    this.hud.accuracy.textContent = `${accuracy.toFixed(1)}%`;
    const remaining = Math.max(0, CONFIG.chartDuration - this.elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60).toString().padStart(2, '0');
    this.hud.timer.textContent = `${minutes}:${seconds}`;
    this.hud.progress.style.width = `${clamp(this.elapsed / CONFIG.chartDuration, 0, 1) * 100}%`;
    const aimed = this.running && this.notes.hasAim(this.camera, this.elapsed);
    const laserActive = this.running && this.notes.isLaserActive();
    const laserDragging = laserActive && this.notes.isLaserDragging();
    const timingDelta = this.running ? this.notes.getNearestTimingDelta(this.elapsed) : null;
    const inWindow = timingDelta !== null && Math.abs(timingDelta) <= CONFIG.badWindow;
    const perfect = timingDelta !== null && Math.abs(timingDelta) <= CONFIG.perfectWindow;
    const late = timingDelta !== null && timingDelta < -CONFIG.perfectWindow;
    this.hud.reticle.classList.toggle('locked', aimed);
    this.hud.reticle.classList.toggle('ready', inWindow);
    this.hud.reticle.classList.toggle('perfect', perfect);
    this.hud.reticle.classList.toggle('late', late);
    this.hud.reticle.classList.toggle('tracking', laserActive);
    this.hud.reticle.classList.toggle('dragging', laserDragging);
    this.hud.timingCue.classList.toggle('visible', timingDelta !== null || laserActive);
    this.hud.timingCue.classList.toggle('ready', inWindow);
    this.hud.timingCue.classList.toggle('perfect', perfect);
    this.hud.timingCue.classList.toggle('late', late);
    this.hud.timingCue.classList.toggle('tracking', laserActive);
    this.hud.timingCue.classList.toggle('dragging', laserDragging);
    this.hud.timingCueLabel.textContent = laserActive ? 'DRAG' : 'FIRE';
    if (timingDelta !== null) {
      const timingProgress = clamp(1 - Math.max(0, timingDelta) / CONFIG.notePrepareCueTime, 0, 1);
      this.hud.timingCue.style.setProperty('--timing-progress', timingProgress.toFixed(3));
    } else if (laserActive) {
      this.hud.timingCue.style.setProperty('--timing-progress', '1');
    }
  }

  private bindEvents(): void {
    this.hud.startButton.addEventListener('click', () => this.requestPlay());
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.running || document.pointerLockElement === this.renderer.domElement) return;
      const lockRequest = this.renderer.domElement.requestPointerLock();
      if (lockRequest instanceof Promise) void lockRequest.catch(() => undefined);
    });
    window.addEventListener('mousemove', (event) => {
      if (!this.running) return;
      this.frameDragMotion.x += event.movementX;
      this.frameDragMotion.y += event.movementY;
      this.yawOffset = clamp(
        this.yawOffset - event.movementX * 0.00175,
        -CONFIG.maxAimYaw,
        CONFIG.maxAimYaw,
      );
      this.pitch = clamp(
        this.pitch - event.movementY * 0.00155,
        -CONFIG.maxAimPitch,
        CONFIG.maxAimPitch,
      );
    });
    window.addEventListener('mousedown', (event) => {
      if (!this.running) return;
      this.elapsed = this.getCurrentRunTime();
      if (event.button === 0 && !this.leftHeld) {
        this.leftHeld = true;
        const result = this.notes.pressLeft(this.camera, this.elapsed);
        this.audio.grapple(result.hit);
        if (result.hit) {
          this.cameraShake = Math.max(this.cameraShake, 0.65);
          this.impactFov = Math.max(this.impactFov, 0.48);
        }
        this.showFeedback(result.hit ? 'WEB LOCK' : 'NO ANCHOR', result.message);
      }
      if (event.button === 2 && !this.rightHeld) {
        this.rightHeld = true;
        const result = this.notes.pressRight(this.camera, this.elapsed);
        const laserActive = this.notes.isLaserActive();
        this.recoil = 1;
        this.muzzleLife = 0.07;
        this.cameraShake = Math.max(this.cameraShake, result.hit ? 0.62 : 0.24);
        this.impactFov = Math.max(this.impactFov, result.hit ? 0.56 : 0.2);
        this.audio.shot(result.hit);
        this.audio.setLaser(laserActive);
        if (!laserActive) this.showTracer(result.point);
        if (laserActive) this.showFeedback('DRAG', 'FOLLOW THE PINK RAIL');
        if (!result.hit) this.showFeedback('SHOT', result.message);
      }
    });
    window.addEventListener('mouseup', (event) => {
      if (this.running) this.elapsed = this.getCurrentRunTime();
      if (event.button === 0 && this.leftHeld) {
        this.notes.releaseLeft(this.elapsed);
        this.leftHeld = false;
        this.audio.grapple(false);
      }
      if (event.button === 2 && this.rightHeld) {
        this.notes.releaseRight(this.elapsed);
        this.rightHeld = false;
        this.audio.setLaser(false);
      }
    });
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyR' && this.running) this.requestPlay();
    });
    window.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  private getCurrentRunTime(): number {
    return this.running ? this.audio.getChartTime() : this.elapsed;
  }

  private createWeaponRig(): void {
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x122838, roughness: 0.35, metalness: 0.78 });
    const cyanMaterial = new THREE.MeshStandardMaterial({
      color: 0x55f7ff,
      emissive: 0x1fdde9,
      emissiveIntensity: 1.8,
      roughness: 0.22,
    });
    const pinkMaterial = new THREE.MeshStandardMaterial({
      color: 0xff3979,
      emissive: 0xff174f,
      emissiveIntensity: 1.6,
      roughness: 0.22,
    });
    const bodyGeometry = new THREE.BoxGeometry(0.18, 0.16, 0.56);
    const barrelGeometry = new THREE.CylinderGeometry(0.055, 0.075, 0.42, 10);

    const left = new THREE.Group();
    left.name = 'left-device';
    const leftBody = new THREE.Mesh(bodyGeometry, darkMaterial);
    const leftBarrel = new THREE.Mesh(barrelGeometry, cyanMaterial);
    leftBarrel.rotation.x = Math.PI / 2;
    leftBarrel.position.z = -0.38;
    this.leftMuzzle.position.z = -0.62;
    left.add(leftBody, leftBarrel, this.leftMuzzle);
    left.position.set(-0.42, -0.34, -0.68);
    left.rotation.set(-0.08, -0.05, -0.04);

    const right = new THREE.Group();
    right.name = 'right-device';
    const rightBody = new THREE.Mesh(bodyGeometry, darkMaterial);
    const rightBarrel = new THREE.Mesh(barrelGeometry, pinkMaterial);
    rightBarrel.rotation.x = Math.PI / 2;
    rightBarrel.position.z = -0.38;
    this.rightMuzzle.position.z = -0.62;
    this.muzzleFlash.position.z = -0.04;
    this.rightMuzzle.add(this.muzzleFlash);
    right.add(rightBody, rightBarrel, this.rightMuzzle);
    right.position.set(0.42, -0.34, -0.68);
    right.rotation.set(-0.08, 0.05, 0.04);

    this.weaponRig.add(left, right);
    this.camera.add(this.weaponRig);
  }

  private addLights(): void {
    this.scene.add(new THREE.AmbientLight(0x6a9bb7, 0.8));
    this.scene.add(new THREE.HemisphereLight(0xc4edff, 0x142434, 2.35));
    const key = new THREE.DirectionalLight(0xffe5d2, 3.1);
    key.position.set(-18, 34, 12);
    this.scene.add(key);
    const cyan = new THREE.PointLight(0x45eaff, 42, 150, 1.6);
    cyan.position.set(-12, 9, -55);
    this.scene.add(cyan);
    const pink = new THREE.PointLight(0xff3e78, 34, 140, 1.6);
    pink.position.set(16, 7, -120);
    this.scene.add(pink);
  }

  private createSkyTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('하늘 배경을 생성할 수 없습니다.');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#5b89a8');
    gradient.addColorStop(0.48, '#29485d');
    gradient.addColorStop(1, '#102432');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private collectHud(): HudElements {
    return {
      score: requiredElement('scoreValue'),
      combo: requiredElement('comboValue'),
      accuracy: requiredElement('accuracyValue'),
      timer: requiredElement('timerValue'),
      progress: requiredElement('progressFill'),
      reticle: requiredElement('reticle'),
      feedback: requiredElement('feedback'),
      timingCue: requiredElement('timingCue'),
      timingCueLabel: requiredElement('timingCueLabel'),
      impactFlash: requiredElement('impactFlash'),
      overlay: requiredElement('startOverlay'),
      overlayEyebrow: requiredElement('overlayEyebrow'),
      overlayTitle: requiredElement('overlayTitle'),
      overlayCopy: requiredElement('overlayCopy'),
      summary: requiredElement('resultSummary'),
      startButton: requiredElement<HTMLButtonElement>('startButton'),
    };
  }
}
