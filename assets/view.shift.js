/*!
 * view.shift.js — 两个页面
 *   shift    「今天」：几月几号 + 我选的班组上什么班 + 谁交给我 / 我交给谁
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

  /** 班组选择器（随所选日期变 —— 每个班下面显示的是**那一天**的班，不是今天的） */
  function teamPick(ctx) {
    var d = ctx.date;
    var today = S.todayStr();
    return '<div class="teampick" data-seg="team">' + S.TEAMS.map(function (name, i) {
      var sh = S.shiftOf(d, i);
      return '<button type="button" data-team="' + i + '"' + (i === ctx.teamIndex ? ' class="on"' : '') + '>' +
        '<b>' + U.esc(name) + '</b>' +
        '<span class="ic ' + S.SHIFT_CLASS[sh] + '">' + U.esc(S.SHIFT_BADGE[sh]) + '</span>' +
        (ctx.myTeam === i ? '<i class="my">我的</i>' : '') +
        '</button>';
    }).join('') + '</div>';
  }

  /** 交班一览的一行 */
  function handoverRow(r, opts) {
    opts = opts || {};
    var cls = 'hrow' + (opts.mine ? ' mine' : '') + (opts.dim ? ' dim' : '') + (opts.now ? ' now' : '');
    var nameHtml = U.esc(r.team);
    var tag = opts.tag ? '<span class="htag">' + U.esc(opts.tag) + '</span>' : '';
    var extra = '';
    if (r.carry) extra = '<span class="hsub">昨夜的班，' + U.esc(S.hhmm(r.e)) + ' 下班</span>';
    else if (r.nextDay) extra = '<span class="hsub">次日 ' + U.esc(S.hhmm(r.s)) + ' 上班</span>';
    else if (r.onDate) extra = '<span class="hsub">' + U.esc(r.onDate.slice(5)) + '</span>';

    return '<div class="' + cls + '">' +
      '<div class="hname">' + nameHtml + tag + '</div>' +
      '<div class="hmid">' +
      '<span class="chip ' + S.SHIFT_CLASS[r.shift] + '">' + U.esc(S.SHIFT_NAME[r.shift]) + '</span>' +
      '<span class="htime">' + U.esc(r.range || S.SHIFT_HOURS[r.shift]) + '</span>' +
      extra +
      '</div></div>';
  }

  /* ==================================================================
   * 视图一：今天
   * ================================================================== */
  function renderShift(ctx) {
    var i = ctx.teamIndex, d = ctx.date, today = S.todayStr();
    var t = ctx.team;
    var h = ctx.handover || S.handover(d, i, ctx.ref);
    var now = ctx.onDutyNow;
    var onNow = !!(now && now.index === i);      // 我看的这个班，现在正在岗
    // 上班日：按那一班的时间给个状态（还没上班 / 已经下班 / 现在正上班）
    var dutyState = '';
    if (h.onDuty && !onNow && ctx.isToday) {
      var nowMin = ctx.ref - S.dayNum(d) * 1440;   // 现在这一天的分钟
      var startMin = S.BLOCKS[h.shift][0][0], endMin = S.BLOCKS[h.shift][0][1];
      if (nowMin < startMin) dutyState = '还没上班';
      else if (nowMin >= endMin) dutyState = '这个班已经上完了';
    }
    var out = [];

    /* ---- 大日期 + 前后一天 ---- */
    var off = S.daysBetween(today, d);
    var rel = d === today ? '今天' : (off === 1 ? '明天' : off === -1 ? '昨天' :
      (off > 0 ? off + ' 天后' : Math.abs(off) + ' 天前'));
    out.push('<div class="datebar2">' +
      '<button class="navbtn" data-d="-1" aria-label="前一天">‹</button>' +
      '<div class="bigdate" data-act="pick-date" role="button" title="点一下跳到别的日期">' +
      '<span class="bd-md">' + S.mdLabel(d) + '</span>' +
      '<span class="bd-wd">' + S.weekday(d) + '</span>' +
      '<span class="bd-rel">' + (d === today ? '今天' : U.esc(rel)) + '</span>' +
      '</div>' +
      '<button class="navbtn" data-d="1" aria-label="后一天">›</button>' +
      '</div>' +
      '<div class="datebar3">' +
      '<button class="btn sm" data-act="today">回今天</button>' +
      '<span class="small muted">也可以左右滑动换日期</span>' +
      '</div>');

    /* ---- 班组选择 ---- */
    out.push('<div class="sect-title">点一下换班组（牌子上是这一天的班）</div>');
    out.push(teamPick(ctx));

    /* ---- 我的班 + 交接 ---- */
    var headTitle = S.SHIFT_NAME[onNow ? now.shift : h.shift];
    if (onNow) headTitle += '　' + now.range + '　<span class="nowtag">正在上班</span>';
    else if (h.onDuty) headTitle += '　' + h.range + (dutyState ? '　<span class="pill">' + dutyState + '</span>' : '');
    var rows = [];

    if (onNow) {
      // 正在上班：按现在这一刻算上下家（比按「这一天排的班」更准）
      var segs = S.daySegments(d, now.ref);
      var idx = -1, k;
      for (k = 0; k < segs.length; k++) {
        if (segs[k].index === i && segs[k].s <= now.ref && now.ref < segs[k].e) { idx = k; break; }
      }
      if (idx >= 0) {
        var seg = segs[idx];
        var up = null, down = null;
        for (k = 0; k < segs.length; k++) {
          if (segs[k] === seg) continue;
          if (segs[k].e === seg.s && !up) up = segs[k];
          if (segs[k].s === seg.e && !down) down = segs[k];
        }
        if (up) rows.push(handoverRow({ index: up.index, team: up.team, shift: up.shift,
          range: S.mmRange(up.start, up.end), carry: true, e: up.end }, { tag: '接班' }));
        rows.push(handoverRow({ index: i, team: t.name, shift: seg.shift,
          range: S.mmRange(seg.start, seg.end) }, { mine: true, now: true, tag: '我 · 在岗' }));
        if (down) rows.push(handoverRow({ index: down.index, team: down.team, shift: down.shift,
          range: S.mmRange(down.start, down.end), nextDay: true, s: down.start }, { tag: '交给' }));
      }
    } else {
      if (h.arrives) rows.push(handoverRow(h.arrives, { tag: '接班' }));
      else if (h.onDuty) {
        rows.push('<div class="hrow empty"><div class="hname">—</div><div class="hmid">' +
          '<span class="hsub">这一班没人交给我（当天最早的一班）</span></div></div>');
      }
      rows.push(handoverRow({ index: i, team: t.name, shift: h.shift, range: h.range },
        { mine: true, tag: '我' }));
      if (h.leaves) rows.push(handoverRow(h.leaves, { tag: '交给' }));
      else if (h.onDuty) {
        rows.push('<div class="hrow empty"><div class="hname">—</div><div class="hmid">' +
          '<span class="hsub">这一班没人接我的班</span></div></div>');
      }
    }

    out.push(U.card(headTitle, '<div class="hlist">' + rows.join('') + '</div>' +
      U.note('上面那行是<b>把班交给我的人</b>，下面那行是<b>接我班的人</b>；中间加粗的就是我。' +
        (h.basis === 'rest' && !onNow
          ? '<br>这一天 <b>' + U.esc(t.name) + ' 休息</b>：上面是<b>上一个班（' +
            U.esc(h.prevWork ? h.prevWork.date : '—') + '）交班给了谁</b>，下面是<b>下一个班（' +
            U.esc(h.nextWork ? h.nextWork.date : '—') + '）从谁手里接班</b>。'
          : ''), 'info'), { rawTitle: true }));

    /* ---- 后面还有什么 ---- */
    var tips = [];
    var nw;
    if (onNow) {
      // 已经在这个班上了 —— 那就别看「下一次上班」了，看啥时候能歇
      var rest = S.nextRest(d, i);
      if (rest) {
        tips.push('<div class="kv"><div class="k">本班下班</div><div class="v"><b>' +
          U.esc(now.range.split('-')[1]) + '</b>　' + (rest.daysUntil === 0
            ? '然后就休息了' : '之后还要连着上 ' + rest.daysUntil + ' 天') + '</div></div>');
      }
      nw = S.nextWork(S.addDays(d, 1), i);
      tips.push('<div class="kv"><div class="k">下一次上班</div><div class="v">' +
        (nw ? '<b>' + U.esc(nw.date) + '（' + S.weekday(nw.date) + '）</b>　' + U.chip(nw.shift) + '　' + U.esc(nw.hours) : '—') +
        '</div></div>');
    } else {
      nw = S.nextWork(today, i);
      if (nw) {
        tips.push('<div class="kv"><div class="k">下次上班</div><div class="v"><b>' + nw.date +
          '（' + S.weekday(nw.date) + '）</b>　' + U.chip(nw.shift) + '　' + U.esc(nw.hours) +
          (nw.daysUntil === 0 ? '　<span class="pill">就在今天</span>' :
            '　<span class="pill">' + nw.daysUntil + ' 天后</span>') + '</div></div>');
      }
      var nx = S.nextWork(S.addDays(d, 1), i);
      if (nx) {
        var nxGap = S.daysBetween(d, nx.date);
        tips.push('<div class="kv"><div class="k">再下一次</div><div class="v">' +
          S.mdLabel(nx.date) + '（' + S.weekday(nx.date) + '）　' + U.chip(nx.shift) + '　' + U.esc(nx.hours) +
          (nxGap > 1 ? '　<span class="pill">隔 ' + nxGap + ' 天</span>' : '') + '</div></div>');
      }
    }
    var st = S.monthStats(+d.slice(0, 4), +d.slice(5, 7), i);
    tips.push('<div class="kv"><div class="k">本月</div><div class="v">' +
      U.esc(d.slice(0, 7)) + '：白 ' + st['白'] + ' 天　中 ' + st['中'] + ' 天　夜 ' + st['夜'] +
      ' 天　休 ' + st['休'] + ' 天　（合计 ' + S.h1(st.总工时) + ' 小时）</div></div>');
    out.push(U.card('后面还有什么', '<div>' + tips.join('') + '</div>'));

    /* ---- 底部 ---- */
    out.push('<div class="btn-row mt10" data-act="actions">' +
      '<button class="btn sm" data-go="overview">看整月总貌</button>' +
      '<button class="btn sm" data-act="share">复制链接</button>' +
      '<button class="btn sm" data-act="rules">轮转规则</button>' +
      '</div>');

    return out.join('');
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

    h.push('<div class="sect-title">点一下换高亮的班组（牌子上是今天各自的班）</div>');
    h.push(teamPick({ date: today, teamIndex: i, myTeam: ctx.myTeam }));

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
      '<span>左上小点 = 轮转第 1 天</span><span>点格子看时段</span>' +
      '</div>' +
      '<div class="small muted mt6">横向可左右滑动看完整月。</div>',
      { tight: true }));

    var st = S.monthStats(m.y, m.m, i);
    h.push(U.card(ctx.team.name + '　' + U.monthLabel(m.y, m.m) + ' 统计',
      monthStatsTable(st)));

    var rows = [];
    for (var k2 = 0; k2 < st.byDay.length; k2++) {
      var it = st.byDay[k2];
      var b = S.blocksOn(it.date, i);
      rows.push([
        '<b>' + it.day + '</b> <span class="muted">' + S.weekday(it.date).slice(1) + '</span>',
        U.chip(it.shift),
        it.minutes ? (b.today ? U.esc(b.today.startText + '-' + b.today.endText) : S.SHIFT_HOURS[it.shift]) : '—',
        it.minutes ? U.dur(it.minutes) : '—'
      ]);
    }
    h.push('<details class="card"><summary class="card-h"><h2>' + U.esc(ctx.team.name) +
      ' 每日明细</h2><span class="hint">' + mx.days + ' 天</span></summary>' +
      U.table(['日期', '班次', '时段', '当日工时'], rows, { cls: 'tight' }) + '</details>');

    h.push('<div class="btn-row mt10" data-act="actions">' +
      '<button class="btn sm" data-go="shift">回到今天</button>' +
      '<button class="btn sm" data-act="csv">导出 CSV</button>' +
      '<button class="btn sm" data-act="rules">轮转规则</button>' +
      '</div>');

    return h.join('');
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

  function mount(el, ctx) {
    /* 事件都由 app.js 在 #view 上统一委托 */
  }

  if (kind === 'shift') {
    return { id: 'shift', title: '今天', render: renderShift, mount: mount };
  }
  return { id: 'overview', title: '总貌', render: renderOverview, mount: mount };
}));
