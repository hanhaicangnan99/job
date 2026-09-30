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

  var VIEWS = ['shift'];              // 只有一页（总貌画在同一页下面）

  var elView, elAppbar, elBanner;
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
  /**
   * 我们每次写地址栏时，都在 history.state 里放一个递增的 __v（版本号）。
   *
   * 为什么需要它：日历弹层（U.sheet）打开时会 pushState 压一条自己的记录，
   * 关闭时用 history.back() 撤回 —— 为的是让安卓返回键能关弹层。
   * 但那个 back 引发的 popstate 是**异步**的：用户在弹层里点了日期、
   * 应用刚 replaceState 过 URL，6 毫秒后这个 popstate 到达，
   * 就会把 URL 和界面一起打回旧值 —— 真机上表现为「点了日期不跳转」。
   *
   * 光比 URL 分不清：弹层 back 之后 URL 恰好和"刚写进去的"长得一样。
   * 比 state 里的 __v 就能分清 —— 弹层回退到的是**旧版本**那条记录，直接跳过。
   */
  var HASH_V = 0;

  function writeHash(replace) {
    var hash = '#/shift?d=' + App.date + '&team=' + 'ABCDE'.charAt(App.team);
    HASH_V++;
    var st = { __v: HASH_V, d: App.date, team: App.team };
    try {
      if (replace) history.replaceState(st, '', hash);
      else history.pushState(st, '', hash);
    } catch (e) { location.hash = hash; }
  }
  App.shareLink = function () {
    return location.origin + location.pathname + '#/shift?d=' + App.date +
      '&team=' + 'ABCDE'.charAt(App.team);
  };

  /* ---------------- 启动 ---------------- */
  function boot() {
    elAppbar = U.$('#appbar');
    elView = U.$('#view');
    elBanner = U.$('#banner');

    readStorage();

    var r = parseHash();
    if (r.team != null) App.team = r.team;
    if (r.d) App.date = r.d;
    if (r.y && r.m) App.month = { y: r.y, m: r.m };
    if (!App.month) App.month = { y: +App.date.slice(0, 4), m: +App.date.slice(5, 7) };

    bindGlobals();
    render();

    window.addEventListener('popstate', function (ev) {
      // 只有「我们写进去的那条记录」或「更早的历史」才重新读地址栏。
      // 弹层关闭时 history.back() 撤回的是它自己那条旧记录（__v 比当前小），
      // 这种情况跳过 —— 否则会把刚选好的日期打回去（见 writeHash 上面的注释）。
      var v = ev && ev.state && ev.state.__v;
      if (v != null && v < HASH_V) {
        // 界面不动，但把地址栏补回当前状态，免得 URL 和界面不一致
        try {
          history.replaceState({ __v: HASH_V, d: App.date, team: App.team }, '',
            '#/shift?d=' + App.date + '&team=' + 'ABCDE'.charAt(App.team));
        } catch (e) {}
        return;
      }
      var x = parseHash();
      if (x.team != null) App.team = x.team;
      if (x.d) App.date = x.d;
      if (x.y && x.m) App.month = { y: x.y, m: x.m };
      if (v != null) HASH_V = v;
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
    var view = root.Shift.Views.shift;
    var c = ctx();

    // 先拼成片段再挂进去：这样即使某次渲染返回空串，也不会把旧内容清成一片空白
    var holder = U.node('<div>' + view.render(c) + '</div>');
    elView.innerHTML = '';
    if (holder) elView.appendChild(holder);
    if (view.mount) view.mount(elView, c);

    // 顶栏只有标题，没有副标题
    var title = document.getElementById('title');
    if (title) title.textContent = '倒班日历';

    if (y) window.scrollTo(0, Math.min(y, document.body.scrollHeight));
  }

  function renderBanner() {
    // 顶栏删了，这条 banner 现在只负责"装到桌面"的提示（有才显示）
    var mem = false;
    try {
      localStorage.setItem('__shift_probe__', '1');
      localStorage.removeItem('__shift_probe__');
    } catch (e) { mem = true; }
    if (mem) {
      elBanner.hidden = false;
      elBanner.innerHTML = '<span class="grow">⚠ 这个浏览器不让存东西（隐私模式？）</span>';
      return;
    }
    if (!root.__deferredInstall) { elBanner.hidden = true; elBanner.innerHTML = ''; }
  }

  /* ---------------- 事件 ---------------- */
  function bindGlobals() {
    // 视图里所有 data-* 动作统一在这里分发（日期条和班组条都挪进视图了，所以都在这一条里）
    elView.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act],[data-team],[data-pick],[data-d]');
      if (!t) return;
      // 点日期（总貌格子 / 日历格子）→ 直接跳到那天
      if (t.dataset.pick) { App.setDate(t.dataset.pick); return; }
      // 前后一天（按钮上只有 data-d）
      if (t.dataset.d != null && t.dataset.d !== '') { App.shiftDate(+t.dataset.d); return; }
      if (t.dataset.team != null && t.dataset.team !== '') { App.setTeam(+t.dataset.team); return; }
      var act = t.dataset.act;
      if (!act || act === 'actions') return;
      if (act === 'today') { App.setDate(S.todayStr()); return; }
      if (act === 'pick-date') { openDatePicker(); return; }
      if (act === 'prev-month') { App.setMonth(App.month.y, App.month.m - 1); return; }
      if (act === 'next-month') { App.setMonth(App.month.y, App.month.m + 1); return; }
      if (act === 'install-hide' || act === 'install') { hideBanner(); return; }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') U.closeTop();
      var tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (e.key === 'ArrowLeft') App.shiftDate(-1);
      if (e.key === 'ArrowRight') App.shiftDate(1);
    });

    // 左右滑动切日期（避开弹层、横向表格、班组条）
    var sx = 0, sy = 0, sw = false;
    document.addEventListener('touchstart', function (e) {
      if (U.$('.mask')) { sw = false; return; }
      if (e.target.closest('.tbl-wrap, .mxwrap, input, textarea, select, .sheet, .teampick')) { sw = false; return; }
      var t = e.touches[0];
      sx = t.clientX; sy = t.clientY; sw = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!sw) return;
      sw = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 52) return;
      App.shiftDate(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  App.go = function (id, replace) {
    App.view = 'shift';
    writeHash(replace !== false);
    render();
  };
  App.setDate = function (d) {
    if (!S.isValidDate(d)) return;
    App.date = d;
    App.month = { y: +d.slice(0, 4), m: +d.slice(5, 7) };
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
    render();
  };
  App.refresh = function () { render(); };

  /* ---------------- 弹层 ---------------- */

  /** 一张大的月历：点日期就跳过去 */
  function openDatePicker() {
    var cal = App.cal || { y: +App.date.slice(0, 4), m: +App.date.slice(5, 7) };
    App.cal = cal;

    U.sheet({
      title: '选日期',
      sub: '点一下日期就跳过去',
      body: '<div id="calhost"></div>',
      onMount: function (rootEl, close) {
        var host = U.$('#calhost', rootEl);
        function draw() {
          host.innerHTML = monthGrid(cal.y, cal.m);
        }
        host.addEventListener('click', function (e) {
          var nav = e.target.closest('[data-cal]');
          if (nav) {
            cal.m += +nav.dataset.cal;
            if (cal.m < 1) { cal.m = 12; cal.y--; }
            if (cal.m > 12) { cal.m = 1; cal.y++; }
            draw();
            return;
          }
          var cell = e.target.closest('[data-pick]');
          if (cell && cell.dataset.pick) {
            App.setDate(cell.dataset.pick);
            close();
          }
        });
        host.addEventListener('input', function (e) {
          if (e.target.id !== '__ym') return;
          var v = String(e.target.value || '').split('-');
          if (v.length === 2 && +v[1] >= 1 && +v[1] <= 12) {
            cal.y = +v[0]; cal.m = +v[1];
            draw();
          }
        });
        draw();
      },
      actions: [
        { label: '回到今天', onClick: function () { App.setDate(S.todayStr()); } },
        { label: '关掉' }
      ]
    });
  }

  /** 月历 HTML：周一起头，今天圈出来，当前选中的反白 */
  function monthGrid(y, m) {
    var first = S.firstWeekdayMon(y, m);
    var days = S.daysInMonth(y, m);
    var today = S.todayStr();
    var cells = [];
    var i;
    for (i = 0; i < first; i++) cells.push('<div class="cal-d out"></div>');
    for (i = 1; i <= days; i++) {
      var ds = y + '-' + S.pad2(m) + '-' + S.pad2(i);
      var isToday = ds === today, isSel = ds === App.date;
      cells.push('<div class="cal-d' + (isToday ? ' today' : '') + (isSel ? ' sel' : '') +
        '" data-pick="' + ds + '">' +
        '<span class="n">' + i + '</span>' +
        '<span class="w">' + (S.weekday(ds) || '').slice(1) + '</span>' +
        '</div>');
    }
    var heads = ['一', '二', '三', '四', '五', '六', '日'].map(function (x) {
      return '<div class="cal-wd">' + x + '</div>';
    }).join('');

    return '<div class="row between mb10">' +
      '<button class="btn sm" data-cal="-1">‹ 上月</button>' +
      '<b>' + y + ' 年 ' + m + ' 月</b>' +
      '<button class="btn sm" data-cal="1">下月 ›</button>' +
      '</div>' +
      '<div class="row mb10"><input type="month" id="__ym" value="' + y + '-' + S.pad2(m) +
      '" style="min-height:38px"></div>' +
      '<div class="cal">' + heads + cells.join('') + '</div>' +
      '<div class="legend mt6"><span>今天有蓝圈</span><span>你正在看的那天是深蓝底</span></div>';
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
  /**
   * 安装到桌面：顶栏删了，所以把入口放在最上面那条 banner 里。
   * 浏览器给 beforeinstallprompt 时才出现，平时完全不占地方。
   */
  function wireInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      root.__deferredInstall = e;
      showInstallBar();
    });
    window.addEventListener('appinstalled', function () {
      root.__deferredInstall = null;
      if (elBanner) { elBanner.hidden = true; elBanner.innerHTML = ''; }
      U.toast('已安装到桌面');
    });
  }

  function hideBanner() {
    if (!elBanner) return;
    elBanner.hidden = true;
    elBanner.innerHTML = '';
  }

  function showInstallBar() {
    if (!elBanner) return;
    elBanner.hidden = false;
    elBanner.innerHTML = '<span class="grow">把「倒班日历」装到桌面？</span>' +
      '<button type="button" class="banner-btn" data-act="install">安装</button>' +
      '<button type="button" class="banner-btn ghost" data-act="install-hide">不用</button>';
    wireGlobalActions(elBanner);
  }

  /** 给一个容器挂上和 #view 同一套 data-act 处理（banner 里也要能用） */
  function wireGlobalActions(el) {
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'install') {
        if (root.__deferredInstall) root.__deferredInstall.prompt();
      }
      hideBanner();
    });
  }

  /* ---------------- go ---------------- */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}(typeof globalThis !== 'undefined' ? globalThis : this));
