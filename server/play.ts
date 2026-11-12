import type { CodeFile } from '../shared/types.ts';
import { PLAYBACK_SCRIPT } from './playback.ts';
import { PREVIEW_OVERLAY_SCRIPT } from './previewOverlays.ts';
import { PREVIEW_NAVIGATION_SCRIPT } from './previewNavigation.ts';
import type { ThemeContract } from '../shared/theme.ts';

/**
 * 统一的播放页：/play/<id>/<framework>/ 是已保存素材的地址，/play/~draft 是编辑页的草稿地址。
 * 页面在 sandbox iframe 里打开，舞台背景和主题变量由外层通过 postMessage 设置。
 */

export interface StageOptions {
  /** 舞台背景：light | dark | 任意 CSS 颜色 */
  background?: string;
  theme?: ThemeContract;
}

const STAGE_TOKENS = {
  light: {
    '--stage-bg': '#f7f7f8', '--stage-fg': '#0d0d0d', '--stage-muted': '#6b6b70', '--stage-border': 'rgba(0,0,0,0.08)',
    '--stage-surface': '#ffffff', '--stage-accent': '#0d0d0d', '--stage-on-accent': '#ffffff',
  },
  dark: {
    '--stage-bg': '#141415', '--stage-fg': '#f4f4f5', '--stage-muted': '#a1a1a6', '--stage-border': 'rgba(255,255,255,0.1)',
    '--stage-surface': '#1f1f21', '--stage-accent': '#f4f4f5', '--stage-on-accent': '#0d0d0d',
  },
};

function tokenCss(theme: keyof typeof STAGE_TOKENS) {
  return Object.entries(STAGE_TOKENS[theme]).map(([k, v]) => `${k}:${v}`).join(';');
}

/** 舞台：居中摆放组件，背景随主题变，预留 --stage-* 变量给素材使用 */
const STAGE_HEAD = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style id="cea-stage">
:root{${tokenCss('light')};color-scheme:light}
html[data-theme="dark"]{${tokenCss('dark')}}
html[data-theme="light"] body{color-scheme:light}
html[data-theme="dark"] body{color-scheme:dark}
html[data-background="light"]{--cea-background:${STAGE_TOKENS.light['--stage-bg']};color-scheme:light}
html[data-background="dark"]{--cea-background:${STAGE_TOKENS.dark['--stage-bg']};color-scheme:dark}
html,body{margin:0;min-height:100%}
/* 缩放 iframe 内的顶层弹层单独合成，避免文字在重绘时交替出现重影；关闭后不保留图层。 */
:where([popover]:popover-open){will-change:transform}
html{scrollbar-width:thin}
/* 组件已完整处于视口内时，舞台 padding 不应单独生成文档滚动条。 */
:root[data-framing="content"][data-content-fits]{overflow:clip}
:root[data-thumbnail],:root[data-thumbnail] body{scrollbar-width:none!important;scrollbar-gutter:auto!important}
:root[data-thumbnail]::-webkit-scrollbar,:root[data-thumbnail] body::-webkit-scrollbar{display:none!important}
/* 缩放 iframe 的系统菜单会错位；此规则必须压过素材的 appearance:none!important。 */
@supports (appearance:base-select){
  :root select:not([multiple]):is(:not([size]),[size="0"],[size="1"]),
  :root select:not([multiple]):is(:not([size]),[size="0"],[size="1"])::picker(select){appearance:base-select!important}
  :root select:not([multiple]):is(:not([size]),[size="0"],[size="1"])::picker(select){background:var(--stage-surface);color:var(--stage-fg);border:1px solid var(--stage-border);border-radius:6px;box-shadow:0 6px 20px rgb(0 0 0 / .12);padding:4px;max-height:min(240px,80vh);overflow:auto}
  :root select:not([multiple]):is(:not([size]),[size="0"],[size="1"]) option{padding:6px 10px;border-radius:3px;font:inherit}
  :root select:not([multiple]):is(:not([size]),[size="0"],[size="1"]) option:hover{background:color-mix(in srgb,var(--stage-fg) 8%,transparent)}
  :root select[data-cea-arrow]::picker-icon{display:none}
}
html[data-device="phone"]{scrollbar-width:none}
html[data-device="phone"]::-webkit-scrollbar{display:none}
@media(max-width:600px){
  html{scrollbar-width:none}
  html::-webkit-scrollbar{display:none}
}
html[data-device="phone"] body{overscroll-behavior:contain}
#root{width:100%;min-width:0;display:grid;grid-template-columns:minmax(0,1fr);place-items:center}
html[data-paused] *,html[data-paused] *::before,html[data-paused] *::after{animation-play-state:paused!important}
body{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr);place-items:center;padding:24px;box-sizing:border-box;background:var(--cea-background,var(--stage-bg));color:var(--stage-fg);
font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei UI",sans-serif;-webkit-font-smoothing:antialiased}
:where(html[data-framing="device"]) body{padding:0;display:block}
:where(html[data-framing="device"]) #root{display:block}
::view-transition-old(root),::view-transition-new(root){animation-duration:240ms;animation-timing-function:ease}
</style>
<script>
(function(){
  var params = new URLSearchParams(location.search);
  if(params.get('thumbnail')==='1')document.documentElement.dataset.thumbnail='';
  var themeContract = /*__CEA_THEME__*/;
  function prepareSelect(event){
    var select=event.target.closest&&event.target.closest('select');
    if(!select||select.multiple||select.size>1)return;
    var style=getComputedStyle(select);
    select.toggleAttribute('data-cea-arrow',style.backgroundImage!=='none');
    if(window.CSS&&CSS.supports('appearance','base-select')&&style.appearance!=='base-select')select.style.setProperty('appearance','base-select','important');
  }
  document.addEventListener('pointerover',prepareSelect,true);
  document.addEventListener('pointerdown',prepareSelect,true);
  document.addEventListener('focusin',prepareSelect,true);
  ${PLAYBACK_SCRIPT}
  ${PREVIEW_OVERLAY_SCRIPT}
  ${PREVIEW_NAVIGATION_SCRIPT}
  var keyboardFocus=false;
  document.addEventListener('pointerdown',function(){keyboardFocus=false;},true);
  document.addEventListener('keydown',function(event){
    if(['Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))keyboardFocus=true;
  },true);
  document.addEventListener('focusin',function(event){
    if(!keyboardFocus)return;
    var target=event.target;
    if(!target.getBoundingClientRect)return;
    nativeFrame(function(){
      if(document.activeElement!==target||!keyboardFocus)return;
      var rect=target.getBoundingClientRect();
      parent.postMessage({type:'cea:focus',value:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}},'*');
    });
  });
  var requestedActive = params.get('active')!=='0';
  var requestedInteractive = params.get('interactive')==='1';
  var previewReady = false;
  var warming = false;
  var boundsObserver=null,boundsObserved=new Set();
  document.addEventListener('DOMContentLoaded', function() {
    var fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    fonts.then(function() {
      nativeFrame(function() { nativeFrame(function() {
        previewReady = true;
        // 以暂停状态加载的预览（列表缩略图）如果立刻暂停，入场动画会停在第一帧，内容是空的；先播一会儿再停。
        // 播放期间收到的指令记下来，播完再生效
        if (!requestedActive) {
          warming = true;
          setActive(!document.hidden, requestedInteractive);
          setTimeout(function() { warming = false; setActive(requestedActive&&!document.hidden, requestedInteractive); reportBounds(); }, 1600);
        } else setActive(requestedActive&&!document.hidden, requestedInteractive);
        reportBounds();
        parent.postMessage({ type: 'cea:ready', bounds: contentBounds() }, '*');
        if (window.ResizeObserver) {
          boundsObserver=new ResizeObserver(function() { nativeFrame(reportBounds); });
          observeBounds([]);
          reportBounds();
        }
      }); });
    });
  }, { once: true });
  // 列表缩略图按内容实际占的区域缩放，舞台留白不算在内。
  // 没有背景和边框的包裹层继续往里找，组件外面套一层全宽 div 也能找到卡片本身。
  function plain(el){
    var cs=getComputedStyle(el);
    return cs.backgroundImage==='none'&&(cs.backgroundColor==='transparent'||cs.backgroundColor==='rgba(0, 0, 0, 0)')&&cs.boxShadow==='none'&&!parseFloat(cs.borderTopWidth)&&!parseFloat(cs.borderBottomWidth);
  }
  function visibleChildren(host){
    var list=[];
    for(var i=0;i<host.children.length;i++){
      var el=host.children[i];
      if(/^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(el.tagName))continue;
      if(el.matches('[popover],dialog'))continue;
      var r=layoutRect(el);
      if(r.right-r.left>=1&&r.bottom-r.top>=1)list.push(el);
    }
    return list;
  }
  function layoutRect(el){
    if(typeof el.offsetWidth!=='number')return el.getBoundingClientRect();
    var left=0,top=0,node=el;
    // 入场动画的 transform 不能参与列表缩放，否则组件和外层会各缩放一次。
    while(node){
      left+=node.offsetLeft;top+=node.offsetTop;
      node=node.offsetParent;
      if(node){left+=node.clientLeft;top+=node.clientTop;}
    }
    return {left:left,top:top,right:left+el.offsetWidth,bottom:top+el.offsetHeight};
  }
  function contentBounds(){
    var root=document.getElementById('root');
    var items=visibleChildren(root||document.body);
    for(var depth=0;depth<4&&items.length===1&&plain(items[0]);depth++){
      var inner=visibleChildren(items[0]);
      if(!inner.length)break;
      items=inner;
    }
    observeBounds(items);
    var l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
    items.forEach(function(el){
      var rect=layoutRect(el);
      l=Math.min(l,rect.left);t=Math.min(t,rect.top);r=Math.max(r,rect.right);b=Math.max(b,rect.bottom);
    });
    document.documentElement.toggleAttribute('data-content-fits',
      document.documentElement.dataset.framing!=='device'&&Number.isFinite(l)&&l>=0&&t>=0&&r<=innerWidth&&b<=innerHeight);
    l=Math.max(0,l);t=Math.max(0,t);r=Math.min(innerWidth,r);b=Math.min(innerHeight,b);
    return r>l&&b>t?{x:l,y:t,width:r-l,height:b-t}:null;
  }
  function observeBounds(items){
    if(!boundsObserver)return;
    var next=new Set([document.body].concat(items));
    boundsObserved.forEach(function(el){if(!next.has(el))boundsObserver.unobserve(el);});
    next.forEach(function(el){if(!boundsObserved.has(el))boundsObserver.observe(el);});
    boundsObserved=next;
  }
  var lastBounds='';
  function reportBounds(){
    var next=JSON.stringify(contentBounds());
    if(next===lastBounds)return;
    lastBounds=next;
    parent.postMessage({ type: 'cea:bounds', value: JSON.parse(next) }, '*');
  }
  document.documentElement.dataset.background=params.get('theme')==='dark'?'dark':'light';
  document.documentElement.dataset.device=params.get('device')==='phone'?'phone':'desktop';
  document.documentElement.dataset.framing=params.get('framing')==='device'?'device':'content';
  function chosenTheme(value){
    if(themeContract.source==='detected'||themeContract.source==='original')return '';
    if(themeContract.mode==='original')return '';
    return themeContract.mode==='light'||themeContract.mode==='dark'?themeContract.mode:
      value==='dark'?'dark':value==='light'?'light':themeContract.default;
  }
  function componentTheme(value){
    var chosen=chosenTheme(value);
    if(chosen)document.documentElement.dataset.theme=chosen;
    else delete document.documentElement.dataset.theme;
    document.documentElement.classList.toggle('dark',chosen==='dark');
  }
  componentTheme(params.get('componentTheme'));
  document.addEventListener('visibilitychange', function(){
    if(previewReady)setActive(!document.hidden&&(warming||requestedActive), requestedInteractive);
  });
  // 外层在预览就绪时会把当前主题再发一遍，值没变就什么都不做：
  // 空转一次 view transition 会截一张整页快照再淡入，卡片在这一瞬间会闪白。
  // 背景和组件配色的两条消息几乎同时到，合并成一次整体淡入淡出，不会背景慢慢变、组件一下跳过去
  var pendingTheme=[],themeFrame=0;
  function switchTheme(change){
    if(!previewReady||!document.startViewTransition||document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches){change();return;}
    pendingTheme.push(change);
    if(themeFrame)return;
    themeFrame=requestAnimationFrame(function(){
      themeFrame=0;
      var changes=pendingTheme.splice(0);
      document.startViewTransition(function(){changes.forEach(function(fn){fn();});});
    });
  }
  addEventListener('message', function (e) {
    if(e.source!==parent)return;
    var d = e.data || {};
    if(d.type==='cea:probe'){
      parent.postMessage({ type: 'cea:boot' }, '*');
      if(previewReady){ lastBounds=''; reportBounds(); parent.postMessage({ type: 'cea:ready', bounds: contentBounds() }, '*'); }
    }
    if(d.type==='cea:active'){
      requestedActive=Boolean(d.value);
      requestedInteractive=Boolean(d.interactive);
      if(previewReady&&!warming)setActive(requestedActive&&!document.hidden, requestedInteractive);
    }
    if(d.type==='cea:component-theme'&&chosenTheme(d.value)!==(document.documentElement.dataset.theme||''))switchTheme(function(){componentTheme(d.value);});
    if(d.type==='cea:device')document.documentElement.dataset.device=d.value==='phone'?'phone':'desktop';
    if(d.type==='cea:framing'){
      document.documentElement.dataset.framing=d.value==='device'?'device':'content';
      nativeFrame(reportBounds);
    }
    if (d.type === 'cea:theme') {
      var background=d.value==='dark'?'dark':'light';
      if(background!==document.documentElement.dataset.background)switchTheme(function(){document.documentElement.dataset.background=background;});
    }
  });
})();
</script>`;

function escapeScript(code: string) {
  return code.replace(/<\/script/gi, '<\\/script');
}

function stageHead(options?: StageOptions) {
  return STAGE_HEAD.replace('/*__CEA_THEME__*/', JSON.stringify(options?.theme ?? { mode: 'legacy', default: 'light' }));
}

export function htmlPlayPage(title: string, code: CodeFile[], options?: StageOptions): string {
  const get = (p: string) => code.find(f => f.path === p)?.content ?? '';
  const style = get('style.css');
  const script = get('script.js');
  return `<!doctype html>
<html lang="en">
<head>
${stageHead(options)}
<title>${escapeHtml(title)}</title>
<style>
${style}
</style>
</head>
<body>
${get('markup.html')}
${script.trim() ? `<script>\n${escapeScript(script)}\n</script>` : ''}
</body>
</html>
`;
}

/** React、Vue 等打包后的实现：挂载到 #root */
export function bundlePlayPage(title: string, bundle: string, error: string | null, options?: StageOptions): string {
  const body = error
    ? `<pre style="max-width:640px;white-space:pre-wrap;font:12px/1.6 ui-monospace,Consolas,monospace;color:#b42318;background:#fff4f2;border:1px solid #ffd2cc;border-radius:12px;padding:16px">${escapeHtml(error)}</pre>`
    : `<div id="root"></div>\n<script>\n${escapeScript(bundle)}\n</script>`;
  return `<!doctype html>
<html lang="en">
<head>
${stageHead(options)}
<title>${escapeHtml(title)}</title>
</head>
<body>
${body}
</body>
</html>
`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
