import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

/** Only the generated document changes; collected HTML and resource bytes stay intact. */
export function preparePreviewMarkup(markup: string) {
  const fragment = parseFragment(markup, { sourceCodeLocationInfo: true });
  const insertions: number[] = [];
  const base = new URL('https://cea.invalid/play/asset/html/');
  const visit = (node: DefaultTreeAdapterTypes.Node) => {
    if ('tagName' in node && node.tagName === 'img' && !node.attrs.some(attr => attr.name === 'crossorigin')) {
      const src = node.attrs.find(attr => attr.name === 'src')?.value;
      if (src && URL.canParse(src, base) && node.sourceCodeLocation?.startTag) {
        const url = new URL(src, base);
        if (url.origin === base.origin && url.pathname.startsWith(base.pathname)) {
          insertions.push(node.sourceCodeLocation.startTag.startOffset + 4);
        }
      }
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
    if ('tagName' in node && node.tagName === 'template') visit((node as DefaultTreeAdapterTypes.Template).content);
  };
  visit(fragment);
  for (const offset of insertions.sort((a, b) => b - a)) {
    markup = markup.slice(0, offset) + ' crossorigin="anonymous"' + markup.slice(offset);
  }
  return markup;
}

export const PREVIEW_IMAGES_SCRIPT = String.raw`
  if(typeof HTMLImageElement!=='undefined'){
    var imageBase=new URL('.',location.href);
    function prepareImage(image,value){
      if(!value||image.hasAttribute('crossorigin'))return;
      try {
        var url=new URL(String(value),document.baseURI);
        if(url.origin===imageBase.origin&&url.pathname.startsWith(imageBase.pathname))image.crossOrigin='anonymous';
      } catch {}
    }
    var imageSource=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
    if(imageSource&&imageSource.set)Object.defineProperty(HTMLImageElement.prototype,'src',{
      get:imageSource.get,configurable:imageSource.configurable,enumerable:imageSource.enumerable,
      set:function(value){prepareImage(this,value);imageSource.set.call(this,value);}
    });
    var imageAttribute=HTMLImageElement.prototype.setAttribute;
    HTMLImageElement.prototype.setAttribute=function(name,value){
      if(String(name).toLowerCase()==='src')prepareImage(this,value);
      return imageAttribute.call(this,name,value);
    };
    // innerHTML and parser-created images do not go through the src setter.
    if(typeof MutationObserver!=='undefined')new MutationObserver(function(records){
      records.forEach(function(record){record.addedNodes.forEach(function(node){
        if(node.nodeType!==1)return;
        if(node.tagName==='IMG')prepareImage(node,node.getAttribute('src'));
        node.querySelectorAll('img[src]').forEach(function(image){prepareImage(image,image.getAttribute('src'));});
      });});
    }).observe(document.documentElement,{childList:true,subtree:true});
  }
`;
