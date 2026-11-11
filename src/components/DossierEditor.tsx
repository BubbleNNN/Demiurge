import type { Character, CharacterDossier, DossierEntry } from '../types';
const labels = {
  personal: '个人信息',
  relationships: '人物关系',
  events: '经历事件',
  traits: '性格与具体表现',
  voice: '鲜明说话特点',
};
export function DossierEditor({
  character,
  onChange,
}: {
  character: Character;
  onChange?: (value: Character) => void;
}) {
  const dossier = character.dossier || { personal: [], relationships: [], events: [], traits: [], voice: [] };
  const update = (key: keyof CharacterDossier, items: DossierEntry[]) =>
    onChange?.({ ...character, dossier: { ...dossier, [key]: items } });
  return (
    <section className="character-dossier">
      <h3>人物资料册</h3>
      <p className="fine-print">
        关系、经历与说话特点分开保存。附来源表示可追溯，不等于自动核实；缺少资料时保持未知。
      </p>
      {Object.entries(labels).map(([k, label]) => {
        const key = k as keyof CharacterDossier;
        return (
          <details key={key} open={!!onChange || undefined}>
            <summary>
              {label} · {dossier[key].length} 条
            </summary>
            {!dossier[key].length && <p className="fine-print">尚无详细资料，可通过来源整理或手动补充。</p>}
            {dossier[key].map((entry, i) => (
              <article key={i} className="dossier-entry">
                {onChange ? (
                  <>
                    <input
                      aria-label={`${label}第${i + 1}条标题`}
                      maxLength={120}
                      placeholder="标题 / 人物名 / 事件名"
                      value={entry.title}
                      onChange={(e) =>
                        update(
                          key,
                          dossier[key].map((x, n) =>
                            n === i ? { ...x, title: e.target.value, status: 'user' } : x,
                          ),
                        )
                      }
                    />
                    <textarea
                      aria-label={`${label}第${i + 1}条内容`}
                      rows={3}
                      maxLength={2000}
                      value={entry.detail}
                      placeholder="具体事实、发生阶段、相处方式或表达特征"
                      onChange={(e) =>
                        update(
                          key,
                          dossier[key].map((x, n) =>
                            n === i ? { ...x, detail: e.target.value, status: 'user' } : x,
                          ),
                        )
                      }
                    />
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={entry.spoiler}
                        onChange={(e) =>
                          update(
                            key,
                            dossier[key].map((x, n) => (n === i ? { ...x, spoiler: e.target.checked } : x)),
                          )
                        }
                      />
                      包含剧情转折（不剧透时不送入对话）
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() =>
                        update(
                          key,
                          dossier[key].filter((_, n) => n !== i),
                        )
                      }
                    >
                      删除此条
                    </button>
                  </>
                ) : (
                  <>
                    <strong>{entry.title}</strong>
                    <p>{entry.detail}</p>
                  </>
                )}
                <small>
                  {entry.status === 'user'
                    ? '用户编写'
                    : entry.status === 'sourced'
                      ? '附有来源 · 待核对'
                      : '待核实'}
                  {entry.spoiler ? ' · 剧情资料' : ''}
                </small>
                {entry.sourceUrls.map((url) => (
                  <small key={url} className="dossier-source">
                    {url}
                  </small>
                ))}
              </article>
            ))}
            {onChange && (
              <button
                type="button"
                className="text-button"
                disabled={dossier[key].length >= 32}
                onClick={() =>
                  update(key, [
                    ...dossier[key],
                    { title: '', detail: '', sourceUrls: [], status: 'user', spoiler: false },
                  ])
                }
              >
                ＋ 补充{label}
              </button>
            )}
          </details>
        );
      })}
    </section>
  );
}
