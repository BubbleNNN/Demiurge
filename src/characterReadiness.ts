import { availableStyle } from './theme';
import { spriteAnimation, supportsAction } from './artwork';
import type { AppState, Character, Skin } from './types';

export function usableCharacterSkin(skin: Skin, character: Character) {
  return (
    skin.characterId === character.id &&
    availableStyle(skin.style) &&
    (!skin.review || skin.review.status === 'approved') &&
    (!skin.generation ||
      (skin.review?.status === 'approved' &&
        JSON.stringify(skin.generation.referenceIds) ===
          JSON.stringify((character.visualReferences || []).map((ref) => ref.id))))
  );
}

export function selectedCharacterSkin(state: AppState, character: Character) {
  const available = state.skins.filter((skin) => usableCharacterSkin(skin, character));
  return (
    available.find((skin) => skin.id === state.preferredSkins?.[character.id]) ||
    available.find((skin) => skin.id === state.activeSkinId) ||
    available.find((skin) => spriteAnimation(skin)) ||
    available[0]
  );
}

export function characterReadiness(character: Character, skins: Skin[]) {
  const available = skins.filter((skin) => usableCharacterSkin(skin, character));
  return {
    reference: Boolean(character.visualReferences?.length),
    appearance: available.length > 0,
    animation: available.some(
      (skin) =>
        (spriteAnimation(skin)?.frames.length || 0) > 1 ||
        supportsAction(skin, 'wave') ||
        supportsAction(skin, 'nod') ||
        supportsAction(skin, 'sleep'),
    ),
    voice: Boolean(character.speakingStyle.trim() || character.roleplay?.voiceRules.length),
    interaction: Object.values(character.companion?.replies || {}).some((lines) => lines?.length),
  };
}

export function nextCharacterStep(character: Character, skins: Skin[]) {
  const status = characterReadiness(character, skins);
  if (!status.appearance && !status.reference)
    return {
      key: 'reference' as const,
      title: character.referenceCandidates?.length ? '核对已找到的参考图' : '先准备一张角色原图',
      description: character.referenceCandidates?.length
        ? '候选图片已经保存在本机，选择正确的身份、服装与形态即可继续。'
        : '可以收集或导入原图，之后直接用作静态桌宠。',
    };
  if (!status.appearance)
    return {
      key: 'appearance' as const,
      title: '让原图成为第一套外观',
      description: '参考图已准备好。确认主参考后，可以直接启用，或导入现成动画。',
    };
  if (!status.voice)
    return {
      key: 'voice' as const,
      title: '补上角色说话的方式',
      description: '写下称呼、句式与相处关系，让回复更接近你认识的角色。',
    };
  if (!status.interaction)
    return {
      key: 'interaction' as const,
      title: '给日常互动配上台词',
      description: '为问候、轻触和休息编写几句回应，不需要每次调用模型。',
    };
  if (!status.animation)
    return {
      key: 'animation' as const,
      title: '为现有外观补充动作',
      description: '静态桌宠已经可以使用。导入完整姿势帧后，再增加眨眼、招手与说话动作。',
    };
  return null;
}

// A saved profile is still a resumable character when artwork collection failed.
export function existingCharacter(state: AppState, name: string, work: string) {
  const key = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}]/gu, '');
  if (!key(name)) return undefined;
  return state.characters.find(
    (character) => key(character.name) === key(name) && key(character.work) === key(work),
  );
}
