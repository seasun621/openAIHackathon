import * as THREE from 'three';
import RAPIER, { type Collider, type RigidBody, type World } from '@dimforge/rapier3d-compat';
import { BombSystem } from './BombSystem';
import { City } from './City';
import { CONFIG } from './config';

interface HudElements {
  speed: HTMLElement;
  rope: HTMLElement;
  bombs: HTMLElement;
  reticle: HTMLElement;
  feedback: HTMLElement;
  overlay: HTMLElement;
  startButton: HTMLButtonElement;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required UI element: #${id}`);
  return element as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 560);
  private readonly world: World;
  private readonly playerBody: RigidBody;
  private readonly playerCollider: Collider;
  private readonly city: City;
  private readonly bombs: BombSystem;
  private readonly hud: HudElements;
  private readonly keys = new Set<string>();

  private readonly ropeMesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  private readonly ropeTip: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  private readonly anchorMarker: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  private readonly leftMuzzle = new THREE.Object3D();
  private readonly rightMuzzle = new THREE.Object3D();
  private readonly weaponRig = new THREE.Group();
  private readonly tracerGeometry = new THREE.BufferGeometry();
  private readonly tracer: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly muzzleFlash: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;

  private readonly playerPosition = new THREE.Vector3();
  private readonly cameraForward = new THREE.Vector3(0, 0, -1);
  private readonly candidateAnchor = new THREE.Vector3();
  private readonly ropeStart = new THREE.Vector3();
  private readonly ropeVisualEnd = new THREE.Vector3();
  private readonly ropeDirection = new THREE.Vector3();
  private readonly ropeUp = new THREE.Vector3(0, 1, 0);
  private readonly groundRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  private readonly physicsForward = new THREE.Vector3();
  private readonly physicsRight = new THREE.Vector3();
  private readonly physicsMove = new THREE.Vector3();
  private readonly grappleDelta = new THREE.Vector3();
  private readonly grappleTangent = new THREE.Vector3();

  private hasCandidateAnchor = false;
  private grappleAnchor: THREE.Vector3 | null = null;
  private ropeLength = 0;
  private grappleInitialLength = 0;
  private ropeReelCharge = 0;
  private ropeShotProgress = 1;
  private leftHeld = false;
  private isGrounded = false;
  private running = false;
  private pointerLockFallback = false;
  private yaw = 0;
  private pitch = 0;
  private physicsAccumulator = 0;
  private lastFrameTime = performance.now();
  private anchorSelectionTimer = 0;
  private tracerLife = 0;
  private flashLife = 0;
  private recoil = 0;
  private leftKick = 0;
  private shake = 0;

  constructor(root: HTMLElement, world: World) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.domElement.setAttribute('aria-label', 'Web swing mechanics sandbox');
    root.prepend(this.renderer.domElement);

    this.scene.background = this.createSkyTexture();
    this.scene.fog = new THREE.FogExp2(0x7890a4, 0.0042);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.addLights();

    this.city = new City(this.scene, this.world);
    this.bombs = new BombSystem(this.scene, this.city.getBombSpawnPoints());

    this.playerBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 4, 10)
        .setLinearDamping(0.08)
        .setCcdEnabled(true)
        .lockRotations(),
    );
    this.playerCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(0.64, 0.48)
        .setFriction(0)
        .setRestitution(0.06)
        .setDensity(1.05),
      this.playerBody,
    );

    const ropeMaterial = new THREE.MeshBasicMaterial({
      color: 0x67f8ff,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ropeMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1, 7), ropeMaterial);
    this.ropeMesh.frustumCulled = false;
    this.ropeMesh.visible = false;
    this.scene.add(this.ropeMesh);

    this.ropeTip = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.26, 0),
      new THREE.MeshBasicMaterial({
        color: 0xd7feff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.ropeTip.visible = false;
    this.ropeTip.frustumCulled = false;
    this.scene.add(this.ropeTip);

    this.anchorMarker = new THREE.Mesh(
      new THREE.TorusGeometry(0.88, 0.07, 7, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffd85a,
        transparent: true,
        opacity: 0.96,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.anchorMarker.visible = false;
    this.anchorMarker.renderOrder = 20;
    this.scene.add(this.anchorMarker);

    this.tracerGeometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.tracer = new THREE.Line(
      this.tracerGeometry,
      new THREE.LineBasicMaterial({ color: 0xff426f, transparent: true, opacity: 0 }),
    );
    this.tracer.frustumCulled = false;
    this.scene.add(this.tracer);

    this.muzzleFlash = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12, 0),
      new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.muzzleFlash.visible = false;
    this.createWeaponRig();

    this.hud = this.collectHud();
    this.bindEvents();
    this.syncPlayerPosition();
    this.updateCamera(0);
    this.updateAnchorSelection(0);
    this.updateHud();
    void this.renderer.compileAsync(this.scene, this.camera);
    this.renderer.setAnimationLoop(this.frame);
  }

  private readonly frame = (timestamp: number): void => {
    const rawDt = Math.max(0, (timestamp - this.lastFrameTime) / 1000);
    const dt = clamp(rawDt, 0, 0.05);
    this.lastFrameTime = timestamp;

    if (this.running) {
      const physicsStep = 1 / 60;
      this.physicsAccumulator = Math.min(this.physicsAccumulator + dt, physicsStep * 5);
      while (this.physicsAccumulator >= physicsStep) {
        this.stepPhysics(physicsStep);
        this.world.timestep = physicsStep;
        this.world.step();
        this.physicsAccumulator -= physicsStep;
      }
    }

    this.syncPlayerPosition();
    if (this.playerPosition.y < -12) this.resetPlayer();
    this.updateCamera(dt);
    this.updateAnchorSelection(dt);
    this.updateRopeVisual(dt);
    this.bombs.update(this.running ? dt : 0, this.camera.position);
    this.updateEffects(dt);
    this.scene.updateMatrixWorld();
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
  };

  private stepPhysics(dt: number): void {
    const currentVelocity = this.playerBody.linvel();
    const fallTransition = THREE.MathUtils.smoothstep(
      2 - currentVelocity.y,
      0,
      CONFIG.gravityTransitionSpeed,
    );
    const airborneGravityScale = THREE.MathUtils.lerp(
      CONFIG.risingGravityScale,
      CONFIG.fallingGravityScale,
      fallTransition,
    );
    this.updateGroundedState();
    this.world.gravity.y = CONFIG.gravity * (this.grappleAnchor || this.isGrounded ? 1 : airborneGravityScale);

    this.physicsForward.copy(this.cameraForward);
    this.physicsForward.y = 0;
    if (this.physicsForward.lengthSq() < 0.001) this.physicsForward.set(0, 0, -1);
    this.physicsForward.normalize();
    this.physicsRight.set(-this.physicsForward.z, 0, this.physicsForward.x);
    this.physicsMove.set(0, 0, 0);
    if (this.keys.has('KeyW')) this.physicsMove.add(this.physicsForward);
    if (this.keys.has('KeyS')) this.physicsMove.sub(this.physicsForward);
    if (this.keys.has('KeyD')) this.physicsMove.add(this.physicsRight);
    if (this.keys.has('KeyA')) this.physicsMove.sub(this.physicsRight);
    const hasMoveInput = this.physicsMove.lengthSq() > 0;
    if (hasMoveInput) this.physicsMove.normalize();

    if (this.isGrounded && !this.grappleAnchor) {
      const velocity = this.playerBody.linvel();
      const targetX = hasMoveInput ? this.physicsMove.x * CONFIG.walkSpeed : 0;
      const targetZ = hasMoveInput ? this.physicsMove.z * CONFIG.walkSpeed : 0;
      const rate = hasMoveInput ? CONFIG.groundAcceleration : CONFIG.groundDeceleration;
      const maxChange = rate * dt;
      this.playerBody.setLinvel({
        x: velocity.x + clamp(targetX - velocity.x, -maxChange, maxChange),
        y: velocity.y,
        z: velocity.z + clamp(targetZ - velocity.z, -maxChange, maxChange),
      }, true);
    } else if (hasMoveInput) {
      this.physicsMove.multiplyScalar(CONFIG.airAcceleration * dt);
      this.playerBody.applyImpulse(
        { x: this.physicsMove.x, y: 0, z: this.physicsMove.z },
        true,
      );
    }

    if (this.grappleAnchor) this.applyGrappleForces(dt);

    const velocity = this.playerBody.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed > CONFIG.maxAirSpeed) {
      const scale = CONFIG.maxAirSpeed / speed;
      this.playerBody.setLinvel(
        { x: velocity.x * scale, y: velocity.y * scale, z: velocity.z * scale },
        true,
      );
    }
  }

  private applyGrappleForces(dt: number): void {
    if (!this.grappleAnchor) return;
    const translation = this.playerBody.translation();
    this.grappleDelta.set(
      this.grappleAnchor.x - translation.x,
      this.grappleAnchor.y - translation.y,
      this.grappleAnchor.z - translation.z,
    );
    const distance = this.grappleDelta.length();
    const reelRatio = this.grappleInitialLength > CONFIG.ropeMinLength
      ? clamp(
        1 - (this.ropeLength - CONFIG.ropeMinLength)
          / (this.grappleInitialLength - CONFIG.ropeMinLength),
        0,
        1,
      )
      : 1;

    if (this.leftHeld) {
      const reelSpeed = THREE.MathUtils.lerp(
        CONFIG.ropePullSpeed,
        CONFIG.ropePullMaxSpeed,
        Math.pow(reelRatio, 0.68),
      );
      this.ropeLength = Math.max(CONFIG.ropeMinLength, this.ropeLength - reelSpeed * dt);
      this.ropeReelCharge = clamp(this.ropeReelCharge + (0.2 + reelRatio * 0.95) * dt, 0, 1);
    }
    if (distance <= 0.001) return;

    this.grappleDelta.multiplyScalar(1 / distance);
    const velocity = this.playerBody.linvel();
    const towardSpeed = velocity.x * this.grappleDelta.x
      + velocity.y * this.grappleDelta.y
      + velocity.z * this.grappleDelta.z;
    const excess = Math.max(0, distance - this.ropeLength);
    const damping = Math.max(0, -towardSpeed) * CONFIG.ropeDamping;
    const pull = this.leftHeld ? THREE.MathUtils.lerp(8, CONFIG.ropeReelRadialForce, reelRatio) : 0;
    const impulse = (excess * CONFIG.ropeSpring + damping + pull) * dt;
    this.playerBody.applyImpulse({
      x: this.grappleDelta.x * impulse,
      y: this.grappleDelta.y * impulse,
      z: this.grappleDelta.z * impulse,
    }, true);

    if (!this.leftHeld) return;
    this.grappleTangent.set(velocity.x, velocity.y, velocity.z)
      .addScaledVector(this.grappleDelta, -towardSpeed);
    if (this.grappleTangent.lengthSq() < 4) {
      this.grappleTangent.copy(this.cameraForward)
        .addScaledVector(this.grappleDelta, -this.cameraForward.dot(this.grappleDelta));
    }
    if (this.grappleTangent.lengthSq() <= 0.001) return;
    this.grappleTangent.normalize();
    const tensionMix = clamp(excess / 4, 0, 1);
    const reelAcceleration = THREE.MathUtils.lerp(
      CONFIG.ropeReelAcceleration,
      CONFIG.ropeReelMaxAcceleration,
      Math.pow(reelRatio, 0.72),
    ) * (0.58 + tensionMix * 0.42);
    this.playerBody.applyImpulse({
      x: this.grappleTangent.x * reelAcceleration * dt,
      y: this.grappleTangent.y * reelAcceleration * dt,
      z: this.grappleTangent.z * reelAcceleration * dt,
    }, true);
  }

  private updateGroundedState(): void {
    const translation = this.playerBody.translation();
    this.groundRay.origin.x = translation.x;
    this.groundRay.origin.y = translation.y;
    this.groundRay.origin.z = translation.z;
    const hit = this.world.castRay(
      this.groundRay,
      CONFIG.groundProbeDistance,
      true,
      undefined,
      undefined,
      this.playerCollider,
      this.playerBody,
    );
    this.isGrounded = hit !== null && this.playerBody.linvel().y <= 1.2;
  }

  private updateCamera(dt: number): void {
    const translation = this.playerBody.translation();
    const shakeAmount = this.shake * this.shake * 0.07;
    this.camera.position.set(
      translation.x + (Math.random() - 0.5) * shakeAmount,
      translation.y + 0.22 + (Math.random() - 0.5) * shakeAmount,
      translation.z + (Math.random() - 0.5) * shakeAmount,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.camera.getWorldDirection(this.cameraForward);

    const velocity = this.playerBody.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    const targetFov = 74 + clamp((speed - 16) / 38, 0, 1) * 10;
    const nextFov = THREE.MathUtils.damp(this.camera.fov, targetFov, 6, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
    this.recoil = THREE.MathUtils.damp(this.recoil, 0, 18, dt);
    this.leftKick = THREE.MathUtils.damp(this.leftKick, 0, 12, dt);
    this.shake = THREE.MathUtils.damp(this.shake, 0, 9, dt);
    const rightDevice = this.weaponRig.getObjectByName('right-device');
    const leftDevice = this.weaponRig.getObjectByName('left-device');
    if (rightDevice) rightDevice.position.z = -0.64 + this.recoil * 0.13;
    if (leftDevice) leftDevice.rotation.x = -0.08 - this.leftKick * 0.08;
  }

  private updateAnchorSelection(dt: number): void {
    if (this.grappleAnchor) {
      this.hasCandidateAnchor = false;
      this.anchorMarker.visible = true;
      this.anchorMarker.material.color.setHex(0x58f7ff);
      this.anchorMarker.position.copy(this.grappleAnchor);
      this.anchorMarker.quaternion.copy(this.camera.quaternion);
      this.anchorMarker.scale.setScalar(clamp(this.camera.position.distanceTo(this.grappleAnchor) * 0.012, 0.75, 1.7));
      return;
    }

    this.anchorSelectionTimer -= dt;
    if (this.anchorSelectionTimer > 0) return;
    this.anchorSelectionTimer = 0.045;
    const anchor = this.city.findAssistedAnchor(this.camera, this.playerPosition);
    this.hasCandidateAnchor = anchor !== null;
    if (!anchor) {
      this.anchorMarker.visible = false;
      return;
    }
    this.candidateAnchor.copy(anchor);
    this.anchorMarker.visible = true;
    this.anchorMarker.material.color.setHex(0xffd85a);
    this.anchorMarker.position.copy(anchor);
    this.anchorMarker.quaternion.copy(this.camera.quaternion);
    const pulse = 1 + Math.sin(performance.now() * 0.009) * 0.1;
    this.anchorMarker.scale.setScalar(
      clamp(this.camera.position.distanceTo(anchor) * 0.012, 0.75, 1.7) * pulse,
    );
  }

  private updateRopeVisual(dt: number): void {
    if (!this.grappleAnchor) {
      this.ropeMesh.visible = false;
      this.ropeTip.visible = false;
      return;
    }
    this.camera.updateMatrixWorld();
    this.leftMuzzle.getWorldPosition(this.ropeStart);
    this.ropeShotProgress = Math.min(1, this.ropeShotProgress + dt / CONFIG.ropeFireDuration);
    const easedProgress = 1 - Math.pow(1 - this.ropeShotProgress, 3);
    this.ropeVisualEnd.lerpVectors(this.ropeStart, this.grappleAnchor, easedProgress);
    this.ropeDirection.copy(this.ropeVisualEnd).sub(this.ropeStart);
    const length = this.ropeDirection.length();
    if (length <= 0.001) return;
    this.ropeMesh.position.copy(this.ropeStart).addScaledVector(this.ropeDirection, 0.5);
    this.ropeMesh.quaternion.setFromUnitVectors(this.ropeUp, this.ropeDirection.normalize());
    const launchPulse = 1 + (1 - this.ropeShotProgress) * 0.72;
    this.ropeMesh.scale.set(launchPulse, length, launchPulse);
    this.ropeMesh.visible = true;
    this.ropeTip.position.copy(this.ropeVisualEnd);
    this.ropeTip.scale.setScalar(0.8 + (1 - this.ropeShotProgress) * 1.5);
    this.ropeTip.visible = this.ropeShotProgress < 1;
  }

  private tryAttach(): void {
    if (!this.running || !this.hasCandidateAnchor) return;
    this.grappleAnchor = this.candidateAnchor.clone();
    this.ropeShotProgress = 0;
    const distance = this.grappleAnchor.distanceTo(this.playerPosition);
    this.ropeLength = Math.max(CONFIG.ropeMinLength, distance * 0.88);
    this.grappleInitialLength = this.ropeLength;
    this.ropeReelCharge = 0;
    this.grappleDelta.copy(this.grappleAnchor).sub(this.playerPosition).normalize().multiplyScalar(2.1);
    this.playerBody.applyImpulse(
      { x: this.grappleDelta.x, y: this.grappleDelta.y, z: this.grappleDelta.z },
      true,
    );
    this.leftKick = 1;
  }

  private detach(): void {
    if (this.grappleAnchor && this.leftHeld && this.running && this.ropeReelCharge > 0.04) {
      const velocity = this.playerBody.linvel();
      this.grappleTangent.set(velocity.x, Math.max(0, velocity.y * 0.18), velocity.z);
      if (this.grappleTangent.lengthSq() < 4) {
        this.grappleTangent.copy(this.cameraForward);
        this.grappleTangent.y = Math.max(0.08, this.grappleTangent.y);
      }
      this.grappleTangent.normalize();
      const releaseBoost = CONFIG.ropeReleaseBoost * this.ropeReelCharge;
      this.playerBody.applyImpulse({
        x: this.grappleTangent.x * releaseBoost,
        y: this.grappleTangent.y * releaseBoost + CONFIG.ropeReleaseLift * this.ropeReelCharge,
        z: this.grappleTangent.z * releaseBoost,
      }, true);
      this.shake = Math.max(this.shake, this.ropeReelCharge * 0.3);
    }
    this.grappleAnchor = null;
    this.ropeShotProgress = 1;
    this.grappleInitialLength = 0;
    this.ropeReelCharge = 0;
    this.ropeMesh.visible = false;
    this.ropeTip.visible = false;
    this.leftHeld = false;
  }

  private shoot(): void {
    if (!this.running) return;
    this.camera.updateMatrixWorld();
    const muzzlePosition = new THREE.Vector3();
    this.rightMuzzle.getWorldPosition(muzzlePosition);
    const result = this.bombs.shoot(this.camera, this.city.getOccluders());
    this.showTracer(muzzlePosition, result.point);
    this.recoil = 1;
    this.flashLife = 0.055;
    this.muzzleFlash.visible = true;
    this.shake = Math.max(this.shake, result.detonated ? 0.7 : 0.2);
    this.hud.feedback.textContent = result.detonated
      ? result.chainCount > 1 ? `CHAIN x${result.chainCount}` : 'BOMB DETONATED'
      : 'NO TARGET';
    this.hud.feedback.classList.remove('pulse');
    void this.hud.feedback.offsetWidth;
    this.hud.feedback.classList.add('pulse');
  }

  private showTracer(start: THREE.Vector3, end: THREE.Vector3): void {
    const positions = this.tracerGeometry.attributes.position as THREE.BufferAttribute;
    positions.setXYZ(0, start.x, start.y, start.z);
    positions.setXYZ(1, end.x, end.y, end.z);
    positions.needsUpdate = true;
    this.tracerGeometry.computeBoundingSphere();
    this.tracer.material.opacity = 0.95;
    this.tracerLife = 0.1;
  }

  private updateEffects(dt: number): void {
    this.tracerLife = Math.max(0, this.tracerLife - dt);
    this.tracer.material.opacity = clamp(this.tracerLife / 0.1, 0, 0.95);
    this.flashLife = Math.max(0, this.flashLife - dt);
    this.muzzleFlash.visible = this.flashLife > 0;
    this.muzzleFlash.material.opacity = clamp(this.flashLife / 0.055, 0, 1);
    this.muzzleFlash.scale.setScalar(0.7 + this.flashLife * 11);
  }

  private tryJump(): void {
    if (!this.running || !this.isGrounded) return;
    const velocity = this.playerBody.linvel();
    this.playerBody.setLinvel({ x: velocity.x, y: CONFIG.jumpSpeed, z: velocity.z }, true);
    this.isGrounded = false;
  }

  private syncPlayerPosition(): void {
    const translation = this.playerBody.translation();
    this.playerPosition.set(translation.x, translation.y, translation.z);
  }

  private resetPlayer(): void {
    this.detach();
    this.playerBody.setTranslation({ x: 0, y: 4, z: 10 }, true);
    this.playerBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.playerBody.resetForces(true);
    this.physicsAccumulator = 0;
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.running) return;
      this.yaw -= event.movementX * 0.0018;
      this.pitch = clamp(this.pitch - event.movementY * 0.00165, -1.43, 1.38);
    });
    document.addEventListener('mousedown', (event) => {
      if (!this.running) return;
      if (event.button === 0) {
        this.leftHeld = true;
        this.tryAttach();
      }
      if (event.button === 2) this.shoot();
    });
    document.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.detach();
    });
    document.addEventListener('contextmenu', (event) => event.preventDefault());
    document.addEventListener('keydown', (event) => {
      if (event.code === 'Escape' && this.pointerLockFallback) {
        this.pointerLockFallback = false;
        this.running = false;
        this.keys.clear();
        this.detach();
        this.hud.overlay.classList.remove('hidden');
        this.hud.startButton.textContent = '계속하기';
        return;
      }
      this.keys.add(event.code);
      if (event.code === 'Space') {
        event.preventDefault();
        if (!event.repeat) this.tryJump();
      }
      if (event.code === 'KeyR' && !event.repeat) this.resetPlayer();
    });
    document.addEventListener('keyup', (event) => this.keys.delete(event.code));
    document.addEventListener('pointerlockchange', () => {
      this.pointerLockFallback = false;
      this.running = document.pointerLockElement === this.renderer.domElement;
      this.hud.overlay.classList.toggle('hidden', this.running);
      this.hud.startButton.textContent = this.running ? '실행 중' : '계속하기';
      if (this.running) return;
      this.keys.clear();
      this.detach();
    });
    this.hud.startButton.addEventListener('click', () => this.requestPlay());
  }

  private requestPlay(): void {
    const request = this.renderer.domElement.requestPointerLock();
    void request.catch(() => {
      // Embedded preview surfaces may reject pointer lock. Keep the mechanics
      // testable there while normal browsers continue to use real pointer lock.
      this.pointerLockFallback = true;
      this.running = true;
      this.hud.overlay.classList.add('hidden');
      this.hud.startButton.textContent = '실행 중';
      this.hud.feedback.textContent = 'POINTER LOCK FALLBACK';
    });
  }

  private updateHud(): void {
    const velocity = this.playerBody.linvel();
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    this.hud.speed.textContent = `${Math.round(speed * 3.6)} km/h`;
    this.hud.rope.textContent = this.grappleAnchor
      ? `TENSION // ${Math.round(this.ropeLength)}m`
      : this.hasCandidateAnchor ? 'ANCHOR // READY' : 'ANCHOR // SEARCH';
    this.hud.bombs.textContent = String(this.bombs.getActiveCount()).padStart(2, '0');
    const bombLocked = this.running && this.bombs.hasAim(this.camera, this.city.getOccluders());
    this.hud.reticle.classList.toggle('locked', bombLocked);
  }

  private createWeaponRig(): void {
    const dark = new THREE.MeshStandardMaterial({ color: 0x111821, roughness: 0.28, metalness: 0.82 });
    const cyan = new THREE.MeshBasicMaterial({ color: 0x4ef6ff });
    const pink = new THREE.MeshBasicMaterial({ color: 0xff3d72 });

    const left = new THREE.Group();
    left.name = 'left-device';
    left.position.set(-0.46, -0.34, -0.66);
    left.rotation.set(-0.08, 0.08, -0.08);
    left.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.52), dark));
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.1, 12), cyan);
    spool.rotation.z = Math.PI / 2;
    spool.position.set(0, 0.03, -0.04);
    left.add(spool);
    const leftBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.42, 8), dark);
    leftBarrel.rotation.x = Math.PI / 2;
    leftBarrel.position.z = -0.34;
    left.add(leftBarrel);
    this.leftMuzzle.position.set(0, 0, -0.56);
    left.add(this.leftMuzzle);

    const right = new THREE.Group();
    right.name = 'right-device';
    right.position.set(0.46, -0.34, -0.64);
    right.rotation.set(-0.05, -0.08, 0.06);
    right.add(new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.22, 0.55), dark));
    const rightBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.07, 0.46, 8), dark);
    rightBarrel.rotation.x = Math.PI / 2;
    rightBarrel.position.z = -0.38;
    right.add(rightBarrel);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.045, 0.2), pink);
    sight.position.set(0, 0.13, -0.13);
    right.add(sight);
    this.rightMuzzle.position.set(0, 0, -0.62);
    this.muzzleFlash.position.z = -0.08;
    this.rightMuzzle.add(this.muzzleFlash);
    right.add(this.rightMuzzle);

    this.weaponRig.add(left, right);
    this.camera.add(this.weaponRig);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xd9efff, 0x5d6670, 2.5));
    const sun = new THREE.DirectionalLight(0xffd7aa, 3.2);
    sun.position.set(-110, 160, -70);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x8fcfff, 0.9);
    fill.position.set(95, 70, 120);
    this.scene.add(fill);
  }

  private createSkyTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the procedural sky.');
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#31516e');
    gradient.addColorStop(0.52, '#7894a8');
    gradient.addColorStop(0.8, '#d5b894');
    gradient.addColorStop(1, '#f0c781');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  private collectHud(): HudElements {
    return {
      speed: requiredElement('speedValue'),
      rope: requiredElement('ropeValue'),
      bombs: requiredElement('bombValue'),
      reticle: requiredElement('reticle'),
      feedback: requiredElement('feedback'),
      overlay: requiredElement('startOverlay'),
      startButton: requiredElement<HTMLButtonElement>('startButton'),
    };
  }
}
