export const PREVIEW_NAVIGATION_SCRIPT = String.raw`
  var canvasNavigation=null;
  addEventListener('message',function(event){
    if(event.source===parent&&event.data?.type==='cea:canvas-navigation')canvasNavigation=event.data.value;
  });
  function canScrollFrom(target,dx,dy){
    for(var node=target instanceof Element?target:target.parentElement;node;node=node.parentElement){
      var style=getComputedStyle(node);
      var root=node===document.scrollingElement;
      var scrollX=root||/auto|scroll|overlay/.test(style.overflowX);
      var scrollY=root||/auto|scroll|overlay/.test(style.overflowY);
      var x=scrollX&&node.scrollWidth>node.clientWidth+1;
      var y=scrollY&&node.scrollHeight>node.clientHeight+1;
      if(x&&((dx>0&&node.scrollLeft<node.scrollWidth-node.clientWidth-1)||(dx<0&&node.scrollLeft>0)))return true;
      if(y&&((dy>0&&node.scrollTop<node.scrollHeight-node.clientHeight-1)||(dy<0&&node.scrollTop>0)))return true;
      if(dx&&scrollX&&/^(contain|none)$/.test(style.overscrollBehaviorX))return true;
      if(dy&&scrollY&&/^(contain|none)$/.test(style.overscrollBehaviorY))return true;
    }
    return false;
  }
  document.addEventListener('wheel',function(event){
    if(!canvasNavigation||event.defaultPrevented)return;
    var factor=event.deltaMode===1?16:event.deltaMode===2?innerHeight:1;
    var dx=event.shiftKey&&!event.deltaX?event.deltaY*factor:event.deltaX*factor;
    var dy=event.shiftKey&&!event.deltaX?0:event.deltaY*factor;
    var zoom=event.ctrlKey||event.metaKey;
    if(!zoom&&canScrollFrom(event.target,dx,dy))return;
    if(zoom?!canvasNavigation.zoom:!((dx&&canvasNavigation.panX)||(dy&&canvasNavigation.panY)))return;
    event.preventDefault();
    parent.postMessage({type:'cea:canvas-wheel',value:{dx:dx,dy:dy,x:event.clientX/innerWidth,y:event.clientY/innerHeight,ctrlKey:event.ctrlKey,metaKey:event.metaKey}},'*');
  },{passive:false});
`;
