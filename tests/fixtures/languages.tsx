import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LanguageControl } from '../../src/components/LanguageControl.tsx';
import { contentLanguages } from '../../shared/locales.ts';
import { localizedName } from '../../shared/contentLocale.ts';
import '../../src/styles/app.css';

function Fixture() {
  const [value, setValue] = useState('en');
  const options = contentLanguages(['fr', 'pt-BR', 'ar', 'es-419']);
  return <main style={{ padding: 24 }}>
    <h1 style={{ fontSize: 18, marginBottom: 16 }}>Content languages</h1>
    <LanguageControl label="Test content language" value={value} onChange={setValue} options={options} />
    <p dir="auto" style={{ marginTop: 16 }}>{localizedName('Original map', { en: 'World map', fr: 'Carte du monde', 'pt-BR': 'Mapa mundial', ar: 'خريطة العالم' }, value)}</p>
    <output aria-label="Selected locale">{value}</output>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
