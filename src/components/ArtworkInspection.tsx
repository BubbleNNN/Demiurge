import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { styleName } from '../theme';
import type { Skin, VisualReference } from '../types';
import candidateDirections from '../../shared/pet-candidate-directions.json';

export function ArtworkInspection({
  candidates,
  references,
  selectedId,
  comparisonSkin,
  onSelect,
  onClose,
}: {
  candidates: Skin[];
  references: VisualReference[];
  selectedId: string;
  comparisonSkin?: Skin;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [referenceId, setReferenceId] = useState(references[0]?.id || '');
  const [comparisonMode, setComparisonMode] = useState<'reference' | 'candidate'>(
    comparisonSkin ? 'candidate' : 'reference',
  );
  const [zoom, setZoom] = useState(1);
  const [previewHeight, setPreviewHeight] = useState<0 | 96 | 160 | 240>(0);
  const [background, setBackground] = useState('checker');
  const candidate = candidates.find((item) => item.id === selectedId);
  const reference = references.find((item) => item.id === referenceId) || references[0];
  const compareCandidate = comparisonMode === 'candidate' && !!comparisonSkin;
  useEffect(() => {
    setComparisonMode(comparisonSkin ? 'candidate' : 'reference');
  }, [selectedId, comparisonSkin?.id]);
  if (!candidate) return null;
  return (
    <section className="artwork-inspection" aria-label="角色候选放大核对">
      <div className="artwork-inspection-heading">
        <div>
          <h4>看清细节，再选喜欢的形象</h4>
          <p>对照脸部、手和服饰；切换底色检查透明边缘，也可以缩小查看轮廓是否清楚。</p>
        </div>
        <button className="icon-button" aria-label="收起放大核对" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="artwork-inspection-controls">
        <label>
          对照图片
          <select
            aria-label="对照参考图"
            value={compareCandidate ? `candidate:${comparisonSkin.id}` : reference?.id || ''}
            disabled={!references.length && !comparisonSkin}
            onChange={(event) => {
              if (event.target.value.startsWith('candidate:')) setComparisonMode('candidate');
              else {
                setComparisonMode('reference');
                setReferenceId(event.target.value);
              }
            }}
          >
            {comparisonSkin && <option value={`candidate:${comparisonSkin.id}`}>修正前的角色候选</option>}
            {references.map((item, index) => (
              <option key={item.id} value={item.id}>
                {index + 1} · {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          查看角色候选
          <select
            aria-label="查看角色候选"
            value={selectedId}
            onChange={(event) => onSelect(event.target.value)}
          >
            {candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {styleName(item.style)} · 候选{' '}
                {candidates.filter((s) => s.style === item.style).findIndex((s) => s.id === item.id) + 1}
                {item.generation?.candidateDirection
                  ? ` · ${candidateDirections[item.generation.candidateDirection].label}`
                  : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {candidate.generation?.candidateDirection && (
        <p className="form-hint" aria-label="当前候选方向">
          <strong>{candidateDirections[candidate.generation.candidateDirection].label}</strong>
          {' · '}
          {candidateDirections[candidate.generation.candidateDirection].description}
        </p>
      )}
      <div className="artwork-inspection-tools">
        <label>
          预览高度
          <select
            aria-label="候选预览高度"
            value={previewHeight || 'fit'}
            onChange={(event) =>
              setPreviewHeight(
                event.target.value === 'fit' ? 0 : (Number(event.target.value) as 96 | 160 | 240),
              )
            }
          >
            <option value="fit">适应区域 · 核对细节</option>
            <option value="96">小尺寸 · 96 px</option>
            <option value="160">小尺寸 · 160 px</option>
            <option value="240">小尺寸 · 240 px</option>
          </select>
        </label>
        {!previewHeight && (
          <label>
            放大比例 <output>{Math.round(zoom * 100)}%</output>
            <input
              type="range"
              aria-label="候选放大比例"
              min={1}
              max={3}
              step={0.25}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
        )}
        <div className="toolbar" role="group" aria-label="核对背景">
          {[
            ['checker', '透明格'],
            ['light', '浅色'],
            ['dark', '深色'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="button secondary"
              aria-pressed={background === value}
              onClick={() => setBackground(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {!!previewHeight && (
        <p className="form-hint" aria-label="小尺寸预览说明">
          按 {previewHeight} 个界面像素（CSS
          px）显示图片高度，保持原图比例；用于比较缩小后的轮廓，不代表生成分辨率或桌宠窗口的大小设置。
        </p>
      )}
      <div
        className="artwork-inspection-grid"
        data-background={background}
        data-preview={previewHeight ? 'small' : 'fit'}
      >
        {[
          {
            image: compareCandidate ? comparisonSkin.images.neutral : reference?.image,
            label: compareCandidate ? '修正前的角色候选' : '角色参考原图',
            pixelated:
              compareCandidate && (comparisonSkin.style === 'pixel' || comparisonSkin.style === '8bit'),
          },
          {
            image: candidate.images.neutral,
            label: '当前查看的角色候选',
            pixelated: candidate.style === 'pixel' || candidate.style === '8bit',
          },
        ].map(({ image, label, pixelated }) => (
          <figure key={label}>
            <figcaption>{label}</figcaption>
            <div className="artwork-inspection-viewport" tabIndex={0} aria-label={`${label}放大视图`}>
              <div
                style={
                  previewHeight
                    ? { height: `${previewHeight}px` }
                    : { width: `${zoom * 100}%`, height: `${zoom * 100}%` }
                }
              >
                {image ? (
                  <img
                    className={pixelated ? 'pixel-art' : undefined}
                    src={image}
                    alt={label}
                    draggable={false}
                  />
                ) : (
                  <p>暂无参考原图</p>
                )}
              </div>
            </div>
          </figure>
        ))}
      </div>
      <p className="form-hint">查看候选不会改变已选形象；核对后使用候选卡片上的「用这张继续」。</p>
    </section>
  );
}
