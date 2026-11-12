import type { LocaleInfo } from './types.ts';

export const zh: LocaleInfo = {
  id: 'zh', label: '中文', name: '中文', direction: 'ltr', fallback: 'en',
  intro: h => `把「${h.title}」组件加到我的项目里。`,
  adapt: '沿用项目现有规范，保留组件的交互和动效。',
  demoOnly: '源码中 data-demo-only 标记的控件仅用于素材预览演示。接入项目时仅移除这些控件及其专用样式和手动选值事件。完整保留所有业务状态、强度档位及对应的渲染逻辑、动效和业务交互，改由项目业务数据触发。',
  sections: { markup: '结构', style: '样式', script: '脚本（在结构之后运行一次）' },
  dependencies: '依赖',
  theme: {
    labels: { original: '原始配色', light: '仅浅色', dark: '仅深色', both: '浅色与深色' },
    goals: {
      light: '配色：只做浅色。',
      dark: '配色：只做深色。',
      both: '配色：浅色和深色都要，并能切换。',
    },
    keepOnly: {
      light: '参考代码自带浅色和深色两套，删掉深色那套。',
      dark: '参考代码自带浅色和深色两套，删掉浅色那套。',
    },
    rewriteColors: (from, to) => {
      const names = { original: '一套固定配色', light: '浅色', dark: '深色', both: '浅色和深色两套' };
      return `参考代码是${names[from]}，${to === 'both' ? '补上另一套' : '按目标重新配色'}，结构和动效不变。`;
    },
    singleRule: '颜色写成组件根节点上的 CSS 变量，不跟随系统深浅色。',
    dualRule: '两套颜色都写成组件根节点上的 CSS 变量，用 data-theme 或 class 切换；不要只把背景调暗。',
    ideaPriority: '下面描述里的颜色和这里冲突时，以这里为准。',
  },
  notes: {
    heading: '使用说明', empty: '暂无附注', motion: '动效参数', original: '查看原文', licenseLink: '许可证',
    titles: { press: '按压反馈', touch: '触屏与鼠标', credits: '来源', fonts: '字体', requires: '依赖', browser: '浏览器支持', global: '全局影响', note: '附注', license: '图标与许可' },
    // 早期素材未在注释中提供译文，保留已有参数名的兼容翻译。
    legacyMotion: {
      'Tabs sliding': '日期滑块', 'Weather icon swap': '天气图标切换', 'Temperature pop-in': '温度数字弹入',
      'Sky backdrop': '天空背景', 'Condition swap': '天气描述切换', 'Day morph': '日期文字过渡',
      'Icon idle': '图标待机动效', 'Tab press': '日期按压反馈',
      Duration: '时长', Easing: '缓动', Scale: '缩放', Blur: '模糊', Distance: '距离', Stagger: '逐项延迟',
      'Direction X': '水平向量', 'Direction Y': '垂直向量', 'Cross-fade duration': '交叉淡入时长',
      'Cross-fade easing': '交叉淡入缓动', 'Drift duration': '漂移周期', 'Drift distance': '漂移距离',
      'Rain fall duration': '雨滴周期', 'Lightning cycle': '闪电周期', 'Resize duration': '尺寸过渡时长',
      'Sun spin': '太阳旋转周期', 'Float duration': '浮动周期', 'Float distance': '浮动距离', 'Drop duration': '水滴周期',
    },
    legacyPress: '触屏点按时，按压状态至少保持 --press-dur，让反馈完整显示。',
    legacyTouch: '点按时完整播放按压反馈，禁用控件文字选择；悬停反馈只用于鼠标。',
  },
};
