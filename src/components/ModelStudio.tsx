import { useEffect, useRef, useState } from 'react';
import { Box, LoaderCircle, Play, Pause, RefreshCw } from 'lucide-react';
import { bridge } from '../bridge';
import { Modal } from './Modal';
import type { Character, ModelJob, Skin } from '../types';
const statusName: Record<ModelJob['status'], string> = {
  submitting: '正在创建模型任务',
  generating: '正在生成网格和贴图',
  'rig-submitting': '正在创建骨骼绑定任务',
  rigging: '正在绑定骨骼',
  downloading: '正在下载模型',
  ready: '模型已就绪',
  failed: '制作失败',
  uncertain: '创建结果需到服务商核对',
};
export function ModelStudio({
  character,
  skins,
  onSaveSkin,
  onClose,
}: {
  character: Character;
  skins: Skin[];
  onSaveSkin: (skin: Skin, activate: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const [jobs, setJobs] = useState<ModelJob[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(false);
  const [recoveryId, setRecoveryId] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void bridge
      .listModelJobs(character.id)
      .then(setJobs)
      .catch((e) => setError(e.message));
    return () => {
      mounted.current = false;
    };
  }, [character.id]);
  const current = jobs[0];
  const upsert = (job: ModelJob) => setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]);
  async function query(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const job = await bridge.advanceModelJob(id);
      if (!mounted.current) return;
      upsert(job);
      if (['ready', 'failed', 'uncertain'].includes(job.status)) setPolling(false);
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : '任务查询失败。');
        setPolling(false);
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!polling || busy || !current || !['generating', 'rigging', 'downloading'].includes(current.status))
      return;
    const timer = setTimeout(() => void query(current.id), 8000);
    return () => clearTimeout(timer);
  }, [polling, busy, current?.id, current?.status, current?.updatedAt]);
  return (
    <Modal
      title={`为${character.name}制作 3D 模型`}
      subtitle="主参考原图 → 图生模型 → 骨骼绑定 → 本机预览"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="generation-studio">
        <div className="model-source">
          <div>
            {character.visualReferences?.[0] && (
              <img src={character.visualReferences[0].image} alt="3D 主参考" />
            )}
          </div>
          <section>
            <h3>使用已保存的主参考原图</h3>
            <p>
              优先选择完整身体、四肢清楚的同一服装立绘。此流程调用 Meshy 图生 3D
              与骨骼绑定接口，各创建一个制作任务。
            </p>
            <p>
              带场景、坐骑或多个主体的展示图容易一起生成进模型。请先在角色档案中换成单一人物、四肢无遮挡的全身参考；收图成功不代表图片适合绑定。
            </p>
            <p>
              不会覆盖立绘或已有模型。生成的 GLB
              仅使用模型实际提供的骨骼和动作，未提供的面部表情不会被模拟成已完成。
            </p>
          </section>
        </div>
        <button
          className="button primary"
          disabled={
            busy ||
            !character.visualReferences?.length ||
            Boolean(current && !['ready', 'failed'].includes(current.status))
          }
          onClick={() => {
            setBusy(true);
            setError('');
            void bridge
              .startModelJob(character.id)
              .then((job) => {
                upsert(job);
                setPolling(['generating', 'rigging'].includes(job.status));
              })
              .catch((e) => setError(e.message))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <LoaderCircle size={17} className="spin" /> : <Box size={17} />}开始建模并绑定
        </button>
        {!character.visualReferences?.length && (
          <div className="notice">请先自动收集图片，选择并保存主参考，再开始建模。</div>
        )}
        {error && <div className="inline-error">{error}</div>}
        {jobs.map((job) => (
          <section className="model-job" key={job.id}>
            <div className="section-heading">
              <div>
                <h3>{statusName[job.status]}</h3>
                <p>
                  {new Date(job.createdAt).toLocaleString('zh-CN')} · {job.progress}%
                </p>
              </div>
              {['generating', 'rigging', 'downloading'].includes(job.status) && (
                <div className="reference-toolbar">
                  <button className="button secondary" disabled={busy} onClick={() => void query(job.id)}>
                    <RefreshCw size={15} />
                    查询进度
                  </button>
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => {
                      upsert(job);
                      setPolling(!polling);
                    }}
                  >
                    {polling && current?.id === job.id ? <Pause size={15} /> : <Play size={15} />}{' '}
                    {polling && current?.id === job.id ? '暂停查询' : '自动查询'}
                  </button>
                </div>
              )}
            </div>
            <progress max={100} value={job.progress} />
            {job.taskId && (
              <p className="fine-print">
                模型任务：{job.taskId}
                {job.rigTaskId ? ` · 绑定任务：${job.rigTaskId}` : ''}
              </p>
            )}
            {job.error && <div className="inline-error">{job.error}</div>}
            {job.sourceReferenceId !== character.visualReferences?.[0]?.id && (
              <div className="notice">
                此任务使用创建时的主参考，与你现在的主参考不同；请预览核对后再使用。
              </div>
            )}
            {['uncertain', 'submitting', 'rig-submitting'].includes(job.status) && (
              <div className="form-row">
                <label>
                  服务商已有任务编号
                  <input
                    aria-label="恢复 3D 任务编号"
                    value={recoveryId}
                    maxLength={128}
                    onChange={(e) => setRecoveryId(e.target.value)}
                    placeholder={job.taskId ? '已有的绑定任务编号' : '已有的图生 3D 任务编号'}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={busy || !recoveryId.trim()}
                  onClick={() => {
                    setBusy(true);
                    setError('');
                    void bridge
                      .recoverModelJob({ jobId: job.id, taskId: recoveryId.trim() })
                      .then((result) => {
                        upsert(result);
                        setPolling(true);
                        setRecoveryId('');
                      })
                      .catch((e) => setError(e.message))
                      .finally(() => setBusy(false));
                  }}
                >
                  关联并继续查询
                </button>
              </div>
            )}
            {job.skin && (
              <button
                className="button primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void onSaveSkin(job.skin!, true)
                    .then(() => onClose())
                    .catch((e) => setError(`模型已下载，重试只保存到本机，不会重新制作。${e.message}`))
                    .finally(() => setBusy(false));
                }}
              >
                {skins.some((s) => s.id === job.skin?.id) ? '使用此模型' : '保存模型并预览'}
              </button>
            )}
          </section>
        ))}
        <p className="fine-print">
          任务编号保存在本机，关闭窗口会停止查询，服务商任务可能继续。重新打开后可查询原任务，不需要再次提交；生成质量和绑定成功率仍需实际检查。
        </p>
      </div>
    </Modal>
  );
}
