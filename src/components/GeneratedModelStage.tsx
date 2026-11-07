import { useEffect, useRef, useState } from 'react';
import { AlertCircle, LoaderCircle } from 'lucide-react';
import type { PetAction, Skin } from '../types';
import { vrmPose } from '../animation/rig';
import { mappedBone } from '../animation/model';

export function GeneratedModelStage({
  skin,
  action,
  actionKey,
  motionEnabled,
  zoom,
}: {
  skin: Skin;
  action: PetAction;
  actionKey: number;
  motionEnabled: boolean;
  zoom: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef({ action, actionKey, motionEnabled, zoom });
  live.current = { action, actionKey, motionEnabled, zoom };
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!host.current || !skin.model) return;
    const node = host.current,
      spec = skin.model;
    let disposed = false,
      cleanup = () => {};
    setLoading(true);
    setError('');
    void (async () => {
      const THREE = await import('three');
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      if (disposed) return;
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      node.appendChild(renderer.domElement);
      const scene = new THREE.Scene(),
        group = new THREE.Group();
      scene.add(group, new THREE.HemisphereLight(0xfff5fa, 0x6e7d99, 2));
      const light = new THREE.DirectionalLight(0xffffff, 2.5);
      light.position.set(-2, 3, 4);
      scene.add(light);
      const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
      const resize = () => {
        renderer.setSize(node.clientWidth || 400, node.clientHeight || 500);
        camera.aspect = (node.clientWidth || 400) / (node.clientHeight || 500);
        camera.updateProjectionMatrix();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(node);
      resize();
      let model: any,
        mixer: any,
        frame = 0;
      cleanup = () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
        mixer?.stopAllAction();
        model?.traverse((object: any) => {
          object.geometry?.dispose();
          for (const material of Array.isArray(object.material)
            ? object.material
            : object.material
              ? [object.material]
              : []) {
            for (const value of Object.values(material))
              if ((value as any)?.isTexture) (value as any).dispose();
            material.dispose();
          }
        });
        renderer.dispose();
        renderer.domElement.remove();
      };
      const gltf = await new GLTFLoader().loadAsync(`mori-asset://models/${spec.id}/${spec.entry}`);
      model = gltf.scene;
      if (disposed) {
        cleanup();
        return;
      }
      const box = new THREE.Box3().setFromObject(model),
        size = box.getSize(new THREE.Vector3()),
        center = box.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('模型没有可显示的尺寸。');
      model.position.sub(center);
      group.add(model);
      const distance =
        (Math.max(size.y, size.x / camera.aspect) / (2 * Math.tan(THREE.MathUtils.degToRad(15)))) * 1.15;
      camera.position.set(0, 0, distance);
      camera.lookAt(0, 0, 0);
      mixer = new THREE.AnimationMixer(model);
      const bones: any[] = [];
      model.traverse((object: any) => {
        if (object.isBone) bones.push({ object, rotation: object.quaternion.clone() });
      });
      const restore = () => {
        mixer.stopAllAction();
        for (const bone of bones) bone.object.quaternion.copy(bone.rotation);
      };
      const head = mappedBone(model, spec.boneMap?.head);
      const restHead = head?.rotation.clone();
      const media = matchMedia('(prefers-reduced-motion: reduce)');
      let last = performance.now(),
        started = last,
        previous = '',
        clipRunning = false;
      mixer.addEventListener('finished', () => {
        restore();
        clipRunning = false;
      });
      const tick = (now: number) => {
        if (disposed) return;
        const dt = Math.min((now - last) / 1000, 0.05);
        last = now;
        const current = live.current,
          enabled = current.motionEnabled && !media.matches;
        const key = `${current.action}:${current.actionKey}:${enabled}`;
        if (key !== previous) {
          restore();
          clipRunning = false;
          started = now;
          previous = key;
          const name = spec.motionMap?.[current.action];
          const clip = gltf.animations.find((c) => c.name === name);
          if (enabled && clip) {
            const playback = mixer.clipAction(clip);
            playback.setLoop(
              current.action === 'idle' ? THREE.LoopRepeat : THREE.LoopOnce,
              current.action === 'idle' ? Infinity : 1,
            );
            playback.clampWhenFinished = false;
            playback.play();
            clipRunning = true;
          }
        }
        if (!document.hidden) {
          if (enabled) mixer.update(dt);
          if (head && restHead && !clipRunning) {
            head.rotation.copy(restHead);
            const pose = vrmPose(
              current.action === 'nod' || current.action === 'shake' ? current.action : 'idle',
              now - started,
              !enabled,
            );
            head.rotation.x += pose.headX;
            head.rotation.y += pose.headY;
          }
          group.scale.setScalar(current.zoom);
          renderer.render(scene, camera);
        }
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      setLoading(false);
    })().catch((e) => {
      cleanup();
      if (!disposed) {
        setError(e.message || '生成模型无法显示。');
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
      cleanup();
    };
  }, [skin.id]);
  return (
    <div className="avatar-stage glb">
      <div className="model-canvas" ref={host} />
      {loading && (
        <div className="model-status">
          <LoaderCircle className="spin" size={22} />
          <span>正在加载生成的 3D 模型</span>
        </div>
      )}
      {error && (
        <div className="model-status error">
          <AlertCircle size={24} />
          <strong>模型暂时无法显示</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
