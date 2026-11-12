import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 程序配置放在系统的用户配置目录，不放在程序目录里：
 * 程序目录可以整体替换或移动，素材库路径不会丢。
 */
export function configDir(): string {
  if (process.env.CEA_CONFIG_DIR) return path.resolve(process.env.CEA_CONFIG_DIR);
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'craft-every-aspect');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'craft-every-aspect');
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'craft-every-aspect');
}

interface AppConfig {
  libraryPath?: string;
  /** 最近打开过的素材库，最新的在前 */
  recentLibraries?: string[];
}

function configFile() {
  return path.join(configDir(), 'config.json');
}

export function readConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8')) as AppConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: AppConfig) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

const samePath = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** 记下当前素材库，同时放到最近列表最前面 */
export function rememberLibrary(root: string) {
  const config = readConfig();
  const recent = [root, ...(config.recentLibraries ?? []).filter(p => !samePath(p, root))].slice(0, 8);
  writeConfig({ ...config, libraryPath: root, recentLibraries: recent });
}

export function forgetLibrary(root: string) {
  const config = readConfig();
  writeConfig({ ...config, recentLibraries: (config.recentLibraries ?? []).filter(p => !samePath(p, root)) });
}

/** 未选择素材库时返回 null，由首次配置流程选择位置。 */
export function resolveLibraryPath(argv: string[]): { path: string; fromConfig: boolean } | null {
  const i = argv.indexOf('--library');
  if (i >= 0) {
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--library 后需要填写素材库路径');
    return { path: path.resolve(argv[i + 1]), fromConfig: false };
  }
  if (process.env.CEA_LIBRARY) return { path: path.resolve(process.env.CEA_LIBRARY), fromConfig: false };
  const saved = readConfig().libraryPath;
  if (saved) return { path: saved, fromConfig: true };
  return null;
}

/** 本机命令行脚本的位置，生成导入命令时用 */
export const LOCAL_CLI = { path: fileURLToPath(new URL('./cli.ts', import.meta.url)), platform: process.platform };
