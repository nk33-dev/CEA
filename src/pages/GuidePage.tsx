import { uiText, useUi } from '../lib/uiI18n.ts';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { cliCommand, folderGuide } from '../../shared/folderGuide.ts';
import { AiPromptCard } from '../components/AiPrompt.tsx';
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
  const sections = useMemo(() => folderGuide(cli).split(/^## /m).slice(1).map(section => {
    const end = section.indexOf('\n');
    return { title: section.slice(0, end), body: renderGuide(section.slice(end + 1)) };
  }), [cli]);
  return (
    <div className="guide-page">
      <Link to="/transfer" className="text-link guide-back"><ArrowLeft size={14} aria-hidden="true" />{uiText("返回导入导出")}</Link>
      <section className="guide-ai" aria-labelledby="guide-ai-title">
        <h1 id="guide-ai-title">{uiText('使用说明')}</h1>
        <AiPromptCard />
      </section>
      <article className="guide-doc">
        <h2 className="guide-title">{uiText('组件文件夹')}</h2>
        <p>{uiText('每个组件一个文件夹，只放需要的实现；名称、思路和封面可选。')}</p>
        <pre>{'my-component/\n  asset.json\n  idea.<locale>.md\n  html/ | react/ | vue/\n  media/'}</pre>
        <p>{uiText('也支持直接导入 index.html。检查格式后，在「导入导出」中选择文件夹即可。')}</p>
        <div className="guide-sections">
          {sections.map(section => <details key={section.title}>
            <summary>{uiText(section.title)}</summary>
            <div>{section.body}</div>
          </details>)}
        </div>
      </article>
    </div>
  );
}
