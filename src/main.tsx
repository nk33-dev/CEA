import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, NavLink, Outlet, RouterProvider, ScrollRestoration, useNavigation } from 'react-router';
import { LibraryProvider, useLibrary } from './lib/store.tsx';
import { api } from './lib/api.ts';
import { loadDetailPage } from './lib/detailRoute.ts';
import { Tooltips } from './components/Tooltips.tsx';
import '@fontsource-variable/inter/wght.css';
import './styles/toast-motion.css';
import './styles/modal-motion.css';
import './styles/app.css';

function Shell() {
  const { loadError } = useLibrary();
  const navigation = useNavigation();
  const navigating = navigation.state !== 'idle';
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" end aria-label="CEA · Craft Every Aspect">
            <svg className="brand-mark" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="2" y="2" width="9" height="9" rx="2.5" />
              <rect x="13" y="2" width="9" height="9" rx="4.5" />
              <rect x="2" y="13" width="9" height="9" rx="4.5" />
              <rect className="brand-mark-accent" x="13" y="13" width="9" height="9" rx="2.5" />
            </svg>
            <span className="brand-word">CEA</span>
            <span className="brand-name">Craft<br />Every Aspect</span>
          </NavLink>
          <nav className="topnav" aria-label="主导航">
            <NavLink to="/" end>浏览</NavLink>
            <NavLink to="/organize">整理</NavLink>
            <NavLink to="/transfer">导入导出</NavLink>
            <NavLink to="/settings">设置</NavLink>
          </nav>
        </div>
      </header>
      <div className="route-progress" data-busy={navigating || undefined} role={navigating ? 'status' : undefined}
        aria-label={navigating ? '正在打开页面' : undefined} aria-hidden={!navigating || undefined}><span /></div>
      {loadError && <p className="banner" role="alert">{loadError}</p>}
      <main className="main">
        <Outlet />
      </main>
      <ScrollRestoration getKey={location => location.pathname} />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    HydrateFallback: Shell,
    children: [
      { path: '/', lazy: async () => ({ Component: (await import('./pages/HomePage.tsx')).HomePage }) },
      { path: '/new', lazy: async () => ({ Component: (await import('./pages/EditPage.tsx')).EditPage }) },
      {
        path: '/a/:id',
        loader: ({ params, request }) => api.asset(params.id!, request.signal),
        lazy: async () => {
          const page = await loadDetailPage();
          return { Component: page.DetailPage, ErrorBoundary: page.DetailError };
        },
      },
      { path: '/a/:id/edit', lazy: async () => ({ Component: (await import('./pages/EditPage.tsx')).EditPage }) },
      { path: '/transfer', lazy: async () => ({ Component: (await import('./pages/TransferPage.tsx')).TransferPage }) },
      { path: '/settings', lazy: async () => ({ Component: (await import('./pages/SettingsPage.tsx')).SettingsPage }) },
      { path: '/organize', lazy: async () => ({ Component: (await import('./pages/OrganizePage.tsx')).OrganizePage }) },
      { path: '/guide', lazy: async () => ({ Component: (await import('./pages/GuidePage.tsx')).GuidePage }) },
      { path: '*', element: <div className="page-narrow"><div className="empty"><p className="empty-title">页面不存在</p><a className="btn" href="/">回到素材库</a></div></div> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LibraryProvider>
      <RouterProvider router={router} />
      <Tooltips />
    </LibraryProvider>
  </StrictMode>,
);
