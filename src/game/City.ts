import * as THREE from 'three';
import { CONFIG } from './config';
import { Track } from './Track';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export class City {
  constructor(scene: THREE.Scene, track: Track) {
    const random = seededRandom(0x5a17be47);
    const segmentStep = 0.42;
    const segmentCount = Math.ceil((CONFIG.chartDuration + 6) / segmentStep);
    const box = new THREE.BoxGeometry(1, 1, 1);
    const road = new THREE.InstancedMesh(
      box,
      new THREE.MeshStandardMaterial({ color: 0x1b2d3c, roughness: 0.82, metalness: 0.18 }),
      segmentCount,
    );
    const laneMarks = new THREE.InstancedMesh(
      box,
      new THREE.MeshBasicMaterial({ color: 0xa8f7ff, transparent: true, opacity: 0.58 }),
      segmentCount,
    );
    const edgeLights = new THREE.InstancedMesh(
      box,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
      }),
      segmentCount * 2,
    );
    const transform = new THREE.Object3D();
    const edgeColor = new THREE.Color();

    for (let index = 0; index < segmentCount; index += 1) {
      const time = index * segmentStep;
      const basis = track.getBasis(time);
      const yaw = Math.atan2(basis.tangent.x, basis.tangent.z);
      transform.position.copy(basis.position);
      transform.position.y = -0.15;
      transform.rotation.set(0, yaw, 0);
      transform.scale.set(15, 0.3, CONFIG.trackSpeed * segmentStep + 0.65);
      transform.updateMatrix();
      road.setMatrixAt(index, transform.matrix);

      transform.position.y = 0.025;
      transform.scale.set(0.1, 0.035, CONFIG.trackSpeed * segmentStep * 0.42);
      transform.updateMatrix();
      laneMarks.setMatrixAt(index, transform.matrix);

      for (const side of [-1, 1]) {
        transform.position.copy(basis.position).addScaledVector(basis.right, side * 7.15);
        transform.position.y = basis.position.y - 2.2;
        transform.rotation.set(0, yaw, 0);
        transform.scale.set(0.14, 0.09, CONFIG.trackSpeed * segmentStep * 0.6);
        transform.updateMatrix();
        const lightIndex = index * 2 + (side === 1 ? 1 : 0);
        edgeLights.setMatrixAt(lightIndex, transform.matrix);
        edgeColor.setHex(side === 1 ? 0xff4c86 : 0x55f5ff);
        edgeLights.setColorAt(lightIndex, edgeColor);
      }
    }
    road.instanceMatrix.needsUpdate = true;
    laneMarks.instanceMatrix.needsUpdate = true;
    edgeLights.instanceMatrix.needsUpdate = true;
    if (edgeLights.instanceColor) edgeLights.instanceColor.needsUpdate = true;
    scene.add(road, laneMarks, edgeLights);

    const buildingStep = 1;
    const buildingSegments = Math.ceil((CONFIG.chartDuration + 7) / buildingStep);
    const buildingCount = buildingSegments * 2;
    const buildings = new THREE.InstancedMesh(
      box,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0x102b3d,
        emissiveIntensity: 0.52,
        roughness: 0.68,
        metalness: 0.12,
        vertexColors: true,
      }),
      buildingCount,
    );
    const windowBands = new THREE.InstancedMesh(
      box,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
      }),
      buildingCount,
    );
    buildings.name = 'authored-city-corridor';
    const color = new THREE.Color();
    let instance = 0;
    for (let index = 0; index < buildingSegments; index += 1) {
      const time = index * buildingStep;
      const basis = track.getBasis(time);
      const yaw = Math.atan2(basis.tangent.x, basis.tangent.z);
      for (const side of [-1, 1]) {
        const width = 10 + random() * 5;
        const depth = CONFIG.trackSpeed * buildingStep + 1.5;
        const height = 18 + random() * 34 + (index % 7 === 0 ? 15 : 0);
        transform.position.copy(basis.position)
          .addScaledVector(basis.right, side * (14.5 + width * 0.5));
        transform.position.y = height * 0.5;
        transform.rotation.set(0, yaw, 0);
        transform.scale.set(width, height, depth);
        transform.updateMatrix();
        buildings.setMatrixAt(instance, transform.matrix);
        color.setHSL(0.56 + random() * 0.08, 0.22 + random() * 0.15, 0.34 + random() * 0.16);
        buildings.setColorAt(instance, color);

        transform.position.copy(basis.position).addScaledVector(basis.right, side * 14.42);
        transform.position.y = 4.2 + (index % 5) * 2.15;
        transform.rotation.set(0, yaw, 0);
        transform.scale.set(0.12, 0.16, depth * 0.72);
        transform.updateMatrix();
        windowBands.setMatrixAt(instance, transform.matrix);
        color.setHex(side === 1 ? 0xff76a3 : 0x78edff);
        windowBands.setColorAt(instance, color);
        instance += 1;
      }
    }
    buildings.instanceMatrix.needsUpdate = true;
    if (buildings.instanceColor) buildings.instanceColor.needsUpdate = true;
    windowBands.instanceMatrix.needsUpdate = true;
    if (windowBands.instanceColor) windowBands.instanceColor.needsUpdate = true;
    scene.add(buildings, windowBands);

    this.addRhythmGates(scene, track);
    this.addGround(scene);
  }

  private addRhythmGates(scene: THREE.Scene, track: Track): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x2c92ad,
      transparent: true,
      opacity: 0.48,
      blending: THREE.AdditiveBlending,
    });
    const postGeometry = new THREE.BoxGeometry(0.18, 1, 0.18);
    const beamGeometry = new THREE.BoxGeometry(1, 0.12, 0.18);
    for (let time = 4; time <= CONFIG.chartDuration + 3; time += 4) {
      const basis = track.getBasis(time);
      const gate = new THREE.Group();
      const left = new THREE.Mesh(postGeometry, material);
      const right = new THREE.Mesh(postGeometry, material);
      const beam = new THREE.Mesh(beamGeometry, material);
      left.position.set(-7.2, 5, 0);
      right.position.set(7.2, 5, 0);
      left.scale.y = 10;
      right.scale.y = 10;
      beam.position.y = 10;
      beam.scale.x = 14.5;
      gate.add(left, right, beam);
      gate.position.copy(basis.position);
      gate.position.y -= 5;
      gate.rotation.y = Math.atan2(basis.tangent.x, basis.tangent.z);
      scene.add(gate);
    }
  }

  private addGround(scene: THREE.Scene): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2600, 2600),
      new THREE.MeshStandardMaterial({ color: 0x0c1b27, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(400, -0.32, -750);
    scene.add(ground);
  }
}
