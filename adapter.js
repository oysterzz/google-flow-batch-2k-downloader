/* DOM adapter deliberately learns the card/menu relation from a user click. */
(() => {
  'use strict';
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const largeImages = root => [...root.querySelectorAll('img')].filter(img => {
    const r = img.getBoundingClientRect();
    return r.width >= 90 && r.height >= 70 && visible(img);
  });
  const text = el => ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim().replace(/\s+/g, ' ');
  function learn(button) {
    let root = button.parentElement;
    for (let level = 0; root && level < 10; level++, root = root.parentElement) {
      const imgs = largeImages(root);
      if (imgs.length > 1) break;
      if (imgs.length !== 1 || root.querySelector('video')) continue;
      const img = imgs[0];
      let depth = 0, p = img;
      while (p !== root && p) { depth++; p = p.parentElement; }
      if (!p) continue;
      const path = [];
      for (let n = button; n !== root; n = n.parentElement)
        path.unshift(n.tagName.toLowerCase() + ':nth-child(' + ([...n.parentElement.children].indexOf(n) + 1) + ')');
      return {depth, path:path.join(' > '), tag:button.tagName, label:text(button), popup:button.getAttribute('aria-haspopup')};
    }
    throw new Error('无法在按钮附近识别唯一图片。请在网格视图中点图片右上角的 ⋮。');
  }
  function scan(template, requireButton = true) {
    if (!template) return [];
    const results = [], seen = new Set();
    for (const img of largeImages(document)) {
      let root = img;
      for (let i=0; i<template.depth; i++) root = root?.parentElement;
      if (!root || root === document.body || root.querySelector('video') || largeImages(root).length !== 1) continue;
      const button = root.querySelector(':scope > ' + template.path);
      if (requireButton && (!button || button.tagName !== template.tag || text(button) !== template.label || button.getAttribute('aria-haspopup') !== template.popup)) continue;
      const src = img.currentSrc || img.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);
      results.push({src, img, root, button, title:img.alt || '未命名图片'});
    }
    return results;
  }
  function menuItem(kind) {
    const els = [...document.querySelectorAll('[role="menuitem"], [role="option"], button')].filter(visible);
    const matches = els.filter(el => {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
      const t = text(el);
      const clean = t.replace(/\b(?:chevron_right|arrow_right|file_download)\b|›/gi, '').trim();
      return kind === 'download' ? /^(?:(?:下载|download)\s*)+$/i.test(clean)
        : /(?:^|\s)2\s*K(?:\s|$)/i.test(t) && !/(?:4\s*K|1\s*K|升级|upgrade)/i.test(t);
    });
    // Multiple matches are unsafe: never choose a random menu.
    if (matches.length > 1) throw new Error('发现多个同名菜单，请先关闭其他菜单后重试。');
    return matches[0] || null;
  }
  function activate(el) {
    if (!el?.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') throw new Error('按钮已失效或不可用。');
    const r = el.getBoundingClientRect();
    const init = {bubbles:true, cancelable:true, view:window, clientX:r.x+r.width/2, clientY:r.y+r.height/2, button:0, pointerId:1, pointerType:'mouse', isPrimary:true};
    for (const type of ['pointerover','pointerenter','pointermove']) el.dispatchEvent(new PointerEvent(type, init));
    for (const type of ['mouseover','mouseenter','mousemove']) el.dispatchEvent(new MouseEvent(type, init));
    el.dispatchEvent(new PointerEvent('pointerdown', {...init, buttons:1}));
    el.dispatchEvent(new MouseEvent('mousedown', {...init, buttons:1}));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.click();
  }
  globalThis.Flow2KAdapter = {learn, scan, menuItem, activate, text};
})();
