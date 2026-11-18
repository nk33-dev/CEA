export const PREVIEW_HEALTH_SCRIPT = String.raw`
  var previewFault = false;
  var gpuContexts = new WeakSet(), gpuCount = 0;
  function reportPreviewFault(reason) {
    if(previewFault)return;
    previewFault = reason;
    setActive(false);
    parent.postMessage({type:'cea:error',reason:reason},'*');
  }
  addEventListener('error',function(event){
    if(event.message)reportPreviewFault('runtime');
  });
  addEventListener('unhandledrejection',function(){reportPreviewFault('runtime');});
  if(typeof HTMLCanvasElement!=='undefined'){
    var nativeContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type){
      var context = nativeContext.apply(this,arguments);
      if(context&&/^(webgl2?|experimental-webgl|webgpu)$/.test(type)&&!gpuContexts.has(context)){
        gpuContexts.add(context);gpuCount++;
        parent.postMessage({type:'cea:resources',gpu:gpuCount},'*');
      }
      return context;
    };
  }
  document.addEventListener('webglcontextlost',function(){reportPreviewFault('gpu');},true);
  document.addEventListener('webglcontextrestored',function(){
    if(previewFault!=='gpu')return;
    previewFault=false;
    if(previewReady){
      setActive(requestedActive&&!document.hidden,requestedInteractive);
      parent.postMessage({type:'cea:ready',bounds:contentBounds(),layout:currentLayout()},'*');
    }
  },true);
`;
