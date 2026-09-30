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

  /**
   * 本日一览：**固定按 夜班 → 白班 → 中班** 排（这也是它们每天接力的先后）。
   * 每个班次恰好一个班组在岗。
   * 如果「我的班组」这天休息，就在最后再加一行自己的「休息」。
   */
  function shiftRows(ctx, i) {
    var d = ctx.date;
    var h = ctx.handover || S.handover(d, i, ctx.ref);
    var now = ctx.onDutyNow;
    var onNow = !!(now && now.index === i);
    var order = ['夜', '白', '中'];
    var rows = [];

    for (var k = 0; k < order.length; k++) {
      var sh = order[k];
      var who = null, startedPrev = false, t;
      for (t = 0; t < 5; t++) {
        if (S.shiftOf(d, t) !== sh) continue;
        if (!S.spanOf(d, t)) continue;
        who = t; break;
      }
      if (who == null) {
        // 当天的格子没排到它（但前一天那班跨零点，凌晨还在岗）
        for (t = 0; t < 5; t++) {
          var ps = S.spanOf(S.addDays(d, -1), t);
          if (ps && ps.end > 1440 && S.shiftOf(S.addDays(d, -1), t) === sh) { who = t; startedPrev = true; break; }
        }
      }
      if (who == null) continue;
      var sp = S.spanOf(d, who) || S.spanOf(S.addDays(d, -1), who);
      rows.push({
        shift: sh, index: who, team: S.team(who).name,
        range: startedPrev ? ('18:55-次日' + S.hhmm(sp.end)) : S.mmRange(sp.start, sp.end),
        carry: startedPrev,
        mine: who === i,
        brief: startedPrev ? ('从 ' + S.addDays(d, -1).slice(5) + ' 晚上上到现在')
          : (sp.end > 1440 ? '跨零点，次日 ' + S.hhmm(sp.end) + ' 下班' : ''),
        atText: S.hhmm(sp.end)
      });
    }

    // 自己的班不在上面（休息）→ 单独补一行
    if (!rows.some(function (r) { return r.mine; })) {
      rows.push({
        shift: '休', index: i, team: S.team(i).name, range: '', mine: true, rest: true,
        brief: '这一天不上班'
      });
    }

    // 看今天 + 正好在上班 → 标出来
    for (var r2 = 0; r2 < rows.length; r2++) {
      if (onNow && rows[r2].index === i && !rows[r2].rest) { rows[r2].now = true; rows[r2].range = now.range; }
    }
    return rows;
  }

  /** 一览里的一行 */
  function shiftRow(r, opts) {
    opts = opts || {};
    var cls = 'hrow s-' + S.SHIFT_CLASS[r.shift]
      + (r.mine ? ' mine' : '')
      + (r.rest ? ' restrow' : '')
      + (r.now ? ' now' : '');
    var tag = r.rest ? '休息' : (r.mine ? (r.now ? '我 · 在岗' : '我') : '');
    var brief = r.brief ? '<span class="hsub">' + U.esc(r.brief) + '</span>' : '';
    return '<div class="' + cls + '">' +
      '<div class="hname">' + U.esc(r.team) +
      (tag ? '<span class="htag">' + U.esc(tag) + '</span>' : '') + '</div>' +
      '<div class="hmid">' +
      '<span class="chip ' + S.SHIFT_CLASS[r.shift] + '">' + U.esc(S.SHIFT_NAME[r.shift]) + '</span>' +
      (r.range ? '<span class="htime">' + U.esc(r.range) + '</span>' : '') +
      brief +
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
    // 上班日：按那一班的时间给个状态（还没上班 / 已经上完了）
    var dutyState = '';
    if (h.onDuty && !onNow && ctx.isToday) {
      var nowMin = ctx.ref - S.dayNum(d) * 1440;
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
    else headTitle = t.name + '　休息';

    var rows = shiftRows(ctx, i).map(function (r) { return shiftRow(r); });

    out.push(U.card(headTitle, '<div class="hlist">' + rows.join('') + '</div>' +
      U.note('固定按 <b>夜班 → 白班 → 中班</b> 排（这也是它们每天接力的先后）。' +
        '<b>加粗那一行就是我</b> —— ' +
        (h.onDuty
          ? '我这一班上面那个班（' + (h.arrives ? U.esc(h.arrives.team) + ' ' + U.esc(S.SHIFT_NAME[h.arrives.shift]) : '—') +
            '）把班交给我，下面那个班（' + (h.leaves ? U.esc(h.leaves.team) + ' ' + U.esc(S.SHIFT_NAME[h.leaves.shift]) : '—') + '）接我的班。'
          : '我这一天休息，上面三行就是当天在上班的三个班。'),
        'info'), { rawTitle: true }));

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
