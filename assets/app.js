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

  /**
   * 下一次渲染要不要把时间轴对准"当前那天"。
   * 换日期 / 换班组 / 首次打开 → true（重新对准）；
   * 其它重渲染（认班组、翻月份、…）→ false（保持用户滚到的位置）。
   */
  var ALIGN_DAY = true;

  /** 时间轴当前覆盖的日期范围（定位后才知道；滚动跟随用它兜底） */
  var RANGE_MIN = null, RANGE_MAX = null;

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
    bindLongPress();
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

    // 时间轴的滚动位置要在重建 DOM 前后接上：
    //   · 换日期 / 换班组 → 重新对准"当前那天"（alignDay = true）
    //   · 只是重新渲染（比如认了"我的班组"）→ 保持用户当前滚到哪
    var prevList = document.getElementById('rowsList');
    var keepTop = prevList ? prevList.scrollTop : -1;

    // 先拼成片段再挂进去：这样即使某次渲染返回空串，也不会把旧内容清成一片空白
    var holder = U.node('<div>' + view.render(c) + '</div>');
    elView.innerHTML = '';
    if (holder) elView.appendChild(holder);
    if (view.mount) view.mount(elView, c);

    syncTimeline(keepTop);

    // 顶栏只有标题，没有副标题
    var title = document.getElementById('title');
    if (title) title.textContent = '倒班日历';

    if (y) window.scrollTo(0, Math.min(y, document.body.scrollHeight));
  }

  /**
   * 时间轴渲染完之后对位置：
   *   alignDay=true（换了日期/班组）→ 把"当前那天"的日期标签和它的行放好。
   *   否则沿用原来滚到的位置，别乱跳。
   *
   * ⚠ 这里是**程序性滚动**，会触发一次 scroll 事件。那一次必须整个跳过：
   *   · infiniteShift 会以为你滚到了边界，给 scrollTop 加/减一整个周期（1967px），
   *     画面被拖到两三天之后 —— 用户报的"点 10月3日 却显示 10月5日"就是这个；
   *   · dayAtTop 也会顺手改掉 App.date。
   * 用 __skipTo 记住我们设到的位置：紧接着那次 scroll 如果正好在这个位置，就跳过。
   * （不用 setTimeout/标志位 —— 浏览器派发 scroll 的时机不保证在定时器之前。）
   */
  function syncTimeline(keepTop) {
    var list = document.getElementById('rowsList');
    if (!list) return;
    if (ALIGN_DAY || keepTop < 0) {
      var anchor = list.querySelector('.daysep.cur') || list.querySelector('.daysep[data-day="' + App.date + '"]');
      var y = anchor ? innerOffset(list, anchor) : -1;
      // 这一天可能有三行、也可能有四行（我休息时会多一行"我 · 休"）。
      // 整块（标签 + 所有行）比可视区高时，把落点往下让一点，
      // 优先保证"当天的行都看得见"（标签被顶掉一点点没关系）。
      // 上限：块的底边不能超过可视区底边，再多让就把下一节挤进来了。
      var blockEnd = y;                        // 块的底 = 下一天标签的顶边
      var sib = anchor && anchor.nextElementSibling;
      while (sib && sib.classList && !sib.classList.contains('daysep')) sib = sib.nextElementSibling;
      if (sib) blockEnd = innerOffset(list, sib);
      var maxY = blockEnd - list.clientHeight;
      if (maxY > y) y = maxY;
      // ⚠ y 可能是负的：渲染刚换完 DOM、布局还没稳（或这一天在可见范围之外，
      //   内偏移算出来是个负值）。这时设 scrollTop 会被夹到 0，画面跳到时间轴最早那几天，
      //   紧接着的 scroll 事件就把日期也改成那天了 —— 用户报的"点某天显示别的天"。
      //   宁可不定位，也不能跳到一个错的日子上。
      if (y >= 0) {
        list.scrollTop = y;
        // 记住"我们自己设到的位置"：只要 scrollTop 还等于它，说明这次滚动是我们引起的，
        // 不当作"用户滚到了别的日子"。等用户真滚动时 scrollTop 就变了，闸门自然失效。
        list.__ownTop = list.scrollTop;
        // 还要确认"列表真的在页面上、有布局"：
        // 渲染过程中列表有一瞬间是脱离文档的，那时 getBoundingClientRect 全是 0，
        // 紧接着到达的 scroll 事件会读到假几何、把日期改成缓冲区的第一天（实测变成 9/12）。
        list.__aligned = list.getBoundingClientRect().height > 0;
      } else {
        list.__ownTop = null;
        list.__aligned = false;
      }
      var seps = list.querySelectorAll('.daysep');
      if (seps.length) {
        RANGE_MIN = seps[0].dataset.day;
        RANGE_MAX = seps[seps.length - 1].dataset.day;
      }
    } else {
      list.scrollTop = keepTop;
      list.__skipTo = null;
    }
    ALIGN_DAY = false;
    bindTimelineScroll(list);
  }

  /* ---------------- 时间轴滚动：日期跟着走 + 无限滚 ---------------- */

  /**
   * 某个元素在滚动容器里的"真实"偏移。
   *
   * ⚠ 不能用 el.offsetTop：它的参照物是最近的定位祖先，而这里是 .card（position 相关），
   *   不是滚动容器 #rowsList —— 实测差 253px（约两天），就会让定位整体偏两天
   *   （用户报的"点 10月3日 却显示 10月5日"）。用 clientTop + 矩形差才准。
   */
  function innerOffset(list, el) {
    var lr = list.getBoundingClientRect();
    var er = el.getBoundingClientRect();
    return (er.top - lr.top) + list.scrollTop - list.clientTop;
  }

  /** 一屏里最上面那一格属于哪一天（按"块"判：这一天的行还占着视口上部就算它） */
  function dayAtTop(list) {
    var seps = list.querySelectorAll('.daysep');
    if (!seps.length) return null;
    var lr = list.getBoundingClientRect();
    for (var i = 0; i < seps.length; i++) {
      var r = seps[i].getBoundingClientRect();
      // 这一天的标签在顶边之下，或者它已经滚过顶边（那它的行就占着上半屏）
      if (r.top >= lr.top - 1) return seps[i].dataset.day;
      var next = seps[i + 1];
      if (next && next.getBoundingClientRect().top > lr.top + 1) return seps[i].dataset.day;
    }
    return seps[seps.length - 1].dataset.day;
  }

  /**
   * 无限滚：时间轴画的是 5 个完整 10 天周期（排版完全一样）。
   * 滚到贴近上/下边界时，把 scrollTop 平移一个周期的高度 —— 画面一模一样，看不出接缝。
   */
  function infiniteShift(list) {
    if (list.__shifting) return;
    var seps = list.querySelectorAll('.daysep');
    if (seps.length < 20) return;
    var cycle = innerOffset(list, seps[10]) - innerOffset(list, seps[0]);
    if (cycle <= 0) return;
    // 缓冲区比一屏高一点就够，不要用一整个周期 ——
    // 否则"定位到某一天"这种正常滚动也会被误判成撞边界。
    var margin = Math.max(200, list.clientHeight);
    list.__shifting = true;
    try {
      var max = list.scrollHeight - list.clientHeight;
      if (list.scrollTop < margin) list.scrollTop += cycle;
      else if (list.scrollTop > max - margin) list.scrollTop -= cycle;
    } finally {
      list.__shifting = false;
    }
  }

  /**
   * 滚到某个日期 → 更新大日期 / 地址栏 / 卡片头，但**不重建 DOM**。
   * 重建的话滚动位置会乱跳，而且这里本来就是"你滚到哪就是哪天"。
   *
   * 只有**用户真的滚了**才会走到这里：定位用的那次滚动被 __skipTo 挡掉了，
   * 定位不到锚点（比如刚翻月份）时 scrollTop 兜底会跳到 0，那种情况也不该改日期。
   */
  function applyDateFromScroll(d) {
    if (!d || d === App.date) return;
    var list = document.getElementById('rowsList');
    if (!list || list.scrollTop <= 1) return;      // 兜底跳到顶了，不是用户滚的
    if (!RANGE_MIN || !RANGE_MAX) return;          // 还没定位过
    if (d < RANGE_MIN || d > RANGE_MAX) return;    // 落在时间轴覆盖范围之外
    App.date = d;
    App.month = { y: +d.slice(0, 4), m: +d.slice(5, 7) };
    writeHash(true);
    renderHeadAndMonth();
    // ⚠ 不要动 document.title —— 冒烟测试靠它回传诊断结果，改掉就取不到了
  }

  /** 只刷新"日期相关但不在时间轴里"的部分：大日期、班组牌子、卡片头、总貌高亮 */
  function renderHeadAndMonth() {
    var P = root.Shift.Views.shift.parts;
    if (!P) return;
    var c = ctx();
    swapHtml('#headHost', P.bigDate(c));
    swapHtml('#pickHost', P.teamPick(c));
    swapHtml('#teamHeadHost', P.teamToday(c));
    swapHtml('#ovHost', P.overview(c));
  }

  function swapHtml(sel, html) {
    var host = U.$(sel);
    if (!host) return;
    var node = U.node('<div>' + html + '</div>');
    host.innerHTML = '';
    if (node) host.appendChild(node);
  }

  function bindTimelineScroll(list) {
    if (list.__bound) return;
    list.__bound = true;
    list.addEventListener('scroll', function () {
      // 还在我们设的那个位置附近（1px 容差）→ 这次滚动是程序引起的，日期不动。
      // 另外必须 __aligned（列表已经在页面上、有布局）：
      //   渲染中间列表有一瞬间脱离文档，此时几何全是 0，读出来会把日期改成缓冲区的第一天。
      // 用容差而不是相等：浏览器会把 scrollTop 取整/夹取，差一点点是很常见的。
      if (list.__aligned && list.__ownTop != null && Math.abs(list.scrollTop - list.__ownTop) <= 1) return;
      if (!list.getBoundingClientRect().height) return;   // 没布局，这次事件不作数
      list.__ownTop = null;                     // 位置真的变了 = 用户滚的，往下正常处理
      // 全部同步做完，**不要**延到 requestAnimationFrame：
      //   rAF 回调里再读 scrollTop/rect 时，DOM 可能已经被后面那次渲染换掉了（渲染是同步的），
      //   于是读到"别人的"位置，日期被改成莫名其妙的一天。
      //   这两件事都很轻：一次平移 + 几次 rect。
      infiniteShift(list);
      applyDateFromScroll(dayAtTop(list));
    }, { passive: true });
  }

  /**
   * 无限滚：时间轴画的是 5 个完整 10 天周期（排版完全一样）。
   * 滚到靠近上/下边界时，把 scrollTop 平移一个周期的高度 —— 画面一模一样，看不出接缝。
   *
   * ⚠ 改 scrollTop 会再触发一次 scroll 事件，所以：
   *   · 加 __shifting 闸门，防重入（同一次里只平移一次）；
   *   · 平移后判一下"还需要再移吗"，避免来回抖动成死循环（那会把页面卡死）。
   */
  function infiniteShift(list) {
    if (list.__shifting) return;
    var seps = list.querySelectorAll('.daysep');
    if (seps.length < 20) return;
    var cycle = seps[10].offsetTop - seps[0].offsetTop;
    if (cycle <= 0) return;
    // 缓冲区只要比一屏高一点就够（够"回一屏还能继续滚"），
    // 不要用一整个周期 —— 那样会把"定位到某一天"这种正常滚动也判成撞边界。
    var margin = Math.max(200, list.clientHeight);
    list.__shifting = true;
    try {
      var max = list.scrollHeight - list.clientHeight;
      // 只有确实贴边了才平移（用 if 而不是 while，避免来回抖动）
      if (list.scrollTop < margin) list.scrollTop += cycle;
      else if (list.scrollTop > max - margin) list.scrollTop -= cycle;
    } finally {
      list.__shifting = false;
    }
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
  /**
   * 长按班组按钮 = 把那个班组设成「我的」。
   * 用 pointer 事件同时覆盖手指和鼠标；移动超过 12px 或松手就取消。
   */
  function bindLongPress() {
    var timer = null, btn = null, x0 = 0, y0 = 0, firedAt = 0;
    function cancel() {
      if (timer) { clearTimeout(timer); timer = null; }
      if (btn) { btn.classList.remove('pressing'); btn = null; }
    }
    elView.addEventListener('pointerdown', function (e) {
      var b = e.target.closest && e.target.closest('.teampick button[data-team]');
      if (!b) return;
      btn = b; x0 = e.clientX; y0 = e.clientY;
      b.classList.add('pressing');
      timer = setTimeout(function () {
        timer = null;
        firedAt = Date.now();
        if (navigator.vibrate) { try { navigator.vibrate(15); } catch (x) {} }
        App.setMyTeam(+b.dataset.team);   // 会重新渲染，按下的 class 自然没了
        btn = null;
      }, 480);
    });
    elView.addEventListener('pointermove', function (e) {
      if (!btn) return;
      if (Math.abs(e.clientX - x0) > 12 || Math.abs(e.clientY - y0) > 12) cancel();
    }, { passive: true });
    elView.addEventListener('pointerup', cancel);
    elView.addEventListener('pointercancel', cancel);
    elView.addEventListener('pointerleave', cancel);
    // 长按已经处理过了，紧接着的那次 click 要丢掉，不然会顺手切成"看那个班组"
    elView.addEventListener('click', function (e) {
      if (Date.now() - firedAt < 700) {
        firedAt = 0;
        e.preventDefault();
        e.stopPropagation();
      }
    }, true);
  }

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
      if (e.target.closest('.tbl-wrap, .mxwrap, input, textarea, select, .sheet, .teampick, .teamrow')) { sw = false; return; }
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
    // 月份跟着日期走 —— 总貌图、月历都以 App.month 为准，不跟就会错位
    App.month = { y: +d.slice(0, 4), m: +d.slice(5, 7) };
    ALIGN_DAY = true;                  // 换日期 → 时间轴重新对准"当前那天"
    writeHash(true);
    render();
  };
  App.shiftDate = function (n) { App.setDate(S.addDays(App.date, n)); };
  App.setTeam = function (i) {
    App.team = S.idxOf(i);
    lsSet(KEY_TEAM, App.team);
    ALIGN_DAY = true;                  // 换班组 → 也重新对准
    writeHash(true);
    render();
  };
  /**
   * 认下「我的班组」。界面上已经有反馈了（那个按钮会带 data-me 标记、我那一行会加粗），
   * 所以不再弹 toast —— 免得挡住内容。
   */
  App.setMyTeam = function (i) {
    App.myTeam = S.idxOf(i);
    lsSet(KEY_MY, App.myTeam);
    render();
  };
  /**
   * 点总貌图的"上月/下月"。日期本身不变 → 时间轴不重新定位，
   * 但月份要跟着走，否则总貌图和日期就对不上了。
   */
  App.setMonth = function (y, m) {
    while (m < 1) { m += 12; y--; }
    while (m > 12) { m -= 12; y++; }
    App.month = { y: y, m: m };
    ALIGN_DAY = false;
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
