# 使用与命令行

## 选择素材库

首次使用时选择空目录创建新库，或选择已有素材库。之后可以在设置中切换，CEA 会记住选定的位置。也可以在启动时指定自己的目录：

```bash
npm start -- --library "E:\CEA-Assets"
```

路径的读取顺序是：命令行 `--library`、环境变量 `CEA_LIBRARY`、本机保存的路径。都没有配置时，进入位置选择流程，不创建默认素材库。上面的路径仅为示例。

素材库的目录结构如下：

```text
CEA-Assets/
  library.json
  library.db
  assets/
    <组件 ID>/
      code/<框架>/
      media/
```

SQLite 保存组件信息、分类标签和文件索引；代码与媒体放在文件夹中，数据库只记录相对路径。需要直接复制整个素材库时，先停止使用它的 CEA 服务和命令行进程，再复制全部文件。运行中迁移请使用完整备份，不要只复制 `library.db`。

本机的素材库路径和最近记录保存在用户配置目录。Windows 默认是 `%APPDATA%\craft-every-aspect\config.json`，macOS 是 `~/Library/Application Support/craft-every-aspect/config.json`，Linux 是 `$XDG_CONFIG_HOME/craft-every-aspect/config.json` 或 `~/.config/craft-every-aspect/config.json`。

## 备份和组件文件夹

完整备份用于恢复整个库，保留组件 ID、文案、主题声明、收藏及时间信息。组件文件夹更适合挑选、修改和分享单个组件。

组件文件夹包含 `asset.json`、`idea.<语言码>.md`、框架代码目录及 `media/`。完整格式可以在程序的「导入格式」页面查看，也可以运行：

```bash
npm run cea -- guide
```

这份说明由 `shared/folderGuide.ts` 生成，界面、命令行和导出文件夹共用。它也会列出当前库已有的分类、标签和依赖，方便给 AI 参考。

只有 `index.html` 的文件夹也可以导入，CEA 会拆出结构、样式和脚本。React、Vue 的入口没有指定时，会尝试按常见文件名或唯一默认导出识别；存在歧义时需要补全入口。

导入不会自动翻译文案或补全组件的另一套主题。来源、图标和依赖的版权许可应随组件保留。

## 常用命令

在程序目录运行：

```bash
npm run cea -- help
npm run cea -- list
npm run cea -- vocab
npm run cea -- check "./my-components"
npm run cea -- import "./my-components"
npm run cea -- export "./exports" my-component
npm run cea -- audit
```

- `list` 列出组件、分类和标签。
- `vocab` 列出已有分类、标签及依赖；可加 `--json`。
- `check` 检查文件夹或 ZIP，不写入组件。不编译代码，也不保证预览效果正确。
- `import` 导入文件夹或 ZIP。同 ID 默认跳过，加 `--overwrite` 覆盖，或加 `--copy` 另存副本。
- `export` 导出为组件文件夹。省略组件 ID 时导出全部，可以传入多个 ID。
- `audit` 只读检查主题声明和兼容识别结果；可加 `--json`。识别到配色规则不等于经过视觉验证。

所有命令都可以加 `--library "<素材库目录>"`。不在程序目录时，使用脚本的完整路径：

```bash
node "D:\Projects\CEA\server\cli.ts" import "D:\Components\my-card" --library "E:\CEA-Assets"
```

上面是 Windows 路径示例，使用时替换成自己的位置。程序运行时也能使用命令行导入，完成后刷新页面；不要直接修改数据库。

文件夹导入会将已填写的分类、标签显示名与库内词条匹配，新词可以照常创建。`check` 和 `import` 会提示新词、相近词及缺少的译名，完整备份则按原样恢复词条。

## 内容语言和配置

组件的标题、简介和提示词可以分别填写多语言内容，分类标签也可以维护译名。缺少翻译时按回退规则显示已有内容，不会改写组件源码中的文字。当前内容语言包为中文和英文，其他合法语言的已有文案也会保留。

内容语言不等于网站界面语言。网站主题和界面语言的独立偏好已预留，切换入口尚未开放。

配置导出文件是 `cea-settings.json`，包含设备尺寸和预设、默认框架、内容语言及预留的网站偏好。不包含组件、草稿、素材库路径和最近打开的目录。配置 v2 兼容 v1；导入旧配置不会将旧预览配色当作网站主题。

详情和编辑中的缩放、舞台背景与组件主题是临时状态，离开页面后丢弃。编辑页保存的列表预览比例和画布尺寸则属于组件信息，会随组件备份迁移。

## 预览的边界

暂停会处理 CSS 动画、Web Animations、`requestAnimationFrame` 及音视频，不会冻结组件自己的业务计时器、网络请求或数据。暂停后操作组件会先恢复播放。

电脑和手机预览按指定 CSS 视口排版，不向页面额外注入设备留白。字体、浏览器内核、触控及悬停能力仍来自当前浏览器。

React、Vue 预览在本地打包。依赖包需要安装在程序中；组件引用的远程脚本、字体、图片或接口仍可能需要网络。
