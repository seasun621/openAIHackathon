import * as THREE from 'three';
import { CONFIG } from './config';

interface Bomb {
  id: number;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  basePosition: THREE.Vector3;
  phase: number;
}

interface Explosion {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  velocities: Float32Array;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  duration: number;
}

export interface ShotResult {
  point: THREE.Vector3;
  detonated: boolean;
  chainCount: number;
}

export class BombSystem {
  private readonly bombs: Bomb[] = [];
  private readonly hitMeshes: THREE.Mesh[] = [];
  private readonly explosions: Explosion[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly screenCenter = new THREE.Vector2(0, 0);
  private readonly bombHits: THREE.Intersection[] = [];
  private readonly occluderHits: THREE.Intersection[] = [];
  private readonly coreGeometry = new THREE.SphereGeometry(1.35, 14, 10);
  private readonly ringGeometry = new THREE.TorusGeometry(1.7, 0.12, 7, 22);
  private readonly burstRingGeometry = new THREE.RingGeometry(0.75, 1, 28);
  private readonly coreMaterial = new THREE.MeshStandardMaterial({
    color: 0x15151f,
    emissive: 0x8b082d,
    emissiveIntensity: 0.48,
    roughness: 0.32,
    metalness: 0.72,
  });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0xff315f });
  private readonly spawnPoints: THREE.Vector3[];
  private nextId = 1;
  private nextSpawnIndex = 0;
  private pendingRespawns = 0;
  private respawnTimer = 0;

  constructor(
    private readonly scene: THREE.Scene,
    spawnPoints: THREE.Vector3[],
  ) {
    this.spawnPoints = spawnPoints;
    for (let index = 0; index < CONFIG.bombCount; index += 1) this.spawnBomb();
  }

  update(dt: number, cameraPosition: THREE.Vector3): void {
    for (const bomb of this.bombs) {
      const time = performance.now() * 0.001 + bomb.phase;
      bomb.group.position.copy(bomb.basePosition);
      bomb.group.position.y += Math.sin(time * 1.7) * 0.72;
      bomb.group.rotation.y += dt * 1.25;
      bomb.group.rotation.z = Math.sin(time * 0.8) * 0.16;
    }

    if (this.pendingRespawns > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.spawnBomb();
        this.pendingRespawns -= 1;
        this.respawnTimer = CONFIG.bombRespawnDelay;
      }
    }

    for (let index = this.explosions.length - 1; index >= 0; index -= 1) {
      const effect = this.explosions[index];
      effect.age += dt;
      const progress = Math.min(1, effect.age / effect.duration);
      const positions = effect.points.geometry.attributes.position as THREE.BufferAttribute;
      for (let particle = 0; particle < positions.count; particle += 1) {
        const offset = particle * 3;
        effect.velocities[offset + 1] -= 9 * dt;
        positions.setXYZ(
          particle,
          positions.getX(particle) + effect.velocities[offset] * dt,
          positions.getY(particle) + effect.velocities[offset + 1] * dt,
          positions.getZ(particle) + effect.velocities[offset + 2] * dt,
        );
      }
      positions.needsUpdate = true;
      effect.points.material.opacity = 1 - progress;
      effect.points.material.size = 0.42 + progress * 0.9;
      effect.ring.lookAt(cameraPosition);
      effect.ring.scale.setScalar(1 + progress * 9);
      effect.ring.material.opacity = (1 - progress) * 0.92;
      if (progress < 1) continue;
      this.scene.remove(effect.points, effect.ring);
      effect.points.geometry.dispose();
      effect.points.material.dispose();
      effect.ring.material.dispose();
      this.explosions.splice(index, 1);
    }
  }

  hasAim(camera: THREE.Camera, occluders: THREE.Object3D[]): boolean {
    return this.findAimedBomb(camera, occluders, CONFIG.shotRange) !== null;
  }

  shoot(camera: THREE.Camera, occluders: THREE.Object3D[]): ShotResult {
    const aimedBomb = this.findAimedBomb(camera, occluders, CONFIG.shotRange);
    if (aimedBomb) {
      const point = aimedBomb.group.position.clone();
      return {
        point,
        detonated: true,
        chainCount: this.detonateChain(aimedBomb),
      };
    }

    this.raycaster.setFromCamera(this.screenCenter, camera);
    this.raycaster.far = CONFIG.shotRange;
    this.occluderHits.length = 0;
    this.raycaster.intersectObjects(occluders, true, this.occluderHits);
    const point = this.occluderHits[0]?.point.clone()
      ?? this.raycaster.ray.origin.clone().addScaledVector(this.raycaster.ray.direction, CONFIG.shotRange);
    return { point, detonated: false, chainCount: 0 };
  }

  getActiveCount(): number {
    return this.bombs.length;
  }

  private findAimedBomb(
    camera: THREE.Camera,
    occluders: THREE.Object3D[],
    maxDistance: number,
  ): Bomb | null {
    this.raycaster.setFromCamera(this.screenCenter, camera);
    this.raycaster.far = maxDistance;
    this.bombHits.length = 0;
    this.raycaster.intersectObjects(this.hitMeshes, false, this.bombHits);
    const bombHit = this.bombHits[0];
    if (!bombHit) return null;

    this.occluderHits.length = 0;
    this.raycaster.intersectObjects(occluders, true, this.occluderHits);
    if (this.occluderHits[0]?.distance < bombHit.distance) return null;

    const id = bombHit.object.userData.bombId as number | undefined;
    return this.bombs.find((bomb) => bomb.id === id) ?? null;
  }

  private detonateChain(initialBomb: Bomb): number {
    const queue = [initialBomb];
    const selected = new Set<number>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || selected.has(current.id)) continue;
      selected.add(current.id);
      for (const candidate of this.bombs) {
        if (selected.has(candidate.id)) continue;
        if (candidate.group.position.distanceTo(current.group.position) <= CONFIG.bombChainRadius) {
          queue.push(candidate);
        }
      }
    }

    for (let index = this.bombs.length - 1; index >= 0; index -= 1) {
      const bomb = this.bombs[index];
      if (!selected.has(bomb.id)) continue;
      this.createExplosion(bomb.group.position);
      this.scene.remove(bomb.group);
      const hitIndex = this.hitMeshes.indexOf(bomb.hitMesh);
      if (hitIndex >= 0) this.hitMeshes.splice(hitIndex, 1);
      this.bombs.splice(index, 1);
    }
    this.pendingRespawns += selected.size;
    this.respawnTimer = Math.min(this.respawnTimer || CONFIG.bombRespawnDelay, CONFIG.bombRespawnDelay);
    return selected.size;
  }

  private spawnBomb(): void {
    if (this.spawnPoints.length === 0) return;
    let point = this.spawnPoints[this.nextSpawnIndex % this.spawnPoints.length];
    for (let attempt = 0; attempt < this.spawnPoints.length; attempt += 1) {
      const candidate = this.spawnPoints[(this.nextSpawnIndex + attempt) % this.spawnPoints.length];
      if (this.bombs.every((bomb) => bomb.basePosition.distanceToSquared(candidate) > 9)) {
        point = candidate;
        this.nextSpawnIndex += attempt + 1;
        break;
      }
    }

    const id = this.nextId;
    this.nextId += 1;
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
    core.userData.bombId = id;
    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = Math.PI / 2;
    group.add(core, ring);
    group.position.copy(point);
    this.scene.add(group);
    this.bombs.push({
      id,
      group,
      hitMesh: core,
      basePosition: point.clone(),
      phase: id * 0.83,
    });
    this.hitMeshes.push(core);
  }

  private createExplosion(position: THREE.Vector3): void {
    const particleCount = 34;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3;
      const direction = new THREE.Vector3(
        Math.random() - 0.5,
        Math.random() - 0.24,
        Math.random() - 0.5,
      ).normalize();
      const speed = 8 + Math.random() * 18;
      velocities[offset] = direction.x * speed;
      velocities[offset + 1] = direction.y * speed;
      velocities[offset + 2] = direction.z * speed;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xff8a3d,
      size: 0.55,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(geometry, material);
    points.position.copy(position);
    const ring = new THREE.Mesh(
      this.burstRingGeometry,
      new THREE.MeshBasicMaterial({
        color: 0xff315f,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    ring.position.copy(position);
    this.scene.add(points, ring);
    this.explosions.push({ points, velocities, ring, age: 0, duration: 0.62 });
  }
}
