import * as THREE from 'three';
import { CONFIG } from './config';
import type { FrameBasis } from './types';

export class Track {
  private readonly duration = CONFIG.chartDuration + 4;
  private readonly curve = new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(0, 8, 30),
      new THREE.Vector3(0, 15, -335),
      new THREE.Vector3(0, 25, -685),
      new THREE.Vector3(332, 11, -822),
      new THREE.Vector3(683, 31, -822),
      new THREE.Vector3(826, 16, -1179),
      new THREE.Vector3(826, 7, -1550),
      new THREE.Vector3(507, 27, -1693),
      new THREE.Vector3(117, 13, -1693),
    ],
    false,
    'centripetal',
    0.5,
  );
  private readonly position = new THREE.Vector3();
  private readonly tangent = new THREE.Vector3();
  private readonly right = new THREE.Vector3();

  getCenter(time: number, target = new THREE.Vector3()): THREE.Vector3 {
    const progress = THREE.MathUtils.clamp(time / this.duration, 0, 1);
    return this.curve.getPoint(progress, target);
  }

  getBasis(time: number): FrameBasis {
    const progress = THREE.MathUtils.clamp(time / this.duration, 0, 1);
    this.curve.getPoint(progress, this.position);
    this.curve.getTangent(progress, this.tangent).normalize();
    this.right.set(-this.tangent.z, 0, this.tangent.x).normalize();
    return {
      position: this.position.clone(),
      tangent: this.tangent.clone(),
      right: this.right.clone(),
    };
  }

  getNotePosition(
    targetTime: number,
    lane: number,
    height: number,
    target = new THREE.Vector3(),
  ): THREE.Vector3 {
    const basis = this.getBasis(targetTime + CONFIG.noteDistance / CONFIG.trackSpeed);
    return target.copy(basis.position)
      .addScaledVector(basis.right, lane)
      .setY(basis.position.y + height);
  }

  getHeading(time: number): number {
    const basis = this.getBasis(time);
    return Math.atan2(-basis.tangent.x, -basis.tangent.z);
  }
}
