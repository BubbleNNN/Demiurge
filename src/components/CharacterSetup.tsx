import { Check, Film, FolderHeart, ImagePlus, MessageCircle, Palette } from 'lucide-react';
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
  onAssets,
  onPacks,
  onGenerate,
  onDone,
}: {
  character: Character;
  skins: Skin[];
  activeSkinId: string;
  onReferences: (references: VisualReference[]) => Promise<void>;
  onUseOriginal: () => Promise<void>;
  onAssets: () => void;
  onPacks: () => void;
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
          <button onClick={onAssets} aria-label="为新角色导入外观与动作">
            <Film size={22} />
            <strong>导入现成外观与动作</strong>
            <p>立绘、PNG 动画帧、Aseprite 精灵图、Live2D 或 VRM。导入后试播，再保存。</p>
          </button>
          <button onClick={onPacks} aria-label="为新角色导入角色包">
            <FolderHeart size={22} />
            <strong>导入或编辑角色包</strong>
            <p>导入包含人物设定和素材的完整角色包；也可以编写这个角色的本地互动台词。</p>
          </button>
          <button onClick={onGenerate} aria-label="为新角色生成其他画风">
            <Palette size={22} />
            <strong>制作其他画风</strong>
            <p>查看各画风的制作方式。图像服务可以选用；一张原图本身不包含其他画风或新的肢体动作。</p>
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
