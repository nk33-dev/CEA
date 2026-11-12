import { uiText, useUi } from '../lib/uiI18n.ts';
import Bot from 'lucide-react/icons/bot';
import { Link } from 'react-router';
import { aiFolderPrompt, aiFolderSteps } from '../../shared/folderGuide.ts';
import { useLibrary } from '../lib/store.tsx';
import { CopyButton } from './CopyButton.tsx';

/** 命令前面的 node "<程序路径>" 每条都一样，调暗，让 guide / import 这些真正的命令显出来 */
function Command({ text }: { text: string }) {
  useUi();
  const m = /^(node (?:"[^"]*"|'[^']*'))(.*)$/.exec(text);
  if (!m) return <code>{text}</code>;
  return <code><span className="cmd-dim">{m[1]}</span>{m[2]}</code>;
}

/** 发给 AI 的导入说明：页面上按步骤排版，复制出去是纯文本。命令随当前素材库和系统变化 */
export function AiPrompt() {
  useUi();
  const { info } = useLibrary();
  const { intro, steps } = aiFolderSteps(info);
  return (
    <div className="ai-prompt">
      <div className="ai-prompt-head">
        <p>{intro}</p>
        <CopyButton text={() => aiFolderPrompt(info)} label={uiText("复制")} className="btn btn-sm" />
      </div>
      <ol>
        {steps.map(step => (
          <li key={step.label}>
            <span>{step.label}</span>
            {step.command && <Command text={step.command} />}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** 导入页上的入口：只给复制按钮，完整内容在说明页 */
export function AiPromptCard() {
  useUi();
  const { info } = useLibrary();
  return (
    <div className="ai-card">
      <span className="ai-card-icon" aria-hidden="true"><Bot size={18} strokeWidth={1.7} /></span>
      <div className="ai-card-text">
        <strong>{uiText("让 AI 写组件")}</strong>
        <p>{uiText("把提示词附在需求后，生成并导入组件。")}</p>
      </div>
      <div className="ai-card-actions">
        <Link to="/guide" className="btn btn-quiet btn-sm">{uiText("查看格式")}</Link>
        <CopyButton text={() => aiFolderPrompt(info)} label={uiText("复制提示词")} className="btn btn-sm" />
      </div>
    </div>
  );
}
