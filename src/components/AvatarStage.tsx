import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Box, LoaderCircle, UserRound, AlertCircle } from 'lucide-react';
import type { Emotion, PetAction, Skin } from '../types';
import { skinImage } from '../theme';
import { spriteAnimation } from '../artwork';
import { SkinArtwork } from './SkinArtwork';
import { vrmPose, vrmBlink } from '../animation/rig';
import { AnimatedIllustration } from './AnimatedIllustration';
import { GeneratedModelStage } from './GeneratedModelStage';

interface Props {
  skin?: Skin;
  emotion: Emotion;
  action: PetAction;
  actionKey?: number;
  talking?: boolean;
  audioDriven?: boolean;
  motionEnabled?: boolean;
  mouth: MutableRefObject<number>;
  tracking?: boolean;
  zoom?: number;
  compact?: boolean;
}
let coreLoading: Promise<void> | null = null;
function loadCore() {
  if ((window as unknown as { Live2DCubismCore?: unknown }).Live2DCubismCore) return Promise.resolve();
  if (!coreLoading)
    coreLoading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('./vendor/live2dcubismcore.min.js', location.href).href;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        coreLoading = null;
        reject(new Error('未找到 Live2D Core。请运行 pnpm setup:live2d 后重启开发版。'));
      };
      document.head.appendChild(script);
    });
  return coreLoading;
}
export function AvatarStage({
  skin,
  emotion,
  action,
  actionKey = 0,
  talking = false,
  audioDriven = false,
  motionEnabled = true,
  mouth,
  tracking = true,
  zoom = 1,
  compact = false,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<any>(null);
  const live = useRef({ emotion, action, mouth, tracking, zoom, motionEnabled });
  live.current = { emotion, action, mouth, tracking, zoom, motionEnabled };
  const actionStarted = useRef(performance.now());
  useEffect(() => {
    actionStarted.current = performance.now();
  }, [action, actionKey]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const kind = skin?.kind || 'image';
  useEffect(() => {
    setError('');
    if (kind === 'image' || kind === 'glb' || !skin?.model || !host.current) return;
    let disposed = false;
    let cleanup = () => {};
    const release = () => {
      const dispose = cleanup;
      cleanup = () => {};
      dispose();
    };
    setLoading(true);
    const node = host.current;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const modelSpec = skin.model;
    const url = `mori-asset://models/${modelSpec.id}/${modelSpec.entry.split('/').map(encodeURIComponent).join('/')}`;
    (async () => {
      if (kind === 'live2d') {
        await loadCore();
        const PIXI = await import('pixi.js');
        const unsafeEval = await import('@pixi/unsafe-eval');
        unsafeEval.install(PIXI);
        const { Live2DModel, config } = await import('pixi-live2d-display/cubism4');
        config.sound = false;
        Live2DModel.registerTicker(PIXI.Ticker);
        if (disposed) return;
        const app = new PIXI.Application({
          width: node.clientWidth || 500,
          height: node.clientHeight || 600,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(devicePixelRatio, 2),
          autoDensity: true,
        });
        node.appendChild(app.view);
        let model: any;
        const resize = () => {
          if (!model) return;
          app.renderer.resize(node.clientWidth, node.clientHeight);
          model.scale.set(1);
          const scale =
            Math.min(node.clientWidth / model.width, node.clientHeight / model.height) *
            0.91 *
            live.current.zoom;
          model.scale.set(scale);
          model.anchor.set(0.5, 1);
          model.position.set(node.clientWidth / 2, node.clientHeight * 0.97);
        };
        const observer = new ResizeObserver(resize);
        observer.observe(node);
        cleanup = () => {
          observer.disconnect();
          runtime.current = null;
          app.destroy(true, { children: true, texture: true, baseTexture: true });
        };
        model = await Live2DModel.from(url, { autoInteract: false, autoUpdate: false });
        if (disposed) {
          model.destroy();
          return;
        }
        app.stage.addChild(model);
        runtime.current = { kind, model, resize };
        resize();
        app.ticker.add(() => {
          if (document.hidden) return;
          const reduced = media.matches || !live.current.motionEnabled;
          if (reduced || !live.current.tracking) model.internalModel.focusController.focus(0, 0);
          model.update(reduced ? 0 : Math.min(app.ticker.deltaMS, 50));
        });
        model.internalModel.on('beforeModelUpdate', () => {
          model.internalModel.coreModel.setParameterValueById(
            'ParamMouthOpenY',
            media.matches || !live.current.motionEnabled ? 0 : live.current.mouth.current,
          );
        });
        const pointer = (event: PointerEvent) => {
          if (!live.current.tracking || media.matches || !live.current.motionEnabled) {
            model.internalModel.focusController.focus(0, 0);
            return;
          }
          const bounds = node.getBoundingClientRect();
          model.internalModel.focusController.focus(
            ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
            1 - ((event.clientY - bounds.top) / bounds.height) * 2,
          );
        };
        window.addEventListener('pointermove', pointer);
        const previous = cleanup;
        cleanup = () => {
          window.removeEventListener('pointermove', pointer);
          previous();
        };
      } else {
        const THREE = await import('three');
        const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
        const { VRMLoaderPlugin, VRMUtils } = await import('@pixiv/three-vrm');
        if (disposed) return;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setClearColor(0, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        node.appendChild(renderer.domElement);
        scene.add(new THREE.HemisphereLight(0xffeef6, 0x889ac5, 1.2));
        const light = new THREE.DirectionalLight(0xffffff, 1.3);
        light.position.set(-1, 2, 3);
        scene.add(light);
        let vrm: any;
        let frame = 0;
        let elapsed = 0;
        let last = performance.now();
        const focus = new THREE.Object3D();
        scene.add(focus);
        focus.position.set(0, 1.3, 3);
        const resize = () => {
          renderer.setSize(node.clientWidth, node.clientHeight);
          camera.aspect = node.clientWidth / node.clientHeight;
          camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(node);
        resize();
        cleanup = () => {
          cancelAnimationFrame(frame);
          observer.disconnect();
          if (vrm) VRMUtils.deepDispose(vrm.scene);
          renderer.dispose();
          renderer.domElement.remove();
          runtime.current = null;
        };
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));
        const gltf = await loader.loadAsync(url);
        vrm = gltf.userData.vrm;
        if (!vrm) throw new Error('此文件未包含可播放的 VRM 角色。');
        if (disposed) {
          VRMUtils.deepDispose(vrm.scene);
          return;
        }
        VRMUtils.rotateVRM0(vrm);
        scene.add(vrm.scene);
        const box = new THREE.Box3().setFromObject(vrm.scene);
        const height = box.max.y - box.min.y;
        camera.position.set(0, height * 0.52, height * 2.3);
        camera.lookAt(0, height * 0.48, 0);
        if (vrm.lookAt) vrm.lookAt.target = focus;
        runtime.current = { kind, model: vrm, resize };
        const tick = (now: number) => {
          const dt = Math.min((now - last) / 1000, 0.05);
          last = now;
          const current = live.current;
          const reduced = media.matches || !current.motionEnabled;
          if (document.hidden) {
            frame = requestAnimationFrame(tick);
            return;
          }
          if (!reduced) elapsed += dt;
          const face =
            current.emotion === 'sleepy'
              ? 'relaxed'
              : current.emotion === 'thinking'
                ? 'neutral'
                : current.emotion;
          for (const name of ['happy', 'sad', 'relaxed', 'surprised'])
            vrm.expressionManager?.setValue(name, name === face ? 0.7 : 0);
          vrm.expressionManager?.setValue('aa', reduced ? 0 : current.mouth.current);
          vrm.expressionManager?.setValue(
            'blink',
            current.action === 'sleep' ? 1 : reduced ? 0 : vrmBlink(elapsed * 1000),
          );
          const pose = vrmPose(current.action, now - actionStarted.current, reduced);
          const head = vrm.humanoid?.getNormalizedBoneNode('head');
          if (head) {
            head.rotation.set(pose.headX, pose.headY, pose.headZ);
          }
          const arm = vrm.humanoid?.getNormalizedBoneNode('leftUpperArm');
          if (arm) arm.rotation.z = pose.upperArm;
          const forearm = vrm.humanoid?.getNormalizedBoneNode('leftLowerArm');
          if (forearm) forearm.rotation.z = pose.lowerArm;
          const hand = vrm.humanoid?.getNormalizedBoneNode('leftHand');
          if (hand) hand.rotation.z = pose.hand;
          const otherArm = vrm.humanoid?.getNormalizedBoneNode('rightUpperArm');
          if (otherArm) otherArm.rotation.z = 1.15;
          vrm.scene.position.y = height * pose.jump;
          vrm.scene.scale.setScalar(current.zoom);
          vrm.update(reduced ? 0 : dt);
          renderer.render(scene, camera);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        const pointer = (e: PointerEvent) => {
          const b = node.getBoundingClientRect();
          focus.position.set(
            live.current.tracking && !media.matches && live.current.motionEnabled
              ? ((e.clientX - b.left) / b.width - 0.5) * 1.3
              : 0,
            height * 0.75,
            3,
          );
        };
        window.addEventListener('pointermove', pointer);
        const previous = cleanup;
        cleanup = () => {
          window.removeEventListener('pointermove', pointer);
          previous();
        };
      }
      if (!disposed) setLoading(false);
    })().catch((e) => {
      release();
      if (!disposed) {
        setLoading(false);
        setError(e.message || '模型加载失败，请检查格式与资源。');
      }
    });
    return () => {
      disposed = true;
      release();
    };
  }, [skin?.id, kind]);
  useEffect(() => {
    runtime.current?.resize?.();
  }, [zoom]);
  useEffect(() => {
    const rt = runtime.current;
    if (rt?.kind !== 'live2d' || !skin?.model) return;
    const spec = skin.model;
    const mapped = spec.expressionMap?.[emotion];
    const match = mapped || spec.expressions.find((name) => name.toLowerCase().includes(emotion));
    if (match) void rt.model.expression(match);
    else rt.model.internalModel.motionManager.expressionManager?.resetExpression();
    const group =
      spec.motionMap?.[action] ||
      Object.keys(spec.motions).find((name) => name.toLowerCase() === action) ||
      (action === 'idle' ? Object.keys(spec.motions).find((name) => /idle/i.test(name)) : undefined);
    if (group && spec.motions[group])
      void rt.model.motion(group, actionKey % spec.motions[group], action === 'idle' ? 1 : 3);
  }, [emotion, action, actionKey, skin?.model, loading]);
  const image = skinImage(skin, action === 'sleep' ? 'sleepy' : emotion);
  if (kind === 'glb' && skin)
    return (
      <GeneratedModelStage
        skin={skin}
        action={action}
        actionKey={actionKey}
        motionEnabled={motionEnabled}
        zoom={zoom}
      />
    );
  return (
    <div className={`avatar-stage ${compact ? 'compact' : ''} ${kind}`} data-art-style={skin?.style}>
      {kind === 'image' ? (
        image && skin && spriteAnimation(skin) ? (
          <AnimatedIllustration
            skin={skin}
            emotion={emotion}
            action={action}
            actionKey={actionKey}
            talking={talking}
            audioDriven={audioDriven}
            mouth={mouth}
            tracking={tracking}
            zoom={zoom}
            enabled={motionEnabled}
          />
        ) : image ? (
          <div
            className={`illustration-motion action-${action} ${talking ? 'reply-pulse' : ''}`}
            style={{ '--avatar-zoom': zoom } as React.CSSProperties}
          >
            <SkinArtwork
              skin={skin}
              emotion={action === 'sleep' ? 'sleepy' : emotion}
              alt={`${skin?.name}角色立绘`}
            />
          </div>
        ) : (
          <div className="avatar-empty">
            <UserRound size={44} />
            <strong>让角色拥有自己的模样</strong>
            <span>使用角色原图，或导入立绘、动画与模型</span>
          </div>
        )
      ) : (
        <div className="model-canvas" ref={host} />
      )}
      {loading && (
        <div className="model-status">
          <LoaderCircle className="spin" size={22} />
          <span>正在加载 {kind === 'live2d' ? 'Live2D' : 'VRM'} 模型</span>
        </div>
      )}
      {error && (
        <div className="model-status error">
          <AlertCircle size={24} />
          <strong>模型暂时无法显示</strong>
          <span>{error}</span>
        </div>
      )}
      {!skin && !image && <Box className="asset-placeholder-mark" size={16} />}
    </div>
  );
}
