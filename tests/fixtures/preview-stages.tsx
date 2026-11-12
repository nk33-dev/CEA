import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PreviewStages } from '../../src/components/Stage.tsx';
import '../../src/styles/app.css';

function Fixture() {
  const [framework, setFramework] = useState('html');
  const [replay, setReplay] = useState(0);
  return <>
    <style>{'.stage-frame.is-loaded { animation: none !important; }'}</style>
    <h1>Preview Lifecycle</h1>
    <nav>{['html', 'react', 'vue'].map(value =>
      <button key={value} aria-pressed={framework === value} onClick={() => setFramework(value)}>{value}</button>,
    )}<button onClick={() => setReplay(value => value + 1)}>Replay</button></nav>
    <div style={{ width: 720, height: 500 }}>
      <PreviewStages assetId="leetcode-heatmap" framework={framework} reloadKey={replay} title="Heatmap" />
    </div>
  </>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
