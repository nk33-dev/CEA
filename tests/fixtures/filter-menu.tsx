import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FilterMenu } from '../../src/components/FilterMenu.tsx';
import { ChoiceControl } from '../../src/components/ChoiceControl.tsx';
import { SelectControl } from '../../src/components/SelectControl.tsx';
import '../../src/styles/app.css';

const options = [
  { value: 'empty', label: 'Empty selected tag', count: 0 },
  { value: 'disabled', label: 'Disabled tag', count: 0 },
  { value: 'long', label: 'A very long tag name that must stay within the filter panel without overflow', count: 12 },
  ...Array.from({ length: 10000 }, (_, i) => ({
    value: `tag-${i}`,
    label: `Tag ${String(i).padStart(5, '0')}`,
    count: i + 1,
  })),
];

function Fixture() {
  const [selected, setSelected] = useState(['empty', 'tag-9999']);
  const [category, setCategory] = useState<string[]>([]);
  const [language, setLanguage] = useState('en');
  const [sort, setSort] = useState('updated');
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 18, marginBottom: 16 }}>Tag Filter · 10,003 Options</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        <ChoiceControl label="Test language" value={language} onChange={setLanguage}
          options={[{ value: 'en', label: 'EN' }, { value: 'disabled', label: 'Disabled', disabled: true }, { value: 'zh', label: '中文' }]} small />
        <ChoiceControl label="Test format" value={sort} onChange={setSort}
          options={[{ value: 'updated', label: 'Backup' }, { value: 'title', label: 'Folder' }]} tabs />
        <SelectControl label="Test sort" value={sort} onValueChange={setSort}
          options={[{ value: 'updated', label: 'Updated' }, { value: 'title', label: 'Title' }]} filter />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <FilterMenu label="标签" multiple options={options} selected={selected} onChange={setSelected}
          footer={<a className="link-btn" href="#manage">管理标签</a>} />
        <button type="button">After filter</button>
      </div>
      <output aria-label="Selected values">{JSON.stringify(selected)}</output>
      <div style={{ height: '65vh' }} />
      <FilterMenu label="分类" options={options.slice(0, 3)} selected={category} onChange={setCategory} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
