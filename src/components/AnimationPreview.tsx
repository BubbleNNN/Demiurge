import { useRef, useState } from 'react';
import { AvatarStage } from './AvatarStage';
import { supportsAction, supportsEmotion } from '../artwork';
import { spriteAnimation } from '../artwork';
import type { Emotion, PetAction, Skin } from '../types';
const actions: Record<PetAction, string> = {
  walk_left:'向左跑',walk_right:'向右跑',walk_up:'向后跑',walk_down:'向前跑',drag:'被拎起',listen:'倾听',sit:'坐下',lie:'趴着',
  office:'办公',
  idle: '待机',
  wave: '招手',
  read: '读书',
  gaming: '玩掌机',
  snack: '吃点心',
  music: '听音乐',
  diary: '写日记',
  nod: '点头',
  shake: '摇头',
  bounce: '跳跃',
  sleep: '睡眠',
};
const emotions: Record<Emotion, string> = {
  neutral: '平静',
  happy: '开心',
  thinking: '思考',
  sad: '难过',
  sleepy: '困倦',
  surprised: '惊讶',
};
export function AnimationPreview({ skin, comparisonSkin }: { skin: Skin; comparisonSkin?: Skin }) {
  const [action, setAction] = useState<PetAction>('idle');
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [actionKey, setActionKey] = useState(0);
  const [talking, setTalking] = useState(false);
  const mouth = useRef(0);
  const previewSkins = comparisonSkin ? [comparisonSkin, skin] : [skin];
  const canTalk = (item: Skin) =>
    item.kind === 'image' || !item.kind ? !!spriteAnimation(item)?.clips.talk : item.kind !== 'glb';
  return (
    <section
      className="candidate-animation"
      aria-label={comparisonSkin ? '修正前后动作对比' : '候选动作预览'}
    >
      <div>
        <h4>{comparisonSkin ? '对比这次修正，动作有没有更自然' : '先试试她的动作'}</h4>
        <p>
          {comparisonSkin
            ? '两边同时试播同一个动作，可反复点击重播。核对后再决定是否启用修正版。'
            : '预览不会更换当前桌宠。确认形象后，这些动作可随聊天触发。'}
        </p>
      </div>
      <div className={comparisonSkin ? 'candidate-animation-pair' : ''}>
        {previewSkins.map((item, index) => (
          <div key={item.id}>
            {comparisonSkin && (
              <p className="candidate-animation-label">{index === 0 ? '修正前' : '本次修正版'}</p>
            )}
            <div
              className="candidate-animation-stage"
              aria-label={comparisonSkin ? (index === 0 ? '修正前动作' : '修正后动作') : undefined}
            >
              <AvatarStage
                skin={item}
                emotion={emotion}
                action={action}
                actionKey={actionKey}
                talking={talking}
                mouth={mouth}
                motionEnabled
                tracking={false}
                zoom={0.85}
                compact
              />
            </div>
          </div>
        ))}
      </div>
      <div className="toolbar" aria-label="试播动作">
        {Object.entries(actions).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`button ${action === value ? 'primary' : 'secondary'}`}
            disabled={!previewSkins.every((item) => supportsAction(item, value as PetAction))}
            aria-label={`预览${label}动作`}
            onClick={() => {
              setAction(value as PetAction);
              setEmotion(value === 'sleep' ? 'sleepy' : 'neutral');
              setTalking(false);
              setActionKey((key) => key + 1);
            }}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className={`button ${talking ? 'primary' : 'secondary'}`}
          aria-pressed={talking}
          disabled={!previewSkins.every(canTalk)}
          onClick={() => {
            setAction('idle');
            setTalking((old) => !old);
          }}
        >
          试播说话
        </button>
      </div>
      <div className="toolbar" aria-label="试播表情">
        {Object.entries(emotions).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="text-button"
            disabled={!previewSkins.every((item) => supportsEmotion(item, value as Emotion))}
            aria-pressed={emotion === value}
            onClick={() => {
              setEmotion(value as Emotion);
              setAction('idle');
              setTalking(false);
              setActionKey((key) => key + 1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
