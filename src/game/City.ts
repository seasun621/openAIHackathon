import * as THREE from 'three';
import RAPIER, { type World } from '@dimforge/rapier3d-compat';
import { CONFIG } from './config';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * A deliberately small procedural city used as a rendering and traversal lab.
 * It keeps the original project's important rendering rules: shared resources,
 * InstancedMesh buildings, deterministic generation, and one collision body per
 * visible building.
 */
export class City {
  private readonly anchors: THREE.Vector3[] = [];
  private readonly bombSpawnPoints: THREE.Vector3[] = [];
  private readonly buildingMesh: THREE.InstancedMesh;
  private readonly anchorDelta = new THREE.Vector3();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly projectedAnchor = new THREE.Vector3();

  constructor(scene: THREE.Scene, world: World) {
    const random = seededRandom(0x51a7c0de);
    const spacing = CONFIG.citySpacing;
    const halfExtent = CONFIG.cityHalfExtent;
    const buildingCount = (halfExtent * 2) ** 2;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8092a2,
      roughness: 0.76,
      metalness: 0.08,
      vertexColors: true,
    });
    this.buildingMesh = new THREE.InstancedMesh(geometry, material, buildingCount);
    this.buildingMesh.name = 'procedural-buildings';
    this.buildingMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const transform = new THREE.Object3D();
    const color = new THREE.Color();
    let index = 0;
    for (let gridX = -halfExtent; gridX < halfExtent; gridX += 1) {
      for (let gridZ = -halfExtent; gridZ < halfExtent; gridZ += 1) {
        const width = 13 + random() * 7;
        const depth = 13 + random() * 7;
        const height = 18 + random() * 54;
        const x = (gridX + 0.5) * spacing + (random() - 0.5) * 2.4;
        const z = (gridZ + 0.5) * spacing + (random() - 0.5) * 2.4;

        transform.position.set(x, height * 0.5, z);
        transform.scale.set(width, height, depth);
        transform.rotation.set(0, 0, 0);
        transform.updateMatrix();
        this.buildingMesh.setMatrixAt(index, transform.matrix);
        color.setHSL(0.56 + random() * 0.045, 0.14 + random() * 0.08, 0.38 + random() * 0.16);
        this.buildingMesh.setColorAt(index, color);
        index += 1;

        const body = world.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(x, height * 0.5, z),
        );
        world.createCollider(
          RAPIER.ColliderDesc.cuboid(width * 0.5, height * 0.5, depth * 0.5),
          body,
        );

        const insetX = width * 0.32;
        const insetZ = depth * 0.32;
        this.anchors.push(
          new THREE.Vector3(x - insetX, height + 0.8, z - insetZ),
          new THREE.Vector3(x + insetX, height + 0.8, z + insetZ),
        );
      }
    }
    this.buildingMesh.count = index;
    this.buildingMesh.instanceMatrix.needsUpdate = true;
    if (this.buildingMesh.instanceColor) this.buildingMesh.instanceColor.needsUpdate = true;
    scene.add(this.buildingMesh);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(760, 760),
      new THREE.MeshStandardMaterial({ color: 0x111923, roughness: 0.98, metalness: 0.02 }),
    );
    ground.name = 'ground';
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const grid = new THREE.GridHelper(672, 24, 0x3c6578, 0x253744);
    grid.position.y = 0.025;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const gridMaterial of gridMaterials) {
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.62;
    }
    scene.add(grid);

    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
    );
    world.createCollider(RAPIER.ColliderDesc.cuboid(380, 0.5, 380), groundBody);

    this.bombSpawnPoints.push(
      new THREE.Vector3(0, 1.7, -38),
      new THREE.Vector3(0, 2.2, -49),
      new THREE.Vector3(28, 22, -56),
      new THREE.Vector3(-28, 26, -56),
      new THREE.Vector3(0, 30, -84),
      new THREE.Vector3(56, 18, -28),
      new THREE.Vector3(-56, 24, -28),
    );
    for (let x = -4; x <= 4; x += 1) {
      for (let z = -4; z <= 4; z += 1) {
        if (Math.abs(x) + Math.abs(z) < 2) continue;
        const height = 9 + ((Math.abs(x * 7 + z * 11) % 6) * 5);
        this.bombSpawnPoints.push(new THREE.Vector3(x * spacing, height, z * spacing));
      }
    }
  }

  getOccluders(): THREE.Object3D[] {
    return [this.buildingMesh];
  }

  getBombSpawnPoints(): THREE.Vector3[] {
    return this.bombSpawnPoints.map((point) => point.clone());
  }

  findAssistedAnchor(camera: THREE.Camera, playerPosition: THREE.Vector3): THREE.Vector3 | null {
    camera.getWorldDirection(this.cameraDirection);
    let best: THREE.Vector3 | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const anchor of this.anchors) {
      this.anchorDelta.copy(anchor).sub(playerPosition);
      const distance = this.anchorDelta.length();
      if (distance > CONFIG.ropeMaxRange || distance < 7) continue;

      const forwardAlignment = this.anchorDelta.dot(this.cameraDirection) / distance;
      if (forwardAlignment < 0.78) continue;

      this.projectedAnchor.copy(anchor).project(camera);
      if (this.projectedAnchor.z < -1 || this.projectedAnchor.z > 1) continue;
      const x = Math.abs(this.projectedAnchor.x);
      const y = Math.abs(this.projectedAnchor.y);
      if (x > 0.38 || y > 0.34) continue;

      const tooLowPenalty = anchor.y < playerPosition.y + 2 ? 0.48 : 0;
      const score = x * 1.25 + y + distance * 0.0024 + tooLowPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = anchor;
      }
    }

    return best?.clone() ?? null;
  }
}
