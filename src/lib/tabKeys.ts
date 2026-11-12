import type { KeyboardEvent } from 'react';

export function handleTabKeys(event: KeyboardEvent<HTMLElement>) {
  const vertical = event.currentTarget.getAttribute('aria-orientation') === 'vertical';
  const previous = vertical ? 'ArrowUp' : 'ArrowLeft';
  const following = vertical ? 'ArrowDown' : 'ArrowRight';
  if (![previous, following, 'Home', 'End'].includes(event.key)) return;
  const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button[role="tab"]');
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button[role="tab"]:not(:disabled)')];
  const index = target ? tabs.indexOf(target) : -1;
  if (index < 0 || !tabs.length) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === following ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
  tabs[next].click();
}
