export const PLAYBACK_SCRIPT = String.raw`
  var previewPaused = false;
  var resumeOnInteraction = false;
  var previewSuspended = false;
  var frameSequence = 0;
  var frames = new Map();
  var pausedAnimations = new Set();
  var pausedMedia = new Set();
  var nativeFrame = window.requestAnimationFrame.bind(window);
  var nativeCancel = window.cancelAnimationFrame.bind(window);
  var nativeTimeout = window.setTimeout.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);
  var timerSequence = 0;
  var timers = new Map();

  function scheduleTimer(id, timer) {
    if(previewPaused || timer.nativeId !== null)return;
    timer.started=performance.now();
    timer.nativeId=nativeTimeout(function(){
      timer.nativeId=null;
      if(previewPaused)return;
      if(!timer.repeat)timers.delete(id);
      try {
        if(typeof timer.callback==='function')timer.callback.apply(window,timer.args);
        else window.eval(String(timer.callback));
      } finally {
        if(timer.repeat&&timers.has(id)){timer.remaining=timer.delay;scheduleTimer(id,timer);}
      }
    },timer.remaining);
  }
  function createTimer(callback,delay,repeat,args) {
    var id=++timerSequence;
    var wait=Number(delay)||0;
    wait=Math.max(repeat?1:0,wait>2147483647?1:wait);
    var timer={callback:callback,args:args,delay:wait,remaining:wait,repeat:repeat,nativeId:null,started:0};
    timers.set(id,timer);
    scheduleTimer(id,timer);
    return id;
  }
  window.setTimeout=function(callback,delay){return createTimer(callback,delay,false,Array.prototype.slice.call(arguments,2));};
  window.setInterval=function(callback,delay){return createTimer(callback,delay,true,Array.prototype.slice.call(arguments,2));};
  window.clearTimeout=window.clearInterval=function(id){
    var timer=timers.get(id);
    if(!timer)return;
    if(timer.nativeId!==null)nativeClearTimeout(timer.nativeId);
    timers.delete(id);
  };

  function scheduleFrame(id, frame) {
    if (previewPaused || frame.nativeId !== null) return;
    frame.nativeId = nativeFrame(function(time) {
      frame.nativeId = null;
      if (previewPaused) return;
      frames.delete(id);
      frame.callback(time);
    });
  }
  window.requestAnimationFrame = function(callback) {
    var id = ++frameSequence;
    var frame = { callback: callback, nativeId: null };
    frames.set(id, frame);
    scheduleFrame(id, frame);
    return id;
  };
  window.cancelAnimationFrame = function(id) {
    var frame = frames.get(id);
    if (frame && frame.nativeId !== null) nativeCancel(frame.nativeId);
    frames.delete(id);
  };

  function pauseAnimations() {
    if (!document.getAnimations) return;
    document.getAnimations().forEach(function(animation) {
      if (animation.playState === 'running') {
        pausedAnimations.add(animation);
        animation.pause();
      }
    });
  }
  function pauseMedia() {
    document.querySelectorAll('video,audio').forEach(function(media) {
      if (!media.paused && !media.ended) {
        pausedMedia.add(media);
        media.pause();
      }
    });
  }
  function setActive(active, interactive) {
    if (typeof interactive === 'boolean') resumeOnInteraction = interactive;
    var nextPaused = !active;
    if (nextPaused === previewPaused) {
      if (nextPaused) { pauseAnimations(); pauseMedia(); }
      return;
    }
    if (nextPaused) {
      pauseAnimations();
      pauseMedia();
      previewPaused = true;
      timers.forEach(function(timer){
        if(timer.nativeId===null)return;
        nativeClearTimeout(timer.nativeId);
        timer.nativeId=null;
        timer.remaining=Math.max(0,timer.remaining-(performance.now()-timer.started));
      });
      frames.forEach(function(frame) {
        if (frame.nativeId !== null) nativeCancel(frame.nativeId);
        frame.nativeId = null;
      });
    } else {
      previewPaused = false;
    }
    document.documentElement.toggleAttribute('data-paused', previewPaused);
    if (!previewPaused) {
      pausedAnimations.forEach(function(animation) { if (animation.playState === 'paused') animation.play(); });
      pausedAnimations.clear();
      pausedMedia.forEach(function(media) { if (media.isConnected && media.paused) { var p = media.play(); if(p && p.catch) p.catch(function(){}); } });
      pausedMedia.clear();
      frames.forEach(function(frame, id) { scheduleFrame(id, frame); });
      timers.forEach(function(timer,id){scheduleTimer(id,timer);});
    }
  }
  if (typeof Element !== 'undefined' && Element.prototype.animate) {
    var nativeAnimate = Element.prototype.animate;
    Element.prototype.animate = function() {
      var animation = nativeAnimate.apply(this, arguments);
      if (previewPaused) { pausedAnimations.add(animation); animation.pause(); }
      return animation;
    };
  }
  document.addEventListener('transitionrun', function() { if(previewPaused) pauseAnimations(); }, true);
  document.addEventListener('play', function() { if(previewPaused) pauseMedia(); }, true);
  function resumeForInteraction(event) {
    if (!previewPaused || !resumeOnInteraction || !event.isTrusted) return;
    if (!previewSuspended) setActive(true);
    window.parent.postMessage({ type: 'cea:resume' }, '*');
  }
  ['pointerdown', 'keydown', 'click'].forEach(function(type) {
    document.addEventListener(type, resumeForInteraction, true);
  });
  function resumeForHover(event){
    if(!resumeOnInteraction||!event.isTrusted||event.pointerType!=='mouse')return;
    if(event.type==='pointerover'?event.relatedTarget!==null:!previewPaused)return;
    window.parent.postMessage({type:'cea:hover',value:true},'*');
  }
  document.addEventListener('pointerover',resumeForHover,true);
  document.addEventListener('pointermove',resumeForHover,true);
  document.addEventListener('pointerout',function(event){
    if(!resumeOnInteraction||!event.isTrusted||event.pointerType!=='mouse'||event.relatedTarget!==null)return;
    window.parent.postMessage({type:'cea:hover',value:false},'*');
  },true);
`;
