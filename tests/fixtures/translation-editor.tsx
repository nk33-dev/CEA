import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Dialog } from '../../src/components/Dialog.tsx';
import { TranslationEditor } from '../../src/components/TranslationEditor.tsx';
import '../../src/styles/modal-motion.css';
import '../../src/styles/app.css';

function Fixture() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Record<string, string>>({
    en: 'Hero', zh: '首屏', fr: 'En-tête', 'pt-BR': 'Cabeçalho', ar: 'واجهة',
    ...Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`en-${String(i).padStart(3, '0')}`, ''])),
  });
  const [value, setValue] = useState(saved);
  return <main style={{ padding: 24 }}>
    <button className="btn" onClick={() => { setValue(saved); setOpen(true); }}>编辑译名</button>
    <output aria-label="Saved translations" style={{ display: 'block', overflowWrap: 'anywhere', maxHeight: 120, overflow: 'auto' }}>{JSON.stringify(saved)}</output>
    <Dialog open={open} onClose={() => setOpen(false)} title="编辑译名" wide className="dialog-translation" footer={<>
      <button className="btn btn-quiet" data-close-dialog>取消</button>
      <button className="btn btn-dark" onClick={() => { setSaved(value); setOpen(false); }}>保存</button>
    </>}>
      {open && <TranslationEditor name="Hero" value={value} onChange={setValue} initialLocale="zh" />}
    </Dialog>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
