import type { ReactNode } from 'react';
import { Plus, Settings, Upload } from 'lucide-react';
import packageInfo from '../../../package.json';
import type { Character } from '../../types';

interface Props {
  characters: Character[];
  activeId: string;
  settingsActive: boolean;
  thumbnail: (character: Character) => ReactNode;
  onSelect: (character: Character) => void;
  onCreate: () => void;
  onImport: () => void;
  onHome: () => void;
  onSettings: () => void;
}

// One slim column: who you can talk to, how to add someone, and settings.
export function CharacterRail({
  characters,
  activeId,
  settingsActive,
  thumbnail,
  onSelect,
  onCreate,
  onImport,
  onHome,
  onSettings,
}: Props) {
  return (
    <nav className="room-rail" aria-label="角色列表">
      <button className="rail-brand" aria-label="Mori 首页" title={`Mori v${packageInfo.version}`} onClick={onHome}>
        m
      </button>
      <div className="rail-characters">
        {characters.map((character) => (
          <button
            key={character.id}
            className={`rail-avatar ${character.id === activeId ? 'active' : ''}`}
            aria-label={character.id === activeId ? `${character.name}（当前角色）` : character.name}
            aria-pressed={character.id === activeId}
            title={character.work ? `${character.name} · ${character.work}` : character.name}
            onClick={() => onSelect(character)}
          >
            {thumbnail(character)}
          </button>
        ))}
        <button className="rail-add" aria-label="添加角色" title="添加角色" onClick={onCreate}>
          <Plus size={20} />
        </button>
        <button className="rail-import" aria-label="导入角色包" title="导入角色包" onClick={onImport}>
          <Upload size={16} />
        </button>
      </div>
      <button
        className={`rail-settings ${settingsActive ? 'active' : ''}`}
        aria-label="连接与设置"
        aria-current={settingsActive ? 'page' : undefined}
        title="连接与设置"
        onClick={onSettings}
      >
        <Settings size={20} />
      </button>
    </nav>
  );
}
