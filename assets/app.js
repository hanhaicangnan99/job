/*!
 * app.js — 外壳：路由（#/shift?d=&team=v）、日期条、班组选择器、月份切换、SW、安装引导
 *
 * 链接格式（可以直接发给自己或同事）：
 *   #/shift?d=2026-10-01&team=B      看 2026-10-01 二值班
 *   #/overview?team=C&y=2026&m=10    看 2026 年 10 月总貌，高亮三值班
 */
(function (root) {
  'use strict';
  var S = root.Shift, U = root.Shift.UI;

  var KEY_TEAM = 'shift:team';        // 当前选中的班组（0..4）
  var KEY_MY = 'shift:myTeam';        // 「我的班组」（0..4，空 = 没设过）

  var App = {
    version: '1.0.0',
    view: 'shift',
    date: S.todayStr(),
    month: null,                      // {y, m} 总貌当前看的月份
    team: S.MY_TEAM,                   // 默认二值班（下标，0 = 一值班）
    myTeam: null
  };
  root.Shift.App = App;
  root.__APP__ = App;

  var VIEWS = ['shift', 'overview'];
  var TABS = [
    { id: 'shift', icon: '🔄', label: '轮转' },
    { id: 'overview', icon: '🗓', label: '总貌' }
  ];

  var elView, elAppbar, elSub, elDatebar, elTabbar, elBanner, elTeam;
  /* ---------------- 小工具 ---------------- */
  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, String(v)); } catch (e) {}
  }

  /* ---------------- 路由 ---------------- */
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var qs = '';
    var i = h.indexOf('?');
    if (i >= 0) { qs = h.slice(i + 1); h = h.slice(0, i); }
    var out = { view: VIEWS.indexOf(h) >= 0 ? h : null, d: null, team: null, y: null, m: null };
    qs.split('&').forEach(function (kv) {
      if (!kv) return;
      var p = kv.split('=');
      var k = decodeURIComponent(p[0]);
      var v = decodeURIComponent(p.slice(1).join('='));
      if (k === 'd' && S.isValidDate(v)) out.d = v;
      if (k === 'team') out.team = S.normTeam(v);
      if (k === 'y') out.y = parseInt(v, 10);
      if (k === 'm') out.m = parseInt(v, 10);
    });
    return out;
  }
  function writeHash(replace) {
    var q = [];
    if (App.view === 'overview') {
      q.push('y=' + App.month.y, 'm=' + App.month.m);
    } else {
      q.push('d=' + App.date);
    }
    q.push('team=' + 'ABCDE'.charAt(App.team));
    var hash = '#/' + App.view + '?' + q.join('&');
    try {
      if (replace) history.replaceState(null, '', hash);
      else history.pushState(null, '', hash);
    } catch (e) { location.hash = hash; }
  }
  App.shareLink = function () {
    return location.origin + location.pathname + '#/' + App.view + '?' +
      (App.view === 'overview' ? 'y=' + App.month.y + '&m=' + App.month.m : 'd=' + App.date) +
      '&team=' + 'ABCDE'.charAt(App.team);
  };

  /* ---------------- 启动 ---------------- */
  function boot() {
    elAppbar = U.$('#appbar');
    elSub = U.$('#subtitle');
    elView = U.$('#view');
    elTabbar = U.$('#tabbar');
    elBanner = U.$('#banner');
    // 日期条和班组条都已经挪进视图里（自己渲染），顶栏不再需要它们
    elDatebar = null;
    elTeam = null;

    readStorage();

    var r = parseHash();
    if (r.view) App.view = r.view;
    if (r.team != null) App.team = r.team;
    if (r.d) App.date = r.d;
    if (r.y && r.m) App.month = { y: r.y, m: r.m };
    if (!App.month) App.month = { y: +App.date.slice(0, 4), m: +App.date.slice(5, 7) };

    renderTabs();
    bindGlobals();
    render();

    window.addEventListener('popstate', function () {
      var x = parseHash();
      if (x.view) App.view = x.view;
      if (x.team != null) App.team = x.team;
      if (x.d) App.date = x.d;
      if (x.y && x.m) App.month = { y: x.y, m: x.m };
      render();
    });

    renderBanner();
    registerSW();
    wireInstall();
  }

  function readStorage() {
    var t = lsGet(KEY_TEAM);
    if (t != null && /^\d$/.test(t)) App.team = S.idxOf(+t);
    var m = lsGet(KEY_MY);
    if (m != null && /^\d$/.test(m)) App.myTeam = S.idxOf(+m);
  }

  /* ---------------- 渲染 ---------------- */
  /**
   * 「现在这一刻在岗的是哪一段」——和看哪一天、选了哪个班都无关。
   * 今天 06:00 打这个电话，现在在岗的就是夜班（哪怕那一格排的是休、
   * 因为夜班 02:55 就上了，是按前一天的排班算的）。
   */
  function currentDuty(today) {
    var ref = S.nowRef();
    var segs = S.daySegments(today, ref);
    for (var k = 0; k < segs.length; k++) {
      if (segs[k].s <= ref && ref < segs[k].e) {
        return {
          index: segs[k].index, team: segs[k].team, short: segs[k].short,
          shift: segs[k].shift, startAbs: segs[k].s, endAbs: segs[k].e,
          range: S.mmRange(segs[k].start, segs[k].end), ref: ref
        };
      }
    }
    return null;
  }

  function ctx() {
    var today = S.todayStr();
    var isToday = App.date === today;
    // 只有「看的正是今天」时才按**现在的时间**算上下交班；
    // 看别的日期就按那一天的排班算（否则会出现「9/23 的接班人是 9/22 的人」这种怪结果）
    var ref = isToday ? S.nowRef() : null;
    return {
      app: App, Shift: S, date: App.date, today: today, isToday: isToday, ref: ref,
      teamIndex: App.team, team: S.team(App.team),
      month: App.month, myTeam: App.myTeam,
      // 「现在在岗的是谁」（只在看今天时给）
      onDutyNow: isToday ? currentDuty(today) : null,
      // 交班关系（接班 / 交班）一次算好，交给视图渲染
      handover: S.handover(App.date, App.team, ref),
      roster: S.dayRoster(App.date, App.team, ref),
      go: App.go, setDate: App.setDate, setTeam: App.setTeam, setMonth: App.setMonth,
      refresh: render
    };
  }

  function render() {
    var y = window.scrollY;
    var view = root.Shift.Views[App.view] || root.Shift.Views.shift;
    var c = ctx();

    // 先拼成片段再挂进去：这样即使某次渲染返回空串，也不会把旧内容清成一片空白
    var holder = U.node('<div>' + view.render(c) + '</div>');
    elView.innerHTML = '';
    if (holder) elView.appendChild(holder);
    if (view.mount) view.mount(elView, c);

    renderAppbar();
    renderTabs();
    if (y) window.scrollTo(0, Math.min(y, document.body.scrollHeight));
  }

  function renderAppbar() {
    var title = document.getElementById('title');
    if (title) title.textContent = '倒班日历';
    if (elSub) {
      elSub.textContent = App.view === 'overview'
        ? '五班三倒 · 10 日一轮 · ' + U.monthLabel(App.month.y, App.month.m) + ' 总貌'
        : '五班三倒 · 10 日一轮';
    }
    // 日期条已经挪进视图里（上面那条大的），顶栏这条不再用
    if (elDatebar) { elDatebar.innerHTML = ''; elDatebar.hidden = true; }
  }

  function renderTabs() {
    elTabbar.innerHTML = TABS.map(function (t) {
      return '<button data-tab="' + t.id + '" class="' + (App.view === t.id ? 'on' : '') + '">' +
        '<span class="ic">' + t.icon + '</span>' + t.label + '</button>';
    }).join('');
  }

  function renderBanner() {
    var mem = false;
    try {
      localStorage.setItem('__shift_probe__', '1');
      localStorage.removeItem('__shift_probe__');
    } catch (e) { mem = true; }
    if (!mem) { elBanner.hidden = true; elBanner.innerHTML = ''; return; }
    elBanner.hidden = false;
    elBanner.innerHTML = '<span class="grow">⚠ 这个浏览器不让存东西（隐私模式？）</span>';
  }

  /* ---------------- 事件 ---------------- */
  function bindGlobals() {
    elTabbar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (b) App.go(b.dataset.tab);
    });

    // 视图里所有 data-* 动作统一在这里分发（日期条和班组条都挪进视图了，所以都在这一条里）
    elView.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-team],[data-cell],[data-d]');
      if (!t) return;
      // 前后一天优先（按钮上只有 data-d）
      if (t.dataset.d != null && t.dataset.d !== '') { App.shiftDate(+t.dataset.d); return; }
      // data-cell（总貌格子）优先：它同时带 data-team，不能被下面那条截走
      if (t.dataset.cell) { openCell(t.dataset.cell, t.dataset.team); return; }
      if (t.dataset.team != null && t.dataset.team !== '') { App.setTeam(+t.dataset.team); return; }
      var act = t.dataset.act;
      if (!act || act === 'actions') return;
      if (act === 'today') { App.setDate(S.todayStr()); if (App.month) App.setMonth(+S.todayStr().slice(0, 4), +S.todayStr().slice(5, 7)); return; }
      if (act === 'pick-date') { openDatePicker(); return; }
      if (act === 'prev-day') { App.shiftDate(-1); return; }
      if (act === 'next-day') { App.shiftDate(1); return; }
      if (act === 'prev-month') { App.setMonth(App.month.y, App.month.m - 1); return; }
      if (act === 'next-month') { App.setMonth(App.month.y, App.month.m + 1); return; }
      if (act === 'this-month') { var td = S.todayStr(); App.setMonth(+td.slice(0, 4), +td.slice(5, 7)); return; }
      if (act === 'my-team') { App.setMyTeam(App.team); return; }
      if (act === 'share') { doShare(); return; }
      if (act === 'csv') { doCsv(); return; }
      if (act === 'rules') { openRules(); return; }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') U.closeTop();
      if (App.view !== 'shift') return;
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.key === 'ArrowLeft') App.shiftDate(-1);
      if (e.key === 'ArrowRight') App.shiftDate(1);
    });

    // 左右滑动切日期（避开弹层与横向表格）
    var sx = 0, sy = 0, sw = false;
    document.addEventListener('touchstart', function (e) {
      if (U.$('.mask')) { sw = false; return; }
      if (e.target.closest('.tbl-wrap, input, textarea, select, .sheet, .teampick')) { sw = false; return; }
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; sw = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!sw) return;
      sw = false;
      if (App.view !== 'shift') return;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 52) return;
      App.shiftDate(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  App.go = function (id, replace) {
    if (VIEWS.indexOf(id) < 0) id = 'shift';
    App.view = id;
    if (id === 'overview') {
      var td = App.date || S.todayStr();
      if (!App.month) App.month = { y: +td.slice(0, 4), m: +td.slice(5, 7) };
    }
    writeHash(replace !== false);
    render();
  };
  App.setDate = function (d) {
    if (!S.isValidDate(d)) return;
    App.date = d;
    App.month = { y: +d.slice(0, 4), m: +d.slice(5, 7) };
    if (App.view === 'overview') { writeHash(true); render(); return; }
    writeHash(true);
    render();
  };
  App.shiftDate = function (n) { App.setDate(S.addDays(App.date, n)); };
  App.setTeam = function (i) {
    App.team = S.idxOf(i);
    lsSet(KEY_TEAM, App.team);
    writeHash(true);
    render();
  };
  App.setMyTeam = function (i) {
    App.myTeam = S.idxOf(i);
    lsSet(KEY_MY, App.myTeam);
    U.toast('已把「' + S.TEAMS[App.myTeam] + '」设为我的班组');
    render();
  };
  App.setMonth = function (y, m) {
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    App.month = { y: y, m: m };
    if (App.view === 'overview') writeHash(true);
    render();
  };
  App.refresh = function () { render(); };

  /* ---------------- 弹层 ---------------- */
  function openDatePicker() {
    U.sheet({
      title: '跳到哪一天',
      sub: '按「我的班组」算；改动只影响你正在看的日期',
      body: '<input type="date" id="__d" value="' + App.date + '">' +
        '<div class="btn-row mt10">' +
        '<button class="btn sm" data-q="0">今天</button>' +
        '<button class="btn sm" data-q="1">明天</button>' +
        '<button class="btn sm" data-q="7">7 天后</button>' +
        '<button class="btn sm" data-q="30">30 天后</button>' +
        '</div>',
      onMount: function (rootEl, close) {
        rootEl.addEventListener('click', function (e) {
          var b = e.target.closest('[data-q]');
          if (!b) return;
          App.setDate(S.addDays(S.todayStr(), +b.dataset.q));
          close();
        });
        var inp = U.$('#__d', rootEl);
        inp.addEventListener('change', function () {
          if (S.isValidDate(inp.value)) { App.setDate(inp.value); close(); }
        });
      },
      actions: [{ label: '关掉' }]
    });
  }

  function openCell(dateStr, teamIdx) {
    var i = S.idxOf(teamIdx);
    var t = S.team(i);
    var b = S.blocksOn(dateStr, i);
    var d = S.dayIndexOf(dateStr, i);
    var rows = [
      ['班组', t.name + (App.myTeam === i ? '（我的）' : '')],
      ['日期', dateStr + '　' + S.weekday(dateStr)],
      ['轮转', '第 ' + d + ' 天（10 天一轮）'],
      ['当天班次', U.chip(b.myShift) + '　' + U.esc(S.SHIFT_HOURS[b.myShift])],
      ['昨天留下的', b.yesterday ? U.esc(b.yesterday.label) : '—'],
      ['当天上班', b.today ? U.esc(b.today.label) + '（' + U.dur(S.workMinutesOn(dateStr, i)) + '在岗）' : '不上班'],
      ['明天', b.tomorrow ? U.esc(b.tomorrow.label) : '—']
    ];
    var nw = S.nextWork(dateStr, i);
    if (b.myShift === '休' && nw) {
      rows.push(['下次上班', nw.date + '（' + S.weekday(nw.date) + '）' + nw.shift + '班 ' + nw.hours +
        (nw.daysUntil === 0 ? '' : '，' + nw.daysUntil + ' 天后')]);
    }
    U.sheet({
      title: t.name + ' · ' + S.mdLabel(dateStr),
      sub: S.SHIFT_NAME[b.myShift] + '　' + S.SHIFT_HOURS[b.myShift],
      body: U.kvRows(rows),
      actions: [
        { label: '看这一天', cls: 'primary', onClick: function () { App.setTeam(i); App.setDate(dateStr); } },
        { label: '关掉' }
      ]
    });
  }

  function openRules() {
    U.sheet({
      title: '轮转规则',
      sub: '这个日历就是按下面这几条算出来的',
      body: U.kvRows([
        ['班次数', '5 个班组 × 3 个班次，每天 3 个班在岗'],
        ['一轮', '10 天（每 2 天换一个班）'],
        ['序列', S.CYCLE.join(' ') + '<div class="small muted">第 1 天起，10 天循环；共 6 天上班、4 天休息</div>'],
        ['锚点', '一值班的第 1 个白班 = <b>' + S.ANCHOR_TEAM1 + '</b><div class="small muted">第 t 个班比它晚 2×(t−1) 天，所以二值班是 ' + S.addDays(S.ANCHOR_TEAM1, 2) + '</div>'],
        ['白班', S.SHIFT_HOURS['白'] + '（' + U.dur(S.LEN['白']) + '）'],
        ['中班', S.SHIFT_HOURS['中'] + '（' + U.dur(S.LEN['中']) + '，跨零点）'],
        ['夜班', S.SHIFT_HOURS['夜'] + '（' + U.dur(S.LEN['夜']) + '）'],
        ['交接', '三班首尾相接，合计正好 <b>24 小时</b>：<br>' +
          S.SHIFT_HOURS['夜'] + ' → ' + S.SHIFT_HOURS['白'] + ' → ' + S.SHIFT_HOURS['中'] + ' → 次日 ' + S.SHIFT_HOURS['夜'].split('-')[0]],
        ['归格口径', '班次记在<b>开始那天</b>；中班跨零点，所以第二天的格子里会标一句「中班 02:55 下班」；夜班整段都在当天（02:55-10:25）']
      ]) + U.note('本日历按固定轮转规则计算，<b>顶班 / 换班 / 请假不会反映</b>。' +
        '夜里 10:25 那个点上是「夜班下班」和「白班上班」撞在一起，属于正常交接。', 'info'),
      actions: [{ label: '知道了' }]
    });
  }

  function doShare() {
    var link = App.shareLink();
    U.copy(link).then(function (ok) {
      U.toast(ok ? '链接已复制：' + link : '复制失败，长按这里选中：' + link, ok ? 2600 : 6000);
    });
  }

  function doCsv() {
    var y = App.month.y, m = App.month.m;
    var days = S.daysInMonth(y, m);
    var head = ['日期', '星期'];
    for (var i = 0; i < 5; i++) head.push(S.TEAMS[i]);
    var rows = [head];
    for (var d = 1; d <= days; d++) {
      var ds = y + '-' + S.pad2(m) + '-' + S.pad2(d);
      var row = [ds, S.weekday(ds)];
      for (var t = 0; t < 5; t++) {
        var sh = S.shiftOf(ds, t);
        row.push(sh + (S.LEN[sh] ? ' ' + S.SHIFT_HOURS[sh] : ''));
      }
      rows.push(row);
    }
    var csv = '\ufeff' + rows.map(function (r) {
      return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
    }).join('\r\n');
    U.download('倒班日历-' + y + '-' + S.pad2(m) + '.csv', csv, 'text/csv');
    U.toast('已导出本月排班 CSV');
  }

  /* ---------------- Service Worker / 安装 ---------------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol === 'file:') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').then(function () {}, function (err) {
        console.warn('SW 注册失败（不影响使用）：', err && err.message);
      });
    });
  }
  function wireInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      root.__deferredInstall = e;
      var ib = U.$('.btn-install', elAppbar);
      if (ib) ib.hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      root.__deferredInstall = null;
      var ib = U.$('.btn-install', elAppbar);
      if (ib) ib.hidden = true;
      U.toast('已安装到桌面');
    });
    var ib = U.$('.btn-install', elAppbar);
    if (ib) ib.addEventListener('click', function () {
      if (root.__deferredInstall) root.__deferredInstall.prompt();
    });
  }

  /* ---------------- go ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}(typeof globalThis !== 'undefined' ? globalThis : this));
