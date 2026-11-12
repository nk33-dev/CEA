import type { LibraryInfo } from './types.ts';

type Cli = LibraryInfo['cli'];

/** 按系统给路径加引号：Windows 用双引号，macOS / Linux 用单引号 */
export function quotePath(p: string, platform: string) {
  return platform === 'win32' ? `"${p}"` : `'${p.replace(/'/g, `'\\''`)}'`;
}

/** 在任意目录都能运行的命令行写法；不知道程序在哪时退回到程序目录里的 npm 脚本 */
export function cliCommand(cli?: Cli) {
  return cli ? `node ${quotePath(cli.path, cli.platform)}` : 'npm run cea --';
}

/**
 * 「素材文件夹」格式说明。这是唯一的一份：命令行 guide、说明页 /guide 和
 * 导出文件夹里的 README.md 都用它，改规则只改这里。cli 是命令行的写法。
 */
export function folderGuide(cli = cliCommand()) {
  return `# CEA 素材文件夹

一个组件一个文件夹，文件夹名就是组件 ID（小写字母、数字、连字符）。多个组件放进同一个父文件夹，一起导入。

## 文件夹里放什么

\`\`\`
particle-hero/
├─ asset.json     名称、分类、标签、简介（可省略）
├─ idea.zh.md     思路提示词，英文写 idea.en.md（可省略）
├─ html/          HTML 实现（按需）
│  ├─ markup.html
│  ├─ style.css
│  └─ script.js
├─ react/         React 实现（按需），入口文件默认导出组件
├─ vue/           Vue 实现（按需），单文件组件
└─ media/         截图或录屏，cover.png 作封面（可省略）
\`\`\`

只放实际交付的实现，不要求同时提供 HTML、React、Vue。导入已有素材时沿用原有格式，不为凑齐框架改写；新建素材按需求选择一种或多种。只有一个 index.html 也行，里面的 <style> 和 <script> 会自动拆开。

## 三种复用内容

- 源码：选中框架的完整代码。
- 复刻：集成要求 + 选中框架的完整代码，用于交给 AI 在已有实现上改造。
- 思路：只描述效果，不含代码，用于按描述重新实现。idea.<语言>.md 不会自动附上参考代码。

代码放进框架目录，思路放进 idea.<语言>.md；两者分开交付，不需要把代码再贴进思路。复刻提示词由程序根据框架源码生成。

## asset.json

每一项都可以省略，可以照下面这样带注释写：

\`\`\`jsonc
{
  // 显示名称；不写时用文件夹名
  "title": "Particle Hero",
  "titles": { "zh": "粒子首屏", "en": "Particle Hero" },

  // 分类；库里没有会自动新建
  "category": "Hero",
  "categoryLabels": { "zh": "首屏", "en": "Hero" },

  // 标签，用于筛选
  "tags": ["粒子", "Canvas"],
  "tagLabels": { "粒子": { "zh": "粒子", "en": "Particles" } },

  // 一句话简介，列表和详情页显示；也可以直接写一个字符串
  "summary": { "zh": "鼠标经过时粒子散开的首屏", "en": "Particles part around the cursor" },

  // 入口文件；叫 Component.tsx、App.tsx 或只有一个组件文件时不用写
  "entry": { "react": "ParticleHero.tsx" },

  // react、vue 以外用到的 npm 包，按框架写
  "dependencies": { "react": { "motion": "^12" } },

  // 浏览列表里的缩略图缩放，1 是 100%，范围 0.25 到 3；不影响详情页
  "previewScale": 1,

  // 大型组件的预览画布；省略时用自适应，宽幅组件通常用 1200 × 720
  "previewViewport": { "width": 1200, "height": 720 },

  // 各实现实际支持的主题；可省略，不会自动改写代码
  "themes": {
    "react": { "version": 1, "mode": "both", "default": "light" }
  },

  // 可选的完整分主题思路；省略时使用原始 idea 并附上目标主题要求
  "themeIdeas": {
    "zh": { "light": "做一个浅色粒子首屏，鼠标经过时粒子散开。" }
  }
}
\`\`\`

已有的分类、标签和依赖：\`${cli} vocab\`。写已有词的显示名时归到该词。

titles、categoryLabels 和 tagLabels 是可选的多语言显示名称。title、category 和 tags 保留原名用于标识与筛选；缺少译名时显示原名。summary、idea、themeIdeas 也按语言码存储，支持 zh、en、fr、pt-BR、zh-Hant、es-419 等合法语言码。思路可写入 idea.fr.md、idea.pt-BR.md；带语言码的文件以文件名为准，不按正文猜语言。未安装语言包的文案也会保留。切换内容语言不修改源码中的文字。

## 代码约定

- 需要交付多种实现时，共用一份 style.css、同样的结构和类名，交互逻辑放进共用的 JS 模块，框架文件只负责挂载和销毁；单一实现不需要额外包装。
- 每种实现只读取自己的框架目录，不会自动打包根目录的 shared/、README.md 或相邻框架的文件。开发时可以维护一份公共源码，交付前将需要的公共文件同步或构建到各框架目录，保持内容一致、相对引用完整；不要只留下指向目录外源码的引用。
- 预览时 HTML 在 body 里，React、Vue 在 #root 里。最外层元素写 width: 100%、max-width 和 min-width: 0，宽内容在组件内部横向滚动，否则手机宽度下 React、Vue 会溢出。
- 主题：themes 按框架声明实际能力。mode 可为 original（原始配色）、light、dark 或 both；default 为 light 或 dark，单主题时与 mode 一致。both 才显示组件主题切换。
- 配色变量、主题选择器和动效变量限定在组件根节点。双主题可用 .card[data-theme="dark"], html[data-theme="dark"] .card:not([data-theme="light"]) 适配预览入口，组件自身明确指定浅色时应优先。不要用预览背景或阴影变化代替组件主题。
- 旧文件夹可省略 themes：有主题选择器时兼容识别，没有时按原始配色播放，不修改源码。自动识别只供兼容，不代表主题已验证；需要固定原样时声明 original。
- 动效参数写成组件根节点的 CSS 变量，并在 CSS 开头用 /* @motion … */ 列出，详情页会显示。
- 支持 prefers-reduced-motion。
- 图标、字体有许可要求时写 /* Icons: 名称, 许可 */，使用时要注意的行为写 /* Touch: … */ 或 /* Note: … */，都会显示在详情页的「说明」里。
- 说明和 @motion 参数名保留原文，后面可加任意语言译文，例如 --speed: Animation speed | zh: 动画速度 | fr: Vitesse。语言码规则同上；缺少译文时保留原文。

## 预览与动效

- 保留组件本身的触发方式：列表切换、标签页、菜单等交互组件默认等待用户操作，不为了预览额外添加定时轮播或自动切换。只有原设计或需求包含自主播放时才自动播放。
- 素材库提供预览动效的播放、暂停和重播，这些控制不要求组件自动演示。展示型组件不自行添加播放、暂停、重播按钮；播放器、游戏等业务本身需要的控制除外。
- 连续动效使用 CSS animation、Web Animations API 或 window.requestAnimationFrame。Canvas 的时间推进采用 requestAnimationFrame 回调提供的时间戳，或由它累计的帧间隔；预览暂停后应停在当前画面，继续时从该画面接着播放。
- 不用 setInterval、递归 setTimeout、Date.now 或 performance.now 驱动连续视觉动效，也不另起 Worker、自建时钟或保存未受预览控制的原生帧函数来绕开暂停。离散操作和非视觉业务计时不受此限制。
- 组件卸载时清理动画、帧回调、计时器、事件监听和观察器。多实例互不干扰，不在 document 上查找并操作其他实例。
- 保持原组件的视觉基准。优化已有素材前先截图，修改后以相同视口、相同天气或状态对照，检查排版、色彩、图标和动效；新增状态与原有状态使用一致的表现语言。
- 一个场景的前景图标和背景应分工清楚，避免重复的视觉主体。天气粒子的轨迹、方向、速度和形态保持一致，不用随机摇摆代替雨滴下落。
- 使用与组件一致的选择控件，检查选项展开后的样式、遮挡、手机边界、键盘选择、Escape 关闭和焦点恢复；不要只检查收起状态。
- 仅用于素材预览的演示控件及其面板加 data-demo-only 属性。复刻提示词会根据当前框架的源码补充集成说明：仅移除这些控件及其专用样式和手动选值事件，完整保留全部业务状态、强度档位及对应的渲染逻辑和动效，改由项目业务数据触发；源码仍完整保留，业务控件和效果渲染层不加此标记。

## 思路提示词

把思路写成一段可以直接发给 AI 的需求：读者既能学会怎么描述，也能仅凭这段话重新实现效果。

- 先用一句话说清做什么，可借一个认得的参照物；再用一两条补充决定效果的外观或交互差异。简单效果一句话就够，不必凑条目。
- 写可观察的行为：什么触发、哪里变化、如何结束、连续操作怎样衔接。保留辨识度，不写像素和毫秒清单。
- 默认沿用目标项目的技术栈，不罗列 HTML、Vue、React 等交付版本。只有某项技术决定效果或确实需要指定时才写，例如用 Three.js 表现三维粒子；不禁止必要的技术选择。
- 共用文件、参数接口、打包方式、许可证、测试和通用兼容要求放进源码或使用说明，不堆进思路。不要描述写作过程，也不要泛泛要求“高级、流畅”。
- 思路只描述目标组件的外观和业务交互，不写预览专用的天气选择器、调参面板等演示工具，也不追加“不要演示控件”之类的排除清单。

例如：

做一个 LeetCode 个人主页风格的提交热力图卡片。

- 每个月单独成块，月份名在下方，可切换近一年和往年。
- 悬停“最长连续”时只突出最长连续提交的那一段。

idea.<语言>.md 保留原始思路。themeIdeas 的 light、dark 是可选的完整思路，保留参照、差异和交互；未填写时使用原始思路，并由复用面板明确目标主题。组件实际能力、预览背景和 AI 复用目标分别设置，选择目标不会修改源码。

思路中的目标配色是交给 AI 的要求，不表示素材已经实现该配色。只有复刻附带代码，才能要求“按参考代码改写”；思路按效果描述提出目标，不指代未提供的代码。

## 兼容检查

\`${cli} audit\` 只读列出已声明主题和兼容识别的组件，\`--json\` 输出结构化结果。旧素材可以保持原样，只调整需要改变的组件。未知主题版本会拒绝导入，升级程序后再试。

## 导入

\`\`\`
${cli} check <文件夹>
${cli} import <文件夹>
${cli} import <文件夹> --overwrite
\`\`\`

- check 只检查文件夹格式、入口和元数据，不编译代码，也不验证实际运行效果；不写入素材库。import 导入，同 ID 已存在时跳过，加 --overwrite 覆盖。
- 导入后分别预览每种实现，检查桌面和手机布局、交互、控制台错误及资源加载；格式检查通过不等于运行验证通过。
- 动效素材还要实际操作素材库的暂停、继续和重播，确认 CSS、Canvas 和图标同步暂停，继续时不跳帧或加速；验证减少动态效果、快速连续切换以及选择控件展开状态。
- 两个命令都会列出新建的分类、标签和相近的已有词。
- 有问题时命令返回非 0 并说明原因，改完再运行一次。
- 不要直接改 library.db 或素材库目录。也可以在「导入导出」页选择文件夹导入。
`;
}

export const FOLDER_GUIDE = folderGuide();

export interface AiPromptStep {
  label: string;
  command?: string;
}

/**
 * 接在需求后面发给 AI 的话。命令带上程序的完整路径和当前素材库，AI 在哪个目录都能运行；
 * 格式规则由 guide 命令给出，这里不重复。页面按步骤渲染，复制时用 aiFolderPrompt 拼成纯文本。
 */
export function aiFolderSteps(info?: Pick<LibraryInfo, 'path' | 'cli'> | null): { intro: string; steps: AiPromptStep[] } {
  const cli = cliCommand(info?.cli);
  const library = info?.cli ? ` --library ${quotePath(info.path, info.cli.platform)}` : '';
  return {
    intro: '做好后按 CEA 素材文件夹交付，并导入我的素材库：',
    steps: [
      { label: '先看格式和素材库已有的分类、标签', command: `${cli} guide${library}` },
      { label: '沿用素材已有格式，不必补齐 HTML、React、Vue；新建时按需选技术栈。交付多种实现时共用样式和逻辑，手机宽度下也要显示一致' },
      { label: '沿用原组件的视觉基准并截图对照；交互组件默认等待用户操作，连续动效验证暂停与继续，不另加播放、暂停按钮' },
      { label: '思路写成可直接发给 AI 的简短需求，技术栈按需指定；源码及公共模块放进各框架目录' },
      { label: '写完导入，报错就按提示改到成功；已存在加 --overwrite', command: `${cli} import <文件夹>${library}` },
    ],
  };
}

export function aiFolderPrompt(info?: Pick<LibraryInfo, 'path' | 'cli'> | null) {
  const { intro, steps } = aiFolderSteps(info);
  return [intro, ...steps.map((step, i) => `${i + 1}. ${step.label}${step.command ? `：\`${step.command}\`` : ''}`)].join('\n');
}

export const AI_FOLDER_PROMPT = aiFolderPrompt();
