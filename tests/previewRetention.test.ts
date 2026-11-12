import { describe, expect, it } from 'vitest';
import { createActivity, MAX_RETAINED_PREVIEWS } from '../src/components/PreviewActivity.tsx';

describe('列表预览预算', () => {
  it('最近操作的预览保留，最早未使用的实例按预算释放', () => {
    const activity = createActivity();
    for (let index = 0; index < MAX_RETAINED_PREVIEWS; index++) activity.retain(String(index));
    activity.retain('0');
    activity.retain('next');
    expect(activity.resident()).toHaveLength(MAX_RETAINED_PREVIEWS);
    expect(activity.resident()).toContain('0');
    expect(activity.resident()).not.toContain('1');
    expect(activity.resident().at(-1)).toBe('next');
    activity.release('0');
    expect(activity.resident()).not.toContain('0');
  });

  it('不重复登记最近实例，活动结束与释放可重复调用', () => {
    const activity = createActivity();
    activity.retain('a');
    const snapshot = activity.resident();
    activity.retain('a');
    expect(activity.resident()).toBe(snapshot);
    const end = activity.begin();
    expect(activity.snapshot()).toBe(1);
    end(); end();
    expect(activity.snapshot()).toBe(0);
    activity.release('a'); activity.release('a');
    expect(activity.resident()).toEqual([]);
  });
});
