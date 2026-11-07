import { ArrowUpRight, Check, Film, ImagePlus, MessageCircle, Palette } from 'lucide-react';
import { characterReadiness, nextCharacterStep } from '../characterReadiness';
import type { Character, Skin } from '../types';

export function CharacterReadiness({
  character,
  skins,
  onSetup,
  onVoice,
  onInteraction,
  onAnimation,
}: {
  character: Character;
  skins: Skin[];
  onSetup: () => void;
  onVoice: () => void;
  onInteraction: () => void;
  onAnimation: () => void;
}) {
  const status = characterReadiness(character, skins);
  const next = nextCharacterStep(character, skins);
  const steps = [
    { key: 'reference', label: '角色原图', icon: ImagePlus, done: status.reference, run: onSetup },
    { key: 'appearance', label: '启用外观', icon: Palette, done: status.appearance, run: onSetup },
    { key: 'animation', label: '互动动作', icon: Film, done: status.animation, run: onAnimation },
    { key: 'voice', label: '角色语气', icon: MessageCircle, done: status.voice, run: onVoice },
    {
      key: 'interaction',
      label: '日常台词',
      icon: MessageCircle,
      done: status.interaction,
      run: onInteraction,
    },
  ];
  if (!next) return null;
  const continueStep = steps.find((step) => step.key === next.key)!;
  return (
    <section className="character-readiness" aria-label="角色准备进度">
      <div>
        <span className="eyebrow">从相识，到日常</span>
        <h2>继续认识{character.name}</h2>
        <p>档案已保存在本机。按需要补充，随时回来继续。</p>
      </div>
      <div className="readiness-next">
        <div>
          <strong>{next.title}</strong>
          <p>{next.description}</p>
        </div>
        <button className="button secondary" onClick={continueStep.run}>
          继续这一步
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="readiness-steps">
        {steps.map((step) => (
          <button key={step.key} onClick={step.run} className={step.done ? 'complete' : ''}>
            {step.done ? <Check size={16} /> : <step.icon size={16} />}
            <span>
              {step.label}
              <small>{step.done ? '已准备' : '继续完善'}</small>
            </span>
            <ArrowUpRight size={13} />
          </button>
        ))}
      </div>
    </section>
  );
}
