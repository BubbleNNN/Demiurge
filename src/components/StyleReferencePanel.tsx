import { ImagePlus, Trash2 } from 'lucide-react';
import type { VisualReference } from '../types';

export function StyleReferencePanel({
  reference,
  title,
  description,
  disabled = false,
  onImport,
  onRemove,
}: {
  reference: VisualReference | null;
  title: string;
  description: string;
  disabled?: boolean;
  onImport?: () => void;
  onRemove?: () => void;
}) {
  return (
    <section className="production-style-reference" aria-label={title}>
      <div className="production-style-reference-heading">
        <div>
          <h4>{title}</h4>
          <p>{description}</p>
        </div>
        {onImport && (
          <button
            type="button"
            className="button secondary"
            aria-label={reference ? '更换画风参考图' : '添加画风参考图'}
            disabled={disabled}
            onClick={onImport}
          >
            <ImagePlus size={15} />
            {reference ? '更换图片' : '添加图片'}
          </button>
        )}
      </div>
      {reference && (
        <div className="production-style-reference-image">
          <details>
            <summary aria-label={`查看${title}：${reference.name}`}>
              <img src={reference.image} alt={`${title}缩略图`} />
              <span>
                <strong>{reference.name}</strong>
                <small>点击查看完整图片</small>
              </span>
            </summary>
            <img className="production-style-reference-full" src={reference.image} alt={`${title}完整图片`} />
          </details>
          {onRemove && (
            <button
              type="button"
              className="text-button"
              aria-label="移除画风参考图"
              disabled={disabled}
              onClick={onRemove}
            >
              <Trash2 size={14} />
              移除
            </button>
          )}
        </div>
      )}
    </section>
  );
}
