import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

/**
 * 每个迁移只追加，不修改已发布的迁移；schema_version 记录已执行到第几个。
 * 迁移可以是 SQL，也可以是函数（需要同时移动素材文件时）。
 */
type Migration = string | ((db: DatabaseSync, root: string) => void);

const MIGRATIONS: Migration[] = [
  `
  create table meta (
    key text primary key,
    value text not null
  );
  create table categories (
    id text primary key,
    name text not null,
    sort integer not null default 0
  );
  create table assets (
    id text primary key,
    title text not null,
    description text not null default '',
    category_id text references categories(id) on delete set null,
    kind text not null check (kind in ('html', 'react')),
    entry text not null,
    idea text not null default '',
    notes text not null default '',
    source_url text not null default '',
    source_name text not null default '',
    dependencies text not null default '{}',
    favorite integer not null default 0,
    cover text,
    created_at text not null,
    updated_at text not null
  );
  create index assets_category on assets(category_id);
  create index assets_updated on assets(updated_at);
  create table tags (
    id integer primary key,
    name text not null unique collate nocase
  );
  create table asset_tags (
    asset_id text not null references assets(id) on delete cascade,
    tag_id integer not null references tags(id) on delete cascade,
    position integer not null default 0,
    primary key (asset_id, tag_id)
  );
  create index asset_tags_tag on asset_tags(tag_id);
  create table files (
    id integer primary key,
    asset_id text not null references assets(id) on delete cascade,
    role text not null check (role in ('code', 'media')),
    path text not null,
    mime text not null,
    size integer not null,
    label text not null default '',
    unique (asset_id, path)
  );
  `,
  // v2：多语言文案、多框架实现、素材类型
  (db, root) => {
    db.exec(`
      create table asset_texts (
        asset_id text not null references assets(id) on delete cascade,
        locale text not null,
        summary text not null default '',
        idea text not null default '',
        primary key (asset_id, locale)
      );
      create table variants (
        asset_id text not null references assets(id) on delete cascade,
        framework text not null,
        entry text not null,
        dependencies text not null default '{}',
        sort integer not null default 0,
        primary key (asset_id, framework)
      );
      alter table assets add column type text not null default 'component';
      alter table files add column framework text not null default '';
    `);
    const old = db.prepare('select id, description, kind, entry, idea, dependencies from assets').all() as {
      id: string; description: string; kind: string; entry: string; idea: string; dependencies: string;
    }[];
    for (const a of old) {
      // 旧数据：简介是英文，思路提示词是中文
      db.prepare('insert into asset_texts(asset_id, locale, summary, idea) values (?, ?, ?, ?)').run(a.id, 'en', a.description, '');
      if (a.idea.trim()) db.prepare('insert into asset_texts(asset_id, locale, summary, idea) values (?, ?, ?, ?)').run(a.id, 'zh', '', a.idea);
      db.prepare('insert into variants(asset_id, framework, entry, dependencies) values (?, ?, ?, ?)').run(a.id, a.kind, a.entry, a.dependencies);
      // 代码从 code/ 移到 code/<framework>/
      const codeDir = path.join(root, 'assets', a.id, 'code');
      const target = path.join(codeDir, a.kind);
      if (fs.existsSync(codeDir) && !fs.existsSync(target)) {
        const staging = path.join(root, 'assets', a.id, `.code-${a.kind}`);
        fs.renameSync(codeDir, staging);
        fs.mkdirSync(codeDir);
        fs.renameSync(staging, target);
      }
      db.prepare(`update files set framework = ?, path = replace(path, ?, ?) where asset_id = ? and role = 'code'`)
        .run(a.kind, `assets/${a.id}/code/`, `assets/${a.id}/code/${a.kind}/`, a.id);
    }
    for (const col of ['description', 'kind', 'entry', 'idea', 'notes', 'dependencies']) db.exec(`alter table assets drop column ${col}`);
  },
  `alter table variants add column supports_dark_mode integer not null default 0;`,
  `alter table assets add column preview_scale real not null default 1;`,
  `alter table assets add column preview_viewport text;`,
  `
    alter table asset_texts add column title text not null default '';
    alter table categories add column labels text not null default '{}';
    alter table tags add column labels text not null default '{}';
  `,
  `
    alter table variants add column theme text;
    alter table asset_texts add column theme_ideas text not null default '{}';
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** target 只在测试里用，用来造出旧版本的库 */
export function migrate(db: DatabaseSync, root: string, target = SCHEMA_VERSION) {
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 3000;');
  const hasMeta = db.prepare(`select 1 from sqlite_master where type = 'table' and name = 'meta'`).get();
  let version = 0;
  if (hasMeta) {
    const row = db.prepare(`select value from meta where key = 'schema_version'`).get() as { value: string } | undefined;
    version = Number(row?.value ?? 0);
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`素材库由更新版本的程序创建（结构版本 ${version}），请升级程序后再打开。`);
  }
  for (let v = version; v < target; v++) {
    const step = MIGRATIONS[v];
    db.exec('pragma foreign_keys = off; begin');
    try {
      if (typeof step === 'string') db.exec(step);
      else step(db, root);
      db.prepare(`insert into meta(key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value`)
        .run(String(v + 1));
      db.exec('commit; pragma foreign_keys = on;');
    } catch (e) {
      db.exec('rollback; pragma foreign_keys = on;');
      throw e;
    }
  }
}
