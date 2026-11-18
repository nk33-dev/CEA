import { cliCommand } from './folderGuide.ts';
import type { LibraryInfo } from './types.ts';

export function aiCliPrompt(
  info?: Pick<LibraryInfo, 'path' | 'cli'> | null,
  text: (value: string) => string = value => value,
) {
  const cli = cliCommand(info?.cli);
  return [
    text('使用 CEA CLI 完成我的需求，先阅读帮助：'),
    `\`${cli} --help\``,
    `${text('当前网页素材库（与 CLI 注册表独立）：')} ${info?.path ?? text('尚未选择')}`,
    text('按帮助查找、复用或收藏组件；按需读取，导入前检查和预演。目标库或权限不明确、需要覆盖时先询问。'),
    ...(!info?.cli ? [text('npm 命令在 CEA 程序目录运行。')] : []),
  ].join('\n');
}
