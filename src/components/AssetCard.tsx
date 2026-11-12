import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import Check from 'lucide-react/icons/check';
import Heart from 'lucide-react/icons/heart';
import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Trash2 from 'lucide-react/icons/trash-2';
import { frameworkLabel } from '../../shared/frameworks.ts';
import type { AssetSummary } from '../../shared/types.ts';
import { api, errorMessage, fileUrl } from '../lib/api.ts';
import { useLibrary } from '../lib/store.tsx';
import { FitStage, useInView } from './Stage.tsx';
import { localizedTitle, translatedValue } from '../../shared/contentLocale.ts';
import { preloadDetailPage } from '../lib/detailRoute.ts';
import { useRetainedPreview } from './PreviewActivity.tsx';

interface CardProps {
  asset: AssetSummary;
  live: boolean;
  onLiveChange: (id: string | null) => void;
  locale: string;
  tagLabels?: Record<string, string>;
  activeTags: string[];
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onTag: (tag: string) => void;
  onDelete: (id: string) => void;
}

const MAX_TAGS = 3;

/**
 * 预览区可以直接操作组件；点下面的文字区打开详情。
 * 播放、重播和收藏放在标签行右端的固定位置：不遮挡预览和文字，也不额外占一行。
 * 平时只显示已收藏的心形，悬停或键盘聚焦时其余按钮浮现。
 */
export const AssetCard = memo(function AssetCard({ asset, live, onLiveChange, locale, tagLabels, activeTags, selecting, selected, onToggleSelect, onFavorite, onTag, onDelete }: CardProps) {
  const { ref, inView } = useInView<HTMLDivElement>();
  const { notify } = useLibrary();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [paused, setPaused] = useState(false);
  const [replay, setReplay] = useState(0);
  const [saving, setSaving] = useState(false);
  const favoriteBusy = useRef(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const wantsLive = !selecting && !paused && (live || hovered || focused);
  const retained = useRetainedPreview(asset.id, inView && (!asset.cover || wantsLive));
  const mounted = retained && asset.frameworks.length > 0;
  const active = mounted && inView && wantsLive;
  const resume = useCallback(() => { setPaused(false); setFocused(true); }, []);
  const start = () => { setPaused(false); onLiveChange(asset.id); };
  const summary = translatedValue(asset.summaries, locale, text => text);
  const extraTags = asset.tags.length - MAX_TAGS;
  const title = localizedTitle(asset, locale);

  const toggleFavorite = async () => {
    if (favoriteBusy.current) return;
    favoriteBusy.current = true;
    setSaving(true);
    const next = !asset.favorite;
    onFavorite(asset.id, next);
    try {
      await api.setFavorite(asset.id, next);
    } catch (e) {
      onFavorite(asset.id, !next);
      notify(`收藏没有保存：${errorMessage(e)}`);
    } finally {
      favoriteBusy.current = false;
      setSaving(false);
    }
  };

  return (
    <article data-asset-id={asset.id} className={`card${selected ? ' is-selected' : ''}${asset.favorite ? ' is-fav' : ''}`}>
      <div className="card-stage" ref={ref}
        onPointerEnter={e => { if (e.pointerType === 'mouse') { clearTimeout(leaveTimer.current); setHovered(true); setPaused(false); } }}
        onPointerLeave={() => { leaveTimer.current = setTimeout(() => setHovered(false), 180); }}
        onFocusCapture={() => setFocused(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}>
        {asset.cover && <img className="card-cover" src={fileUrl(asset.cover)} alt="" loading="lazy" decoding="async" />}
        {mounted && <FitStage assetId={asset.id} version={asset.updatedAt} title={title} viewport={asset.previewViewport} zoom={asset.previewScale}
          active={active} onResume={resume} reloadKey={replay} />}
        {selecting ? (
          <button type="button" className="card-select" aria-pressed={selected} aria-label={`选择「${title}」`} onClick={() => onToggleSelect(asset.id)}>
            <span className="card-check">{selected && <Check size={13} strokeWidth={3} aria-hidden="true" />}</span>
          </button>
        ) : null}
      </div>
      <Link to={`/a/${asset.id}`} className="card-meta" onFocus={preloadDetailPage} onPointerEnter={preloadDetailPage}>
        <span className="card-head">
          <span className="card-title">{title}</span>
          <span className="card-fw">{asset.frameworks.map(frameworkLabel).join(' · ')}</span>
        </span>
        {summary && summary.trim().toLowerCase() !== title.trim().toLowerCase() && <span className="card-sub">{summary}</span>}
      </Link>
      <div className="card-foot">
        <div className="card-tags">
          {asset.tags.slice(0, MAX_TAGS).map(t => (
            <button key={t} type="button" className="card-tag" title={tagLabels?.[t.toLowerCase()] ?? t} aria-pressed={activeTags.includes(t.toLowerCase())} onClick={() => onTag(t)}>{tagLabels?.[t.toLowerCase()] ?? t}</button>
          ))}
          {extraTags > 0 && <span className="card-more" title={asset.tags.slice(MAX_TAGS, MAX_TAGS + 8).map(t => tagLabels?.[t.toLowerCase()] ?? t).join('、') + (extraTags > 8 ? '…' : '')}>+{extraTags}</span>}
        </div>
        {!selecting && (
          <div className={`card-actions${live ? ' is-live' : ''}`}>
            <button type="button" className="card-act" aria-label={active ? '暂停预览' : '播放预览'} title={active ? '暂停预览' : '播放预览'}
              aria-pressed={active} onClick={() => { if (active) { setPaused(true); onLiveChange(null); } else start(); }}>
              {active ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </button>
            <button type="button" className="card-act" aria-label="重播预览" title="重播预览" onClick={() => { start(); setReplay(k => k + 1); }}>
              <RotateCcw size={15} aria-hidden="true" />
            </button>
            <button type="button" className={`card-act fav${asset.favorite ? ' is-on' : ''}`} aria-pressed={asset.favorite}
              aria-label={asset.favorite ? '取消收藏' : '收藏'} title={asset.favorite ? '取消收藏' : '收藏'} onClick={toggleFavorite} disabled={saving}>
              <Heart size={15} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" className="card-act icon-btn-danger" aria-label={`删除「${title}」`} title="删除组件" onClick={() => onDelete(asset.id)}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        )}
      </div>
    </article>
  );
});
