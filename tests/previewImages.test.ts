import { describe, expect, it } from 'vitest';
import { preparePreviewMarkup } from '../server/previewImages.ts';

describe('sandbox preview image loading', () => {
  it('adds anonymous CORS only to local image tags while preserving the rest of the source', () => {
    const markup = '<!-- <img src="fake.png"> -->\n<script>const sample = \'<img src="sample.png">\';</script>\n<IMG alt="Art > detail" src="./art.png?v=1&amp;x=2">\n<template><img src="nested/picture.webp"></template>';
    expect(preparePreviewMarkup(markup)).toBe(markup
      .replace('<IMG alt=', '<IMG crossorigin="anonymous" alt=')
      .replace('<img src="nested/', '<img crossorigin="anonymous" src="nested/'));
  });

  it('preserves external, inline, invalid and explicitly configured image requests', () => {
    const markup = '<img src="https://example.org/art.png"><img src="data:image/png;base64,abc"><img src="blob:https://example.org/id"><img src="http://["><img src="/files/art.png"><img src="../other/art.png"><img crossorigin="use-credentials" src="./art.png"><img crossorigin src="./art.png">';
    expect(preparePreviewMarkup(markup)).toBe(markup);
  });
});
