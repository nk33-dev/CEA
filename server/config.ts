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

/** Windows 上默认放在 E:\CEA-Assets（有 E 盘时），其他情况放在用户目录 */
export const DEFAULT_LIBRARY = process.platform === 'win32' && fs.existsSync('E:/')
  ? 'E:/CEA-Assets'
  : path.join(os.homedir(), 'CEA-Assets');

/** 优先级：命令行 --library > 环境变量 CEA_LIBRARY > 配置文件 > 默认目录 */
export function resolveLibraryPath(argv: string[]): { path: string; fromConfig: boolean } {
  const i = argv.indexOf('--library');
  if (i >= 0 && argv[i + 1]) return { path: path.resolve(argv[i + 1]), fromConfig: false };
  if (process.env.CEA_LIBRARY) return { path: path.resolve(process.env.CEA_LIBRARY), fromConfig: false };
  const saved = readConfig().libraryPath;
  if (saved) return { path: saved, fromConfig: true };
  return { path: DEFAULT_LIBRARY, fromConfig: false };
}

/** 本机命令行脚本的位置，生成导入命令时用 */
export const LOCAL_CLI = { path: fileURLToPath(new URL('./cli.ts', import.meta.url)), platform: process.platform };
