/*!
 * ui.js — DOM 小工具、格式化、卡片/表格片段
 * 不引任何库；所有用户可见文本都过 esc() 再进 innerHTML。
 */
(function (root, factory) {
  root.Shift = root.Shift || {};
  root.Shift.UI = factory(root.Shift);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function node(html) {
    var t = document.createElement('template');
    t.innerHTML = String(html).trim();
    return t.content.firstElementChild;
  }

  /* ---------------- 格式化 ---------------- */
  function num(v, digits) {
    if (v == null || !isFinite(v)) return '—';
    return S.h1(v);
  }
  /** 分钟 → '8 小时 20 分' */
  function dur(mins) {
    if (mins == null || !isFinite(mins)) return '—';
    var m = Math.round(mins);
    if (m < 60) return m + ' 分钟';
    var hh = Math.floor(m / 60), mm = m % 60;
    return mm ? hh + ' 小时 ' + mm + ' 分' : hh + ' 小时';
  }
  function monthLabel(y, m) { return y + ' 年 ' + m + ' 月'; }

  /* ---------------- Toast ---------------- */
  var toastTimer = null;
  function toast(msg, ms) {
    var old = $('.toast');
    if (old) old.remove();
    var n = node('<div class="toast">' + esc(msg) + '</div>');
    document.body.appendChild(n);
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { n.remove(); }, ms || 2000);
  }

  /* ---------------- 底部弹层 ---------------- */
  var openSheets = [];
  /**
   * sheet({ title, sub, body, actions:[{label, cls, onClick(root)->false|void, close}], onMount, onClose })
   */
  function sheet(opt) {
    opt = opt || {};
    var mask = node('<div class="mask"></div>');
    var actionsHtml = (opt.actions || []).map(function (a, i) {
      return '<button class="btn ' + (a.cls || '') + '" data-i="' + i + '">' + esc(a.label) + '</button>';
    }).join('');
    var sh = node(
      '<div class="sheet" role="dialog" aria-modal="true">' +
      '<div class="grip"></div>' +
      (opt.title ? '<h3>' + esc(opt.title) + '</h3>' : '') +
      (opt.sub ? '<div class="sub">' + esc(opt.sub) + '</div>' : '') +
      '<div class="sbody">' + (opt.body || '') + '</div>' +
      (actionsHtml ? '<div class="actions">' + actionsHtml + '</div>' : '') +
      '</div>');
    mask.appendChild(sh);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    $$('.actions .btn', sh).forEach(function (b) {
      b.addEventListener('click', function () {
        var a = opt.actions[+b.dataset.i];
        var keep = a.onClick ? a.onClick(sh) : undefined;
        if (keep === false || a.close === false) return;
        close();
      });
    });

    var closed = false;
    var pushed = false;
    // pushState 让安卓返回键能关弹层，而不是退出页面
    try { history.pushState({ __sheet: true }, ''); pushed = true; } catch (e) {}
    function close(fromPop) {
      if (closed) return;
      closed = true;
      mask.remove();
      var i = openSheets.indexOf(close);
      if (i >= 0) openSheets.splice(i, 1);
      if (pushed && !fromPop) { try { history.back(); } catch (e) {} }
      if (opt.onClose) opt.onClose(fromPop);
    }
    openSheets.push(close);
    document.body.appendChild(mask);
    if (opt.onMount) opt.onMount(sh, close);
    return close;
  }
  function closeTop() { var f = openSheets[openSheets.length - 1]; if (f) { f(); return true; } return false; }

  /* ---------------- 卡片 / 片段 ---------------- */
  /**
   * card(title, bodyHtml, opt)
   * opt.rawTitle = true 时 title 当 HTML 用（调用方自己保证安全，内部只用固定字符串）
   */
  function card(title, bodyHtml, opt) {
    opt = opt || {};
    var head = title
      ? (opt.rawTitle ? title : esc(title))
      : '';
    return '<div class="card' + (opt.tight ? ' tight' : '') + '">' +
      (title ? '<div class="card-h"><h2>' + head + '</h2>' + (opt.right || '') + '</div>' : '') +
      bodyHtml + '</div>';
  }
  function kvRows(rows) {
    return rows.filter(Boolean).map(function (r) {
      return '<div class="kv"><div class="k">' + esc(r[0]) + '</div><div class="v">' + r[1] + '</div></div>';
    }).join('');
  }
  function table(heads, rows, opt) {
    opt = opt || {};
    return '<div class="tbl-wrap"><table class="tbl ' + (opt.cls || '') + '"><thead><tr>' +
      heads.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="' + (r.__cls || '') + '">' +
          r.map(function (c) { return '<td>' + (c == null ? '' : c) + '</td>'; }).join('') +
          '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }
  function note(text, cls) { return '<div class="note ' + (cls || '') + '">' + text + '</div>'; }
  function emptyState(icon, text, sub) {
    return '<div class="empty"><span class="big">' + esc(icon || '—') + '</span>' +
      esc(text || '没有数据') + (sub ? '<div class="small mt6">' + esc(sub) + '</div>' : '') + '</div>';
  }
  /** 分段控件；绑事件用 bindSeg */
  function seg(name, options, value, opt) {
    return '<div class="seg' + (opt && opt.scroll ? ' scroll' : '') + '" data-seg="' + esc(name) + '">' +
      options.map(function (o) {
        return '<button type="button" data-v="' + esc(o[0]) + '"' +
          (String(o[0]) === String(value) ? ' class="on"' : '') + '>' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
  }
  function bindSeg(rootEl, name, onChange) {
    var box = rootEl.querySelector('[data-seg="' + name + '"]');
    if (!box) return;
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-v]');
      if (!b) return;
      $$('button', box).forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      onChange(b.dataset.v);
    });
  }

  /** 班次徽章：<span class="chip day">白班</span> */
  function chip(shift, extra) {
    var cls = S.SHIFT_CLASS[shift] || 'off';
    var name = S.SHIFT_NAME[shift] || shift;
    return '<span class="chip ' + cls + (extra ? ' ' + extra : '') + '">' + esc(name) + '</span>';
  }
  /** 日历格子里的单字：白/夜/中/休 */
  function cellBadge(shift) {
    var cls = S.SHIFT_CLASS[shift] || 'off';
    return '<span class="cb ' + cls + '">' + esc(S.SHIFT_BADGE[shift] || shift) + '</span>';
  }

  /* ---------------- 下载 / 剪贴板 ---------------- */
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      ta.remove(); return ok;
    } catch (e) { return false; }
  }

  return {
    esc: esc, $: $, $$: $$, node: node,
    num: num, dur: dur, monthLabel: monthLabel,
    toast: toast, sheet: sheet, closeTop: closeTop,
    card: card, kvRows: kvRows, table: table, note: note, emptyState: emptyState,
    seg: seg, bindSeg: bindSeg, chip: chip, cellBadge: cellBadge,
    download: download, copy: copy
  };
}));
