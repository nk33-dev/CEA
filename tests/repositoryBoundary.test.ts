import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Library } from '../server/library.ts';
import os from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));

describe('程序与素材库隔离', () => {
  it('服务端不包含素材实现目录，运行代码不依赖测试数据', () => {
    const files = fs.readdirSync(path.join(root, 'server'), { recursive: true }).map(String);
    expect(files.filter(file => /(^|[/\\])seed[/\\].+\.[^.]+$/.test(file))).toEqual([]);
    for (const file of files.filter(file => file.endsWith('.ts'))) {
      const source = fs.readFileSync(path.join(root, 'server', file), 'utf8');
      expect(source).not.toMatch(/(?:from\s*|import\s*\()['"][^'"]*(?:\/seed\/|\/tests\/)/);
    }
  });

  it('数据库、备份和本机配置受忽略规则保护，源码仍可提交', () => {
    const protectedFiles = [
      '.env', '.env.local', 'library.db', 'library.db-wal', 'library.db-shm',
      'backup.sqlite', 'backup.sqlite3-wal', 'backup.zip', 'private.key',
      'library.json', 'cea-settings.json', 'assets/example/code.html', 'server/seed/example.ts',
    ];
    const ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: root, input: protectedFiles.join('\n') + '\n', encoding: 'utf8',
    }).trim().split(/\r?\n/);
    expect(ignored).toEqual(protectedFiles);
    const visible = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], {
      cwd: root, input: 'server/app.ts\ntests/helpers/library.ts\n.env.example\n', encoding: 'utf8',
    });
    expect(visible.status).toBe(1);
    expect(visible.stdout).toBe('');
    expect(visible.stderr).toBe('');
  });

  it('新库保持空库，不自动写入收藏或示例', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cea-boundary-'));
    const lib = Library.open(dir);
    try {
      expect(lib.listAssets()).toEqual([]);
      expect(lib.listCategories()).toEqual([]);
      expect(fs.readdirSync(path.join(dir, 'assets'))).toEqual([]);
    } finally {
      lib.close();
      if (path.dirname(dir) !== os.tmpdir() || !path.basename(dir).startsWith('cea-boundary-')) throw new Error('Unexpected test path');
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
