import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import { CARD_VIEWPORT } from '../../shared/preview.ts';
import { Library } from '../library.ts';
import { resolveCliLibrary } from '../libraryRegistry.ts';
import { playbackDocument } from '../playDocument.ts';
import { libraryFilePath } from './catalog.ts';
import { configDir } from '../config.ts';

const cacheDirectory = () => path.join(configDir(), 'cache', 'previews');

export async function openComponentPreview(id: string, selector?: string, framework?: string, size?: { width?: number; height?: number }) {
  const target = resolveCliLibrary(selector);
  const lib = Library.openExisting(target.path);
  try {
    const record = lib.repo.getAsset(id);
    if (!record || record.deletedAt) throw new Error(`组件不存在或已移入回收站：${id}`);
    const chosen = framework ?? lib.repo.getVariants(id)[0]?.framework;
    if (!chosen) throw new Error('组件没有可预览的实现');
    for (const file of lib.repo.listFiles(id).filter(file => file.framework === chosen && file.role !== 'media')) libraryFilePath(lib, file.path);
    const { asset, variant } = lib.getPlayback(id, chosen);
    const viewport = { ...(asset.previewViewport ?? CARD_VIEWPORT), ...size };
    const document = await playbackDocument(`${id}:${chosen}:${asset.updatedAt}`, asset.title, variant, path.join(lib.root, '.runtime'));
    const token = randomUUID();
    const prefix = `/${token}`;
    const app = express();
    app.disable('x-powered-by');
    let host = '';
    app.use((req, res, next) => {
      if (!['GET', 'HEAD'].includes(req.method) || req.get('host') !== host) { res.sendStatus(403); return; }
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
    });
    app.get(`${prefix}/`, (_req, res) => res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;background:#f7f7f8}body{min-height:100vh;display:grid;place-content:center}iframe{display:block;border:0;width:${viewport.width}px;height:${viewport.height}px}</style></head>
<body><iframe title="Component preview" sandbox="allow-scripts allow-forms allow-modals allow-pointer-lock" src="${prefix}/play/?active=0&interactive=1&framing=content"></iframe>
<script>
const frame=document.querySelector('iframe');
const lifetime=new EventSource('${prefix}/alive');
lifetime.onerror=()=>{lifetime.close();frame.remove();document.body.textContent='预览已结束';};
function active(value){frame.contentWindow.postMessage({type:'cea:active',value,interactive:true},'*');}
frame.addEventListener('pointerenter',()=>active(true));frame.addEventListener('pointerleave',()=>active(false));
addEventListener('message',event=>{
  if(event.source!==frame.contentWindow)return;
  if(event.data?.type==='cea:ready')document.documentElement.dataset.state='ready';
  if(event.data?.type==='cea:error'){document.documentElement.dataset.state='error';document.documentElement.dataset.error=String(event.data.reason);}
});
</script></body></html>`));
    app.get(`${prefix}/alive`, (_req, res) => {
      res.type('text/event-stream');
      res.write('data: alive\n\n');
    });
    app.get(`${prefix}/play/`, (_req, res) => {
      res.setHeader('Content-Security-Policy', 'sandbox allow-scripts allow-forms allow-modals allow-pointer-lock');
      res.type('html').send(document);
    });
    app.get(`${prefix}/play/*resource`, (req, res) => {
      try {
        const resource = req.params.resource;
        const file = lib.getPlaybackFile(id, chosen, Array.isArray(resource) ? resource.join('/') : resource);
        const absolute = libraryFilePath(lib, file.path);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.type(file.mime).sendFile(absolute);
      } catch { res.sendStatus(404); }
    });
    app.use((_req, res) => res.sendStatus(404));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('无法启动本地预览');
    host = `127.0.0.1:${address.port}`;
    let closed = false;
    return {
      url: `http://${host}${prefix}/`, library: target, id, framework: chosen, revision: asset.updatedAt, viewport,
      async close() {
        if (closed) return;
        closed = true;
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        lib.close();
      },
    };
  } catch (error) { lib.close(); throw error; }
}

function acquirePreviewSlot() {
  fs.mkdirSync(cacheDirectory(), { recursive: true });
  const lock = path.join(cacheDirectory(), 'active.lock');
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = fs.openSync(lock, 'wx');
      fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token }));
      fs.closeSync(file);
      return () => {
        try { if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock); } catch {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const owner = JSON.parse(fs.readFileSync(lock, 'utf8'));
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('AI 预览锁无效，请检查 CEA 配置目录中的 cache/previews/active.lock');
      try { process.kill(owner.pid, 0); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') { fs.unlinkSync(lock); continue; }
      }
      throw new Error('已有 AI 预览正在运行，请先结束该预览再重试。');
    }
  }
  throw new Error('无法取得 AI 预览名额，请重试。');
}

interface PreviewOptions {
  library?: string;
  framework?: string;
  width?: number;
  height?: number;
  duration: number;
  ttl: number;
  out?: string;
  video?: boolean;
  serve?: boolean;
}

function trimPreviewCache(keep: string) {
  const root = path.resolve(cacheDirectory());
  const entries = fs.readdirSync(root).filter(name => /^cea-preview-[a-f0-9]{16}$/.test(name)).flatMap(name => {
    const directory = path.resolve(root, name);
    const stat = fs.lstatSync(directory);
    return path.dirname(directory) === root && stat.isDirectory() && !stat.isSymbolicLink() && directory !== keep
      ? [{ directory, at: stat.mtimeMs }] : [];
  }).sort((a, b) => b.at - a.at);
  for (const { directory } of entries.slice(11)) {
    for (const file of fs.readdirSync(directory)) {
      if (['screenshot.png', 'filmstrip.png', 'motion.webm'].includes(file) || /^[a-f0-9]{32}\.webm$/.test(file)) fs.rmSync(path.join(directory, file), { force: true });
    }
    try { fs.rmdirSync(directory); } catch {}
  }
}

export async function previewComponent(id: string, options: PreviewOptions, announce: (value: object) => void) {
  const release = acquirePreviewSlot();
  let session: Awaited<ReturnType<typeof openComponentPreview>> | undefined;
  try {
    const size = { ...(options.width ? { width: options.width } : {}), ...(options.height ? { height: options.height } : {}) };
    session = await openComponentPreview(id, options.library, options.framework, size);
    const metadata = { library: session.library, id, framework: session.framework, revision: session.revision, viewport: session.viewport };
    if (options.serve) {
      announce({ ...metadata, mode: 'interactive', url: session.url, expiresAt: new Date(Date.now() + options.ttl * 1000).toISOString() });
      await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); process.off('SIGINT', done); process.off('SIGTERM', done); resolve(); };
        const timer = setTimeout(done, options.ttl * 1000);
        process.once('SIGINT', done);
        process.once('SIGTERM', done);
      });
      return;
    }
    const key = createHash('sha256').update(JSON.stringify([session.library.id, id, session.framework])).digest('hex').slice(0, 16);
    const directory = path.join(path.resolve(options.out ?? cacheDirectory()), `cea-preview-${key}`);
    fs.mkdirSync(directory, { recursive: true });
    if (!options.out) trimPreviewCache(directory);
    const result = await capturePreview(session.url, session.viewport, directory, options.duration, !!options.video);
    const now = new Date();
    fs.utimesSync(directory, now, now);
    announce({ ...metadata, ok: result.errors.length === 0, mode: 'capture', ...result });
    if (result.errors.length) process.exitCode = 1;
  } finally {
    try { await session?.close(); }
    finally { release(); }
  }
}

async function capturePreview(url: string, viewport: { width: number; height: number }, directory: string, duration: number, video: boolean) {
  const { chromium } = await import('playwright').catch(() => { throw new Error('截图需要 Playwright。安装可选依赖后运行 npx playwright install chromium；也可用 preview --serve 直接阅览。'); });
  const browser = await chromium.launch({ headless: true, timeout: 15000 }).catch(() => { throw new Error('无法启动截图浏览器。请运行 npx playwright install chromium；或用 preview --serve。'); });
  const stop = () => { void browser.close(); };
  const deadline = setTimeout(stop, 20000);
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  let recording: import('playwright').Video | null = null;
  try {
    const context = await browser.newContext({
      viewport, deviceScaleFactor: 1, acceptDownloads: false,
      ...(video ? { recordVideo: { dir: directory, size: viewport } } : {}),
    });
    const page = await context.newPage();
    recording = page.video();
    page.setDefaultTimeout(12000);
    const errors: string[] = [];
    page.on('pageerror', error => { if (errors.length < 10) errors.push(error.message.slice(0, 300)); });
    const frames: { image: Buffer; time: number }[] = [];
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.locator('html[data-state]').waitFor({ state: 'attached' });
    const runtimeError = await page.locator('html').getAttribute('data-error');
    if (runtimeError) errors.push(`Preview runtime: ${runtimeError}`);
    await page.locator('iframe').evaluate(frame => (frame as HTMLIFrameElement).contentWindow?.postMessage({ type: 'cea:active', value: true, interactive: true }, '*'));
    const start = Date.now();
    for (let index = 0; index < 4; index++) {
      const wait = start + duration * index / 3 - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
      frames.push({ image: await page.screenshot({ timeout: 5000 }), time: Date.now() - start });
    }
    await page.locator('iframe').evaluate(frame => (frame as HTMLIFrameElement).contentWindow?.postMessage({ type: 'cea:active', value: false }, '*'));
    const screenshot = path.join(directory, 'screenshot.png');
    fs.writeFileSync(screenshot, frames.at(-1)!.image);
    await context.close();
    let recordingPath: string | null = null;
    if (recording) {
      recordingPath = path.join(directory, 'motion.webm');
      await recording.saveAs(recordingPath);
      await recording.delete();
      recording = null;
    }
    const sheet = await browser.newPage({ viewport: { width: 720, height: 900 }, deviceScaleFactor: 1 });
    await sheet.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#f7f7f8;display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px;font:12px sans-serif}figure{margin:0;min-width:0}img{width:100%;display:block}figcaption{padding:6px 0;color:#333}</style>${frames.map(frame => `<figure><img src="data:image/png;base64,${frame.image.toString('base64')}"><figcaption>${frame.time} ms</figcaption></figure>`).join('')}`);
    await sheet.locator('img').evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
    const filmstrip = path.join(directory, 'filmstrip.png');
    await sheet.screenshot({ path: filmstrip, fullPage: true, timeout: 5000 });
    return { screenshot, filmstrip, video: recordingPath, errors, durationMs: frames.at(-1)!.time, samples: frames.length, deviceScaleFactor: 1 };
  } finally {
    clearTimeout(deadline);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await browser.close();
    await recording?.delete().catch(() => {});
  }
}
