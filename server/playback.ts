export const PLAYBACK_SCRIPT = String.raw`
  var previewPaused = false;
  var resumeOnInteraction = false;
  var pausedAt = 0;
  var pausedTime = 0;
  var frameSequence = 0;
  var frames = new Map();
  var pausedAnimations = new Set();
  var pausedMedia = new Set();
  var nativeFrame = window.requestAnimationFrame.bind(window);
  var nativeCancel = window.cancelAnimationFrame.bind(window);

  function scheduleFrame(id, frame) {
    if (previewPaused || frame.nativeId !== null) return;
    frame.nativeId = nativeFrame(function(time) {
      frame.nativeId = null;
      if (previewPaused) return;
      frames.delete(id);
      frame.callback(time - pausedTime);
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
      pausedAt = performance.now();
      pauseAnimations();
      pauseMedia();
      previewPaused = true;
      frames.forEach(function(frame) {
        if (frame.nativeId !== null) nativeCancel(frame.nativeId);
        frame.nativeId = null;
      });
    } else {
      pausedTime += performance.now() - pausedAt;
      previewPaused = false;
    }
    document.documentElement.toggleAttribute('data-paused', previewPaused);
    if (!previewPaused) {
      pausedAnimations.forEach(function(animation) { if (animation.playState === 'paused') animation.play(); });
      pausedAnimations.clear();
      pausedMedia.forEach(function(media) { if (media.isConnected && media.paused) { var p = media.play(); if(p && p.catch) p.catch(function(){}); } });
      pausedMedia.clear();
      frames.forEach(function(frame, id) { scheduleFrame(id, frame); });
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
    setActive(true);
    window.parent.postMessage({ type: 'cea:resume' }, '*');
  }
  ['pointerdown', 'keydown', 'click'].forEach(function(type) {
    document.addEventListener(type, resumeForInteraction, true);
  });
`;
