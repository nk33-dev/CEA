import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cliCommand, quotePath } from '../shared/folderGuide.ts';

const cli = fileURLToPath(new URL('../server/cli.ts', import.meta.url));
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('CLI 素材库指引', () => {
  it('guide 的后续命令保留当前素材库，路径有空格也能运行', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cea guide '));
    temps.push(root);
    const library = path.join(root, 'My Assets');
    const output = execFileSync(process.execPath, [cli, 'guide', '--library', library], { encoding: 'utf8' });
    const command = `${cliCommand({ path: cli, platform: process.platform })} --library ${quotePath(library, process.platform)}`;
    expect(output).toContain(`${command} vocab`);
    expect(output).toContain(`${command} audit`);
    expect(output).toContain(`${command} check <文件夹>`);
    expect(output).toContain(`${command} import <文件夹> --overwrite`);
    expect(output).toContain(`当前素材库已有（${library}，0 个组件）`);

    const vocab = execFileSync(process.execPath, [cli, '--library', library, 'vocab', '--json'], { encoding: 'utf8' });
    expect(JSON.parse(vocab)).toMatchObject({ categories: [], tags: [], dependencies: [] });
  });
});
