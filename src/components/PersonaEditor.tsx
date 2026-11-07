import { BookOpen, ShieldCheck, Heart, Sparkles } from 'lucide-react';
import type { Character } from '../types';
export function PersonaEditor({
  character,
  onChange,
}: {
  character: Character;
  onChange: (value: Character) => void;
}) {
  const role = character.roleplay || {
    timeline: '',
    relationship: '',
    voiceRules: [],
    avoid: [],
    customFacts: [],
    spoilerPolicy: 'avoid' as const,
  };
  const update = (fields: Partial<typeof role>) =>
    onChange({ ...character, roleplay: { ...role, ...fields } });
  const lines = (value: string) => value.split('\n');
  return (
    <section className="persona-editor">
      <div className="persona-heading">
        <ShieldCheck size={19} />
        <div>
          <h3>让她保持自己的样子</h3>
          <p>设定阶段、相处关系和说话习惯。每次对话都以这里为准。</p>
        </div>
      </div>
      <div className="form-row">
        <label>
          剧情阶段 / 场景
          <input
            maxLength={1000}
            value={role.timeline}
            onChange={(e) => update({ timeline: e.target.value })}
            placeholder="例如：初次相识后的日常，不主动谈结局"
          />
        </label>
        <label>
          与你的关系
          <input
            maxLength={1000}
            value={role.relationship}
            onChange={(e) => update({ relationship: e.target.value })}
            placeholder="朋友、同行者，或你自行创作的关系"
          />
        </label>
      </div>
      <label>
        <span>
          <Sparkles size={14} /> 语气习惯 · 每行一条
        </span>
        <textarea
          rows={3}
          maxLength={4800}
          value={role.voiceRules.join('\n')}
          aria-label="语气习惯"
          onChange={(e) => update({ voiceRules: lines(e.target.value) })}
          placeholder="短句还是长句？怎样表达关心？有哪些自然的口头禅？"
        />
      </label>
      <label>
        <span>
          <ShieldCheck size={14} /> 应避免的表达 · 每行一条
        </span>
        <textarea
          rows={3}
          maxLength={4800}
          value={role.avoid.join('\n')}
          aria-label="应避免的表达"
          onChange={(e) => update({ avoid: lines(e.target.value) })}
          placeholder="例如：不要混入另一角色的经历；不要擅自设定恋爱关系"
        />
      </label>
      <label>
        <span>
          <Heart size={14} /> 你的创作设定 · 每行一条
        </span>
        <textarea
          rows={3}
          maxLength={12000}
          value={role.customFacts.join('\n')}
          aria-label="创作设定"
          onChange={(e) => update({ customFacts: lines(e.target.value) })}
          placeholder="只在你的陪伴空间生效，和原作资料分开"
        />
        <small>这些设定不会被标记成原作事实，也不会被联网更新覆盖。</small>
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={role.spoilerPolicy === 'avoid'}
          onChange={(e) => update({ spoilerPolicy: e.target.checked ? 'avoid' : 'allow' })}
        />
        <BookOpen size={15} /> 日常对话不主动剧透
      </label>
      <div className="persona-tempo">
        <h3>相处的节奏</h3>
        <p>作为对话与动作的表达倾向，关系仍以你填写的设定为准。</p>
        <div>
          {(
            [
              ['energy', '活跃程度', '更安静', '更活泼'],
              ['affection', '表达关心', '更克制', '更亲近'],
              ['curiosity', '好奇程度', '少些追问', '主动了解'],
            ] as const
          ).map(([field, label, low, high]) => (
            <label key={field}>
              <span>
                {label}
                <output>{character.behavior[field]}%</output>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                aria-label={label}
                value={character.behavior[field]}
                onChange={(e) =>
                  onChange({
                    ...character,
                    behavior: { ...character.behavior, [field]: Number(e.target.value) },
                  })
                }
              />
              <small>
                <span>{low}</span>
                <span>{high}</span>
              </small>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
