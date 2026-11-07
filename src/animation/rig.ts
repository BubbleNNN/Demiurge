import type { PetAction } from '../types';
type Key = [number, number];
export function sampleCurve(keys: Key[], age: number): number {
  if (age <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (age <= keys[i][0]) {
      const [start, from] = keys[i - 1],
        [end, to] = keys[i];
      const t = (age - start) / (end - start),
        ease = t * t * (3 - 2 * t);
      return from + (to - from) * ease;
    }
  }
  return keys.at(-1)![1];
}
// Explicit local bone tracks on VRM's normalized humanoid, in radians.
// No continuous whole-body sine motion. Gestures settle into the rest pose.
export function vrmPose(action: PetAction, age: number, reduced = false) {
  const pose = { headX: 0, headY: 0, headZ: 0, upperArm: -1.15, lowerArm: 0, hand: 0, jump: 0 };
  if (reduced) return pose;
  if (action === 'wave') {
    pose.upperArm = sampleCurve(
      [
        [0, -1.15],
        [180, -1.05],
        [530, -0.55],
        [1630, -0.55],
        [2250, -1.15],
      ],
      age,
    );
    pose.lowerArm = sampleCurve(
      [
        [0, 0],
        [220, 0.35],
        [530, 1.7],
        [1630, 1.7],
        [2250, 0],
      ],
      age,
    );
    pose.hand = sampleCurve(
      [
        [0, 0],
        [560, 0],
        [760, -0.16],
        [990, 0.16],
        [1220, -0.16],
        [1450, 0.16],
        [1650, 0],
        [2250, 0],
      ],
      age,
    );
  } else if (action === 'nod') {
    pose.headX = sampleCurve(
      [
        [0, 0],
        [150, -0.03],
        [380, 0.12],
        [690, -0.02],
        [980, 0.085],
        [1400, 0],
      ],
      age,
    );
  } else if (action === 'shake') {
    pose.headY = sampleCurve(
      [
        [0, 0],
        [240, -0.14],
        [590, 0.14],
        [940, -0.11],
        [1290, 0.09],
        [1700, 0],
      ],
      age,
    );
  } else if (action === 'sleep') {
    pose.headX = sampleCurve(
      [
        [0, 0],
        [900, 0.14],
      ],
      age,
    );
    pose.headZ = sampleCurve(
      [
        [0, 0],
        [900, 0.08],
      ],
      age,
    );
  } else if (action === 'bounce') {
    pose.jump = sampleCurve(
      [
        [0, 0],
        [180, 0],
        [400, 0.06],
        [640, 0],
        [1000, 0],
      ],
      age,
    );
  }
  return pose;
}
export function vrmBlink(time: number) {
  const cycle = time % 14300;
  for (const start of [3100, 7800, 12700])
    if (cycle >= start && cycle < start + 160)
      return sampleCurve(
        [
          [0, 0],
          [65, 1],
          [110, 1],
          [160, 0],
        ],
        cycle - start,
      );
  return 0;
}
