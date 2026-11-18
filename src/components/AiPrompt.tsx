import { uiText, useUi } from '../lib/uiI18n.ts';
import Bot from 'lucide-react/icons/bot';
import { Link } from 'react-router';
import { aiFolderPrompt } from '../../shared/folderGuide.ts';
import { useLibrary } from '../lib/store.tsx';
import { CopyButton } from './CopyButton.tsx';
import { useState } from 'react';
import { aiCliPrompt } from '../../shared/cliPrompt.ts';
import { ChoiceControl } from './ChoiceControl.tsx';
import { Dialog } from './Dialog.tsx';

/** 两种任务共用复制和查看入口，命令使用当前程序与素材库的位置。 */
export function AiPromptCard() {
  useUi();
  const { info } = useLibrary();
  const [mode, setMode] = useState<'component' | 'cli'>('component');
  const [open, setOpen] = useState(false);
  const prompt = mode === 'cli' ? aiCliPrompt(info, uiText) : aiFolderPrompt(info);
  return (
    <>
    <div className="ai-card">
      <span className="ai-card-icon" aria-hidden="true"><Bot size={18} strokeWidth={1.7} /></span>
      <div className="ai-card-text">
        <ChoiceControl label={uiText('AI 提示词')} value={mode} onChange={setMode} tabs small options={[
          { value: 'component', label: uiText('让 AI 写组件') },
          { value: 'cli', label: uiText('让 AI 使用 CLI') },
        ]} />
        <p>{mode === 'cli' ? uiText('查找参考组件，或把项目组件收藏到指定库。') : uiText("把提示词附在需求后，生成并导入组件。")}</p>
      </div>
      <div className="ai-card-actions">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(true)}>{uiText('查看提示词')}</button>
        <CopyButton key={mode} text={() => prompt} label={uiText("复制提示词")} className="btn btn-sm" />
      </div>
    </div>
    <Dialog open={open} onClose={() => setOpen(false)} title={mode === 'cli' ? uiText('让 AI 使用 CLI') : uiText('让 AI 写组件')} wide className="ai-prompt-dialog"
      footer={<><Link to="/guide" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>{uiText('查看格式')}</Link><CopyButton key={mode} text={() => prompt} label={uiText('复制提示词')} className="btn btn-sm" /></>}>
      <pre className="ai-prompt-preview">{prompt}</pre>
    </Dialog>
    </>
  );
}
