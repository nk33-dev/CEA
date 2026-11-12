export function loadDetailPage() {
  return import('../pages/DetailPage.tsx');
}

export function preloadDetailPage() {
  void loadDetailPage().catch(() => {});
}
