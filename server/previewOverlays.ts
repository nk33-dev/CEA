// 预览可能只露出 iframe 的一部分；弹层在可见区域内滚动，关闭后还原素材样式。
export const PREVIEW_OVERLAY_SCRIPT = String.raw`
  var visibleArea=null;
  var overlayStyles=new WeakMap();
  function restoreOverlay(el){
    var styles=overlayStyles.get(el);
    if(!styles)return;
    styles.forEach(function(saved,name){
      if(saved.value)el.style.setProperty(name,saved.value,saved.priority);
      else el.style.removeProperty(name);
    });
    overlayStyles.delete(el);
  }
  function fitOverlay(el){
    if(!el.isConnected||!el.matches(':popover-open'))return;
    var scroll={x:el.scrollLeft,y:el.scrollTop};
    restoreOverlay(el);
    if(!visibleArea)return;
    var gap=8;
    var left=Math.max(0,visibleArea.x)+gap;
    var top=Math.max(0,visibleArea.y)+gap;
    var right=Math.min(innerWidth,visibleArea.x+visibleArea.width)-gap;
    var bottom=Math.min(innerHeight,visibleArea.y+visibleArea.height)-gap;
    if(right<=left||bottom<=top)return;
    var transform={value:el.style.getPropertyValue('transform'),priority:el.style.getPropertyPriority('transform')};
    el.style.setProperty('transform','none','important');
    try{
      var rect=el.getBoundingClientRect();
      if(rect.left>=left&&rect.right<=right&&rect.top>=top&&rect.bottom<=bottom)return;
      var styles=new Map();
      overlayStyles.set(el,styles);
      function set(name,value){
        var names=name==='inset'?['top','right','bottom','left']:name==='margin'?['margin-top','margin-right','margin-bottom','margin-left']:[name];
        names.forEach(function(key){
          if(!styles.has(key))styles.set(key,{value:el.style.getPropertyValue(key),priority:el.style.getPropertyPriority(key)});
        });
        el.style.setProperty(name,value,'important');
      }
      set('box-sizing','border-box');
      if(rect.width>right-left){set('min-width','0');set('max-width',(right-left)+'px');}
      if(rect.height>bottom-top){set('min-height','0');set('max-height',(bottom-top)+'px');}
      set('overflow','auto');
      set('scrollbar-width','thin');
      set('overscroll-behavior','contain');
      set('scrollbar-gutter','stable');
      rect=el.getBoundingClientRect();
      var x=Math.max(left,Math.min(rect.left,right-rect.width));
      var y=Math.max(top,Math.min(rect.top,bottom-rect.height));
      set('position','fixed');
      set('inset','auto');
      set('margin','0');
      set('left',x+'px');
      set('top',y+'px');
    }finally{
      if(transform.value)el.style.setProperty('transform',transform.value,transform.priority);
      else el.style.removeProperty('transform');
      el.scrollLeft=scroll.x;
      el.scrollTop=scroll.y;
    }
  }
  document.addEventListener('beforetoggle',function(event){
    var el=event.target;
    if(!el.matches||!el.matches('[popover]'))return;
    if(event.newState==='closed')restoreOverlay(el);
    // beforetoggle 时仍是 display:none；下一次绘制前测量已打开的 top layer。
    // toggle 可能等到首帧之后才送达，不能用它做首次定位。
    else nativeFrame(function(){fitOverlay(el);});
  },true);
  addEventListener('blur',function(){
    document.querySelectorAll('[popover]:popover-open').forEach(function(el){
      if(el.popover==='auto')el.hidePopover();
    });
  });
  addEventListener('message',function(event){
    if(event.source!==parent||event.data?.type!=='cea:visible-area')return;
    var value=event.data.value;
    if(value&&!['x','y','width','height'].every(function(key){return Number.isFinite(value[key]);}))return;
    if(value&&visibleArea&&['x','y','width','height'].every(function(key){return Math.abs(value[key]-visibleArea[key])<.1;}))return;
    visibleArea=value&&value.width>0&&value.height>0?value:null;
    document.querySelectorAll('[popover]:popover-open').forEach(fitOverlay);
  });
`;
