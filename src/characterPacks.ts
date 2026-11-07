import { builtinSkins, cyrene } from './initial';
import type { AppState, ArtStyle, Character, Skin } from './types';
import { usableCharacterSkin as usableSkin, selectedCharacterSkin } from './characterReadiness';

export interface CharacterPack {
  id: string;
  title: string;
  character: Character;
  skins: Skin[];
  origin: 'builtin' | 'saved';
}
const identity = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, '');
const cyreneNames = ['昔涟', 'Cyrene'].map(identity);
const starRailNames = ['崩坏：星穹铁道', 'Honkai: Star Rail'].map(identity);
const sameName = (a: string, b: string) =>
  identity(a) === identity(b) || (cyreneNames.includes(identity(a)) && cyreneNames.includes(identity(b)));
const sameWork = (a: string, b: string) =>
  identity(a) === identity(b) || (starRailNames.includes(identity(a)) && starRailNames.includes(identity(b)));

// Only advertise assets whose identity is already known. References and pending
// generated candidates are not finished character packs.
export function matchingCharacterPacks(state: AppState, name: string, work: string): CharacterPack[] {
  if (!identity(name)) return [];
  const matches = state.characters.filter(
    (character) => sameName(character.name, name) && (!work.trim() || sameWork(character.work, work)),
  );
  const packs: CharacterPack[] = matches.flatMap((character) => {
    const skins = state.skins.filter((skin) => usableSkin(skin, character));
    return skins.length
      ? [
          {
            id: character.id,
            title: `${character.name} · ${character.work || '原创角色'}`,
            character,
            skins,
            origin: 'saved' as const,
          },
        ]
      : [];
  });
  if (
    sameName(cyrene.name, name) &&
    (!work.trim() || sameWork(cyrene.work, work)) &&
    !packs.some(
      (pack) => sameName(pack.character.name, cyrene.name) && sameWork(pack.character.work, cyrene.work),
    )
  )
    packs.push({ ...starterPack, origin: 'builtin' });
  return packs;
}

export function activateCharacterPack(state: AppState, pack: CharacterPack): AppState {
  if (pack.origin === 'builtin') return installStarterPack(state, '8bit');
  const current = state.characters.find((character) => character.id === pack.character.id);
  if (
    !current ||
    !sameName(current.name, pack.character.name) ||
    !sameWork(current.work, pack.character.work)
  )
    throw new Error('这套角色包已改变，请重新选择。');
  const skins = state.skins.filter((skin) => usableSkin(skin, current));
  if (!skins.length) throw new Error('这套角色包已改变，请重新选择。');
  const selected = selectedCharacterSkin(state, current)!;
  return { ...state, activeCharacterId: current.id, activeSkinId: selected.id };
}

export const starterPack = {
  id: 'cyrene-companion-v1',
  title: '昔涟 · 此刻的陪伴',
  description: '复用项目中已制作的外观，配好本地互动台词。使用和播放不调用图像服务。',
  character: cyrene,
  skins: builtinSkins,
};
export function installStarterPack(state: AppState, style: ArtStyle): AppState {
  const existing = state.characters.find(
    (character) => sameName(character.name, cyrene.name) && sameWork(character.work, cyrene.work),
  );
  const characterId =
    existing?.id ||
    (state.characters.some((character) => character.id === cyrene.id) ? crypto.randomUUID() : cyrene.id);
  const packSkins = starterPack.skins.map((skin) => ({
    ...skin,
    characterId,
    id:
      characterId === cyrene.id
        ? skin.id
        : state.skins.find(
            (saved) =>
              saved.characterId === characterId &&
              saved.builtin === skin.builtin &&
              (!saved.review || saved.review.status === 'approved'),
          )?.id || crypto.randomUUID(),
  }));
  const selected = packSkins.find((skin) => skin.style === style) || packSkins[0];
  const missing = packSkins.filter(
    (skin) => !state.skins.some((saved) => saved.id === skin.id && saved.characterId === characterId),
  );
  return {
    ...state,
    characters: existing
      ? state.characters.map((character) =>
          character.id === existing.id && !character.companion
            ? { ...character, companion: structuredClone(cyrene.companion) }
            : character,
        )
      : [...state.characters, { ...structuredClone(cyrene), id: characterId }],
    skins: [...state.skins, ...structuredClone(missing)],
    activeCharacterId: characterId,
    activeSkinId: selected.id,
    messages: { ...state.messages, [characterId]: state.messages[characterId] || [] },
  };
}
