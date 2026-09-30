/*!
 * view.shift.js — 两个主视图
 *   shift    「轮转」：我的班组这一天/这一轮 + 今天谁在上班
 *   overview 「总貌」：当月 5 个班组 × 每一天
 *
 * render() 全是纯字符串拼装，Node 里可以直接渲染做冒烟测试。
 */
(function (root, factory) {
  root.Shift = root.Shift || {};
  root.Shift.Views = root.Shift.Views || {};
  var S = root.Shift;
  root.Shift.Views.shift = factory(S, S.UI, 'shift');
  root.Shift.Views.overview = factory(S, S.UI, 'overview');
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S, U, kind) {
  'use strict';

  /* ==================================================================
   * 公共片段
   * ================================================================== */

  /** 10 天轮转条：当前是第几天一眼看到 */
  function cycleStrip(selDate, teamIdx) {
    var cur = S.dayIndexOf(selDate, teamIdx);
    var cells = S.CYCLE.map(function (sh, i) {
      var n = i + 1;
      var cls = S.SHIFT_CLASS[sh];
      var on = n === cur ? ' on' : '';
      var isNow = n === cur ? '<span class="now">天 ' + n + '</span>' : '<span class="n">' + n + '</span>';
      return '<div class="cy ' + cls + on + '" title="第 ' + n + ' 天 ' + S.SHIFT_NAME[sh] + '">' +
        isNow + '<span class="sb">' + S.SHIFT_BADGE[sh] + '</span>' +
        '<span class="hr">' + (S.LEN[sh] ? S.SHIFT_HOURS[sh].replace('-', '<br>') : '—') + '</span>' +
        '</div>';
    }).join('');
    return '<div class="cyclestrip">' + cells + '</div>' +
      '<div class="legend">' +
      Object.keys(S.SHIFT_NAME).map(function (k) {
        return '<span><i class="lg ' + S.SHIFT_CLASS[k] + '"></i>' + U.esc(S.SHIFT_NAME[k]) + '</span>';
      }).join('') +
      '<span>数字 = 轮转第几天</span></div>';
  }

  /** 未来 N 天的排班表 */
  function upcoming(selDate, teamIdx, n) {
    var rows = [];
    for (var k = 0; k < (n || 7); k++) {
      var d = S.addDays(selDate, k);
      var sh = S.shiftOf(d, teamIdx);
      var b = S.blocksOn(d, teamIdx);
      var when = d === S.todayStr() ? '今天' : d === S.addDays(S.todayStr(), 1) ? '明天' :
        (d === S.addDays(S.todayStr(), -1) ? '昨天' : '');
      rows.push([
        U.esc(d.slice(5)) + ' ' + S.weekday(d).slice(1) + (when ? ' <span class="pill">' + when + '</span>' : ''),
        U.chip(sh),
        S.LEN[sh] ? U.esc(b.today ? b.today.startText + '-' + (b.today.endText) : S.SHIFT_HOURS[sh]) : '—',
        b.yesterday ? '<span class="small muted">' + U.esc(b.yesterday.label) + '</span>'
          : (b.tomorrow ? '<span class="small muted">' + U.esc(b.tomorrow.label) + '</span>' : '')
      ]);
    }
    return U.table(['日期', '班次', '时段', '备注'], rows, { cls: 'tight' });
  }

  /** 一条「今天要干什么」的提示 */
  function smartNote(selDate, teamIdx) {
    var b = S.blocksOn(selDate, teamIdx);
    var today = S.todayStr();
    var isToday = selDate === today;
    var out = [];

    if (b.yesterday) out.push(['info', '<b>' + U.esc(b.yesterday.label) + '</b>：' + U.esc(b.yesterday.shiftName) + '是昨夜上的班，今天回家补觉。']);
    if (b.today) out.push(['ok', '<b>' + U.esc(b.today.label) + '</b>　上班前留出通勤时间。']);
    else out.push(['info', '<b>今天休息。</b>' + (b.tomorrow ? U.esc(b.tomorrow.label) + '。' : '')]);
    if (b.tomorrow && !b.today) { /* 已在上面说过 */ }
    else if (b.tomorrow) out.push(['info', U.esc(b.tomorrow.label) + '。']);

    if (b.myShift === '夜' || b.yesterday && b.yesterday.shift === '夜') {
      out.push(['warn', '夜班前后：下班后先补觉，睡前别喝浓茶咖啡。']);
    }
    if (b.myShift === '中') {
      out.push(['warn', '中班跨零点：18:55 上到次日 02:55，下班就睡，白天别睡太久。']);
    }
    if (!isToday) {
      return U.note('这是 <b>' + selDate + '（' + S.weekday(selDate) + '）</b> 的排班，不是今天的。', '') +
        out.map(function (r) { return U.note(r[1], r[0]); }).join('');
    }
    return out.map(function (r) { return U.note(r[1], r[0]); }).join('');
  }

  /* ==================================================================
   * 视图一：轮转
   * ================================================================== */
  function renderShift(ctx) {
    var S2 = ctx.Shift, i = ctx.teamIndex, d = ctx.date;
    var t = ctx.team;
    var b = S2.blocksOn(d, i);
    var dayIdx = S2.dayIndexOf(d, i);
    var today = S2.todayStr();
    var h = [];

    h.push('<div class="sect-title">' + U.esc(t.name) + '　·　' + S2.mdLabel(d) + '　' + S2.weekday(d) + '</div>');

    /* ---- 这一天 ---- */
    var big = S2.SHIFT_NAME[b.myShift];
    var sub = S2.LEN[b.myShift]
      ? (b.today.startText + ' → ' + b.today.endText + '（' + U.dur(S2.LEN[b.myShift]) + '）')
      : '今天不上班';
    h.push(U.card(null,
      '<div class="today ' + S2.SHIFT_CLASS[b.myShift] + '">' +
      '<div class="l"><span class="nm">' + U.esc(big) + '</span>' +
      '<span class="sub">' + U.esc(sub) + '</span></div>' +
      '<div class="r"><span class="dn">轮转第 ' + dayIdx + '</span><span class="of">/10 天</span></div>' +
      '</div>' + smartNote(d, i), { tight: true }));

    /* ---- 今天该显示的三段（夜班两格都标） ---- */
    h.push(U.card('这一天的三个时段',
      U.kvRows([
        ['昨天留下的', b.yesterday ? U.esc(b.yesterday.label) + '　<span class="chip ' + b.yesterday.cls + '">' + U.esc(b.yesterday.shiftName) + '</span>' : '—'],
        ['当天上班', b.today ? U.esc(b.today.label) + '　<span class="chip ' + b.today.cls + '">' + U.esc(b.today.shiftName) + '</span>' : '<b>不上班</b>'],
        ['明天', b.tomorrow ? U.esc(b.tomorrow.label) :
          (S2.LEN[S2.shiftOf(S2.addDays(d, 1), i)] ? '明天一天都在休息' : '明天休息')]
      ]) +
      U.note('班次记在<b>开始那天</b>。中班跨零点，所以第二天早上会显示「中班 02:55 下班」；' +
        '夜班 02:55-10:25 整段都在当天。', 'info')));

    /* ---- 下一个班 ---- */
    var nw = S2.nextWork(today, i);
    if (nw) {
      var dd = nw.daysUntil === 0 ? '就在今天' : (nw.daysUntil === 1 ? '明天' : nw.daysUntil + ' 天后');
      var rest = S2.nextRest(today, i);
      h.push(U.card('下一个班（按今天算）',
        U.kvRows([
          ['下一次上班', '<b>' + nw.date + '（' + S2.weekday(nw.date) + '）</b>　' + U.chip(nw.shift) + '　' + U.esc(nw.hours)],
          ['还有', dd],
          rest ? ['下次休息', rest.date + '（' + S2.weekday(rest.date) + '）' + (rest.daysUntil === 0 ? '，今天就是' : '，' + rest.daysUntil + ' 天后')] : null
        ])));
    }

    /* ---- 10 天轮转 ---- */
    h.push(U.card('10 天轮转（' + t.name + '）', cycleStrip(d, i) +
      '<div class="small muted mt6">轮转锚点：' + S2.ANCHOR_TEAM1 + ' 起，' + t.name + ' 的轮转第 1 天是 ' +
      U.esc(t.phaseAnchor) + '。每 2 天换一班，10 天一轮。</div>'));

    /* ---- 未来 7 天 ---- */
    h.push(U.card('往后 7 天', upcoming(d, i, 7)));

    /* ---- 今天谁在上班 ---- */
    var todayRows = S2.TEAMS.map(function (name, k) {
      var st = S2.shiftOf(today, k);
      var blk = S2.blocksOn(today, k);
      var span = [];
      if (blk.yesterday) span.push('昨夜 ' + blk.yesterday.atText + ' 下班');
      if (blk.today) span.push(blk.today.startText + '-' + blk.today.endText);
      if (blk.tomorrow) span.push('明早 ' + blk.tomorrow.atText + ' 上班');
      return [
        (k === i ? '<b>' + U.esc(name) + '</b>' : U.esc(name)) + (ctx.myTeam === k ? ' <span class="pill">我的</span>' : ''),
        U.chip(st),
        span.length ? U.esc(span.join('　')) : '全天休息'
      ];
    });
    h.push(U.card('今天（' + today + '）5 个班在岗情况', U.table(['班组', '班次', '时段'], todayRows)));

    /* ---- 操作 ---- */
    h.push('<div class="btn-row mt10" data-act="actions">' +
      '<button class="btn sm" data-act="share">复制这一天的链接</button>' +
      '<button class="btn sm" data-act="my-team">把这班设为我的班组</button>' +
      '<button class="btn sm" data-act="rules">轮转规则</button>' +
      '</div>');

    /* ---- 本月统计 ---- */
    h.push(U.card('本月统计（' + ctx.month.y + ' 年 ' + ctx.month.m + ' 月）　' + t.name,
      monthStatsTable(monthStatsOf(d, i)) +
      U.note('要换月份看整月排班，去底部「<b>总貌</b>」标签，那里能左右翻月份。', 'info') +
      '<div class="btn-row mt10"><button class="btn sm" data-act="csv">导出本月 CSV</button></div>'));

    return h.join('');
  }

  /** 选中日期所在月份、某个班的统计 */
  function monthStatsOf(dateStr, teamIdx) {
    return S.monthStats(+dateStr.slice(0, 4), +dateStr.slice(5, 7), teamIdx);
  }

  function monthStatsTable(st) {
    var note = '「天数」按<b>班次开始那天</b>算；合计是<b>本月实际在岗工时</b>';
    if (st.prevCarry) note += '（含上月最后一天中班拖进来的 ' + st.prevCarry + ' 分钟';
    if (st.nextCarry) {
      note += st.prevCarry
        ? '，本月最后一天中班拖到下月 ' + st.nextCarry + ' 分钟）'
        : '（本月最后一天的中班拖到下月 ' + st.nextCarry + ' 分钟）';
    } else if (st.prevCarry) {
      note += '）';
    }
    note += '。';
    return U.table(['班次', '天数', '工时'], [
      [U.chip('白'), st['白'] + ' 天', st['白'] * S.LEN['白'] / 60 + ' h'],
      [U.chip('中'), st['中'] + ' 天', st['中'] * S.LEN['中'] / 60 + ' h'],
      [U.chip('夜'), st['夜'] + ' 天', st['夜'] * S.LEN['夜'] / 60 + ' h'],
      [U.chip('休'), st['休'] + ' 天', '—'],
      ['<b>合计</b>', '<b>' + st.上班天数 + ' 天上班 / ' + st.休息天数 + ' 天休息</b>',
        '<b>' + S.h1(st.总工时) + ' h</b>']
    ], { cls: 'tight' }) + '<div class="small muted mt6">' + note + '</div>';
  }

  /* ==================================================================
   * 视图二：总貌（当月 5 个班组 × 每一天）
   * ================================================================== */
  function renderOverview(ctx) {
    var m = ctx.month, i = ctx.teamIndex;
    var mx = S.monthMatrix(m.y, m.m);
    var today = S.todayStr();
    var h = [];

    h.push('<div class="row between mb10">' +
      '<button class="btn sm" data-act="prev-month">‹ 上月</button>' +
      '<b>' + U.monthLabel(m.y, m.m) + '</b>' +
      '<button class="btn sm" data-act="next-month">下月 ›</button>' +
      '</div>');

    /* 表头：日期 1..N */
    var head = '<tr><th class="stickyc">班组</th>';
    for (var d = 1; d <= mx.days; d++) {
      var ds = m.y + '-' + S.pad2(m.m) + '-' + S.pad2(d);
      var wd = '日一二三四五六'.charAt(new Date(Date.UTC(m.y, m.m - 1, d)).getUTCDay());
      head += '<th class="dcol' + (ds === today ? ' istoday' : '') + '">' +
        '<span class="dd">' + d + '</span><span class="wd">' + wd + '</span></th>';
    }
    head += '</tr>';

    var body = mx.rows.map(function (row) {
      var tr = '<tr' + (row.index === i ? ' class="mine"' : '') + '>' +
        '<th class="stickyc">' + U.esc(row.short) + (ctx.myTeam === row.index ? '<i class="my">我的</i>' : '') + '</th>';
      for (var k = 0; k < row.cells.length; k++) {
        var c = row.cells[k];
        tr += '<td class="shiftcell ' + c.cls + (c.isToday ? ' istoday' : '') + '"' +
          ' data-cell="' + c.date + '" data-team="' + row.index + '"' +
          ' title="' + U.esc(S.TEAMS[row.index] + ' ' + c.date + ' ' + S.SHIFT_NAME[c.shift] + ' ' + S.SHIFT_HOURS[c.shift]) + '">' +
          S.SHIFT_BADGE[c.shift] + (c.isFirst ? '<i class="c1"></i>' : '') + '</td>';
      }
      return tr + '</tr>';
    }).join('');

    h.push(U.card(null,
      '<div class="mxwrap"><table class="mx">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="legend mt6">' +
      Object.keys(S.SHIFT_NAME).map(function (k) {
        return '<span><i class="lg ' + S.SHIFT_CLASS[k] + '"></i>' + U.esc(S.SHIFT_NAME[k]) + '</span>';
      }).join('') +
      '<span>左上小点 = 轮转第 1 天</span>' +
      '<span>点格子看时段</span>' +
      '</div>' +
      '<div class="small muted mt6">横向可左右滑动看完整月。高亮那一行是你正在看的班组。</div>',
      { tight: true }));

    /* 选中班组的本月统计 + 出勤明细 */
    var st = S.monthStats(m.y, m.m, i);
    h.push(U.card(ctx.team.name + '　' + U.monthLabel(m.y, m.m) + ' 统计',
      monthStatsTable(st) +
      '<div class="small muted mt6">白班 ' + S.SHIFT_HOURS['白'] + '　中班 ' + S.SHIFT_HOURS['中'] +
      '　夜班 ' + S.SHIFT_HOURS['夜'] + '（中班跨零点，工时按实际时长算）</div>'));

    /* 每一天的班次明细（紧凑两列） */
    var rows = [];
    for (var k2 = 0; k2 < st.byDay.length; k2++) {
      var it = st.byDay[k2];
      var b = S.blocksOn(it.date, i);
      rows.push([
        '<b>' + it.day + '</b> <span class="muted">' + S.weekday(it.date).slice(1) + '</span>',
        U.chip(it.shift),
        it.minutes ? (b.today ? U.esc(b.today.startText + '-' + b.today.endText) : S.SHIFT_HOURS[it.shift]) : '—',
        it.minutes ? (it.minutes < S.LEN[it.shift] ? U.dur(it.minutes) + '<span class="small muted">(跨日)</span>' : U.dur(it.minutes)) : '—'
      ]);
    }
    h.push('<details class="card"><summary class="card-h"><h2>' + U.esc(ctx.team.name) + ' 每日明细</h2><span class="hint">' + mx.days + ' 天</span></summary>' +
      U.table(['日期', '班次', '时段', '当日工时'], rows, { cls: 'tight' }) + '</details>');

    h.push('<div class="btn-row mt10">' +
      '<button class="btn sm" data-act="share">复制这个月的链接</button>' +
      '<button class="btn sm" data-act="csv">导出 CSV</button>' +
      '<button class="btn sm" data-act="rules">轮转规则</button>' +
      '</div>');

    return h.join('');
  }

  /* ==================================================================
   * mount：把 render 出来的壳里需要就地操作的部分接上（这里基本都用全局委托）
   * ================================================================== */
  function mount(el, ctx) {
    /* 明细折叠里没有额外事件；格子点击由 app.js 统一委托 */
  }

  if (kind === 'shift') {
    return { id: 'shift', title: '轮转', render: renderShift, mount: mount };
  }
  return { id: 'overview', title: '总貌', render: renderOverview, mount: mount };
}));
