// Shared quality settings for browser export, private review rendering and preview.
'use strict';
(function () {
  function recording(state = {}, overrides = {}) {
    const match = /^(\d+)x(\d+)$/.exec(String(state.resolution || '1920x1080'));
    const dimension = (value, fallback) => Number.isFinite(+value) && +value >= 2 && +value <= 3840 ? Math.round(+value / 2) * 2 : fallback;
    const width = dimension(overrides.width ?? match?.[1], 1920);
    const height = dimension(overrides.height ?? match?.[2], 1080);
    const requestedFps = +(overrides.fps ?? state.fps ?? 30);
    const fps = Number.isFinite(requestedFps) && requestedFps >= 1 && requestedFps <= 60 ? requestedFps : 30;
    // Preserve detail as pixel count and frame rate increase, rather than spreading
    // the old fixed 6 Mbps across an entire 4K/high-frame-rate recording.
    const bitrate = Number.isFinite(overrides.bitrate) && overrides.bitrate > 0 ? overrides.bitrate : Math.round(Math.max(8e6, Math.min(80e6, width * height * fps * 0.12)));
    return { width, height, fps, bitrate };
  }
  function preview(width, height, cssWidth, cssHeight, density = 1) {
    const dpr = Number.isFinite(density) && density > 0 ? density : 1;
    const scale = Math.min(1, cssWidth * dpr / width, cssHeight * dpr / height);
    return { W: Math.max(1, Math.round(width * scale)), H: Math.max(1, Math.round(height * scale)) };
  }
  window.LOM_VIDEO = { recording, preview, maxUploadBytes: 96000000 };
})();
