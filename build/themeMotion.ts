import { atRule, decl, type AtRule, type Plugin, type Rule } from 'postcss';

const paintProperties = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|fill|stroke|box-shadow|outline(?:-color)?|text-decoration-color)$/;

export function themeMotion(): Plugin {
  return {
    postcssPlugin: 'cea-theme-motion',
    Once(root) {
      const layer = atRule({ name: 'layer', params: 'cea-theme-motion', source: root.source });
      root.walkRules(rule => {
        let parent = rule.parent;
        const ancestors: (Rule | AtRule)[] = [];
        while (parent && parent.type !== 'root') {
          if (parent.type === 'atrule' || parent.type === 'rule') ancestors.push(parent);
          parent = parent.parent;
        }
        if (ancestors.some(parent => parent.type === 'atrule' && /keyframes$/i.test(parent.name))) return;
        const ownsColor = rule.nodes.some(node => node.type === 'decl' && paintProperties.test(node.prop) &&
          node.value.includes('var(--') && !node.value.includes('var(--preview-'));
        if (ownsColor) {
          let generated: Rule | AtRule = rule.clone({ nodes: [
            decl({ prop: 'transition', value: 'var(--ui-theme-colors, --cea-noop 0s)', source: rule.source }),
          ] });
          // 规则保留原来的媒体条件，低优先级层只为没有局部过渡的元素补默认值。
          for (const ancestor of ancestors) {
            const wrapper = ancestor.clone({ nodes: [] });
            wrapper.append(generated);
            generated = wrapper;
          }
          layer.append(generated);
        }
        if (ownsColor) for (const declaration of rule.nodes) {
          if (declaration.type !== 'decl' || declaration.prop !== 'transition') continue;
          const local = declaration.value.trim() === 'none' ? '--cea-noop 0s' : declaration.value;
          declaration.value = `${local}, var(--ui-theme-colors, --cea-noop 0s)`;
        }
      });
      if (layer.nodes?.length) root.prepend(layer);
    },
  };
}
