import type { Bone, Object3D } from 'three';

export function mappedBone(model: Object3D, originalName?: string): Bone | undefined {
  if (!originalName) return undefined;
  let result: Bone | undefined;
  // GLTFLoader removes punctuation from node names for animation bindings. It
  // retains the original name in userData, including common mixamorig:Head.
  model.traverse((node) => {
    if (
      !result &&
      (node as Bone).isBone &&
      (node.name === originalName || node.userData.name === originalName)
    )
      result = node as Bone;
  });
  return result;
}
