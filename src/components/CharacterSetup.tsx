import { Check, Film, ImagePlus, MessageCircle, Palette } from 'lucide-react';
import { Modal } from './Modal';
import { ReferencePanel } from './ReferencePanel';
import { supportsAction } from '../artwork';
import type { Character, Skin, VisualReference } from '../types';

export function CharacterSetup({
  character,
  skins,
  activeSkinId,
  onReferences,
  onUseOriginal,
  onGenerate,
  onDone,
}: {
  character: Character;
  skins: Skin[];
  activeSkinId: string;
  onReferences: (references: VisualReference[]) => Promise<void>;
  onUseOriginal: () => Promise<void>;
  onGenerate: () => void;
  onDone: () => void;
}) {
  const active = skins.find((skin) => skin.id === activeSkinId);
  const animated = skins.some(
    (skin) =>
      supportsAction(skin, 'wave') ||
      supportsAction(skin, 'nod') ||
      supportsAction(skin, 'bounce') ||
      supportsAction(skin, 'sleep'),
  );
  return (
    <Modal
      title={`为${character.name}准备外观与动作`}
      subtitle="新角色拥有自己的档案和素材；先保留真实长相，再逐步补齐画风与动作。"
      wide
      onClose={onDone}
    >
      <div className="character-setup" aria-label="新角色外观设置">
        <div className="setup-status">
          <span>
            <Check size={16} />
            独立角色档案
          </span>
          <span className={active ? 'complete' : ''}>
            <ImagePlus size={16} />
            {active ? '已有启用外观' : '待选择外观'}
          </span>
          <span className={animated ? 'complete' : ''}>
            <Film size={16} />
            {animated ? '已有动作素材' : '待添加动作素材'}
          </span>
        </div>
        <ReferencePanel
          character={character}
          references={character.visualReferences || []}
          onChange={onReferences}
          onUseOriginal={onUseOriginal}
        />
        <div className="setup-routes">
          <button onClick={onGenerate} aria-label="打开桌宠工作台">
            <Palette size={22} />
            <strong>进入桌宠工作台</strong>
            <p>制作角色形象、表情与动作，或导入已有素材，核对后直接使用。</p>
          </button>
        </div>
        <div className="notice">
          <MessageCircle size={17} />
          <p>
            名字只能用于匹配资料和素材，不能凭空得到角色独有的原画。没有匹配资源时，可以先用核对过的原图作为静态桌宠；本地互动使用通用回应，角色语气可在互动台词中补充。
          </p>
        </div>
        <button className="button primary full" onClick={onDone}>
          {active ? '完成，回到角色主页' : '稍后补充素材，保留角色档案'}
        </button>
      </div>
    </Modal>
  );
}
