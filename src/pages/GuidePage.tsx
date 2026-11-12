import { uiText, useUi } from '../lib/uiI18n.ts';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { cliCommand, folderGuide } from '../../shared/folderGuide.ts';
import { AiPrompt } from '../components/AiPrompt.tsx';
import { useLibrary } from '../lib/store.tsx';

/** 行内只处理 `代码`，说明书里没有别的行内格式 */
function inline(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>));
}

/** 说明书只用到标题、段落、列表和代码块，按这四种拆开渲染 */
function renderGuide(markdown: string) {
  const blocks: ReactNode[] = [];
  const lines = markdown.trim().split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) body.push(lines[i]);
      blocks.push(<pre key={i}>{body.join('\n')}</pre>);
    } else if (line.startsWith('# ')) {
      blocks.push(<h1 key={i}>{line.slice(2)}</h1>);
    } else if (line.startsWith('## ')) {
      blocks.push(<h2 key={i}>{line.slice(3)}</h2>);
    } else if (line.startsWith('- ')) {
      const items: string[] = [];
      for (; i < lines.length && lines[i].startsWith('- '); i++) items.push(lines[i].slice(2));
      i--;
      blocks.push(<ul key={i}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</ul>);
    } else if (line.trim()) {
      blocks.push(<p key={i}>{inline(line)}</p>);
    }
  }
  return blocks;
}

export function GuidePage() {
  useUi();
  const { info } = useLibrary();
  const cli = cliCommand(info?.cli);
  const guide = useMemo(() => renderGuide(folderGuide(cli)), [cli]);
  return (
    <div className="guide-page">
      <Link to="/transfer" className="text-link guide-back"><ArrowLeft size={14} aria-hidden="true" />{uiText("返回导入导出")}</Link>
      <section className="guide-ai" aria-labelledby="guide-ai-title">
        <h1 id="guide-ai-title">{uiText("交给 AI 时")}</h1>
        <p>{uiText("把下面这段接在需求后面，AI 会自己看格式并导入到当前素材库，不用贴后面的说明。")}</p>
        <AiPrompt />
      </section>
      <article className="guide-doc">{guide}</article>
    </div>
  );
}
