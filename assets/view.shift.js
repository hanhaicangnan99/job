/*!
 * view.shift.js — 只有一个页面（从上到下）：
 *   1. 大日期（点一下弹出大月历，点哪天跳哪天）
 *   2. 班组选择器
 *   3. 本日一览：固定 夜班 → 白班 → 中班（我休息时最后多一行「休息」）
 *   4. 总貌图：当月 5 个班组 × 每一天
 *
 * render() 全是纯字符串拼装，Node 里可以直接渲染做冒烟测试。
 */
(function (root, factory) {
  root.Shift = root.Shift || {};
  root.Shift.Views = root.Shift.Views || {};
  var S = root.Shift;
  root.Shift.Views.shift = factory(S, S.UI, 'shift');
}(typeof globalThis !== 'undefined' ? globalThis : this, function (S, U, kind) {
  'use strict';

  /* ==================================================================
   * 1) 大日期
   * ================================================================== */
  function bigDate(ctx) {
    var d = ctx.date, today = S.todayStr();
    var off = S.daysBetween(today, d);
    var rel = d === today ? '今天' : (off === 1 ? '明天' : off === -1 ? '昨天' :
      (off > 0 ? off + ' 天后' : Math.abs(off) + ' 天前'));
    return '<div class="datebar2">' +
      '<button class="navbtn" data-d="-1" aria-label="前一天">‹</button>' +
      '<div class="bigdate" data-act="pick-date" role="button" title="点一下打开日历">' +
      '<span class="bd-md">' + S.mdLabel(d) + '</span>' +
      '<span class="bd-wd">' + S.weekday(d) + '</span>' +
      '<span class="bd-rel">' + (d === today ? '今天' : U.esc(rel)) + '</span>' +
      '</div>' +
      '<button class="navbtn" data-d="1" aria-label="后一天">›</button>' +
      '</div>' +
      '<div class="datebar3">' +
      '<button class="btn sm" data-act="pick-date">📅 点这里选日期</button>' +
      '<button class="btn sm" data-act="today">回今天</button>' +
      '</div>';
  }

  /* ==================================================================
   * 2) 班组选择器（牌子上的班次跟着所看日期变）
   * ================================================================== */
  function teamPick(ctx) {
    var d = ctx.date;
    return '<div class="teampick">' + S.TEAMS.map(function (name, i) {
      var sh = S.shiftOf(d, i);
      return '<button type="button" data-team="' + i + '"' + (i === ctx.teamIndex ? ' class="on"' : '') + '>' +
        '<b>' + U.esc(name) + '</b>' +
        '<span class="ic ' + S.SHIFT_CLASS[sh] + '">' + U.esc(S.SHIFT_BADGE[sh]) + '</span>' +
        (ctx.myTeam === i ? '<i class="my">我的</i>' : '') +
        '</button>';
    }).join('') + '</div>';
  }

  /* ==================================================================
   * 3) 本日一览：固定 夜班 → 白班 → 中班
   * ================================================================== */
  function shiftRows(ctx, i) {
    var d = ctx.date;
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
      var sp = (who == null) ? null : S.spanOf(d, who);
      if (who == null) {
        // 当天的格子没排到它 —— 前一天那班跨零点，凌晨还在岗
        var py = S.addDays(d, -1);
        for (t = 0; t < 5; t++) {
          var ps = S.spanOf(py, t);
          if (ps && ps.end > 1440 && S.shiftOf(py, t) === sh) { who = t; startedPrev = true; sp = ps; break; }
        }
      }
      if (who == null || !sp) continue;
      rows.push({
        shift: sh, index: who, team: S.team(who).name,
        range: startedPrev ? ('18:55-次日' + S.hhmm(sp.end)) : S.mmRange(sp.start, sp.end),
        mine: who === i,
        brief: startedPrev ? ('从 ' + S.addDays(d, -1).slice(5) + ' 晚上上到现在')
          : (sp.end > 1440 ? '跨零点，次日 ' + S.hhmm(sp.end) + ' 下班' : '')
      });
    }

    // 我这一天休息 → 最后补一行自己的「休息」
    var hasMine = false;
    for (var q = 0; q < rows.length; q++) if (rows[q].mine) hasMine = true;
    if (!hasMine) {
      rows.push({
        shift: '休', index: i, team: S.team(i).name, range: '', mine: true, rest: true,
        brief: '这一天不上班'
      });
    }

    for (var r2 = 0; r2 < rows.length; r2++) {
      if (onNow && rows[r2].index === i && !rows[r2].rest) { rows[r2].now = true; rows[r2].range = now.range; }
    }
    return rows;
  }

  function shiftRow(r) {
    var cls = 'hrow s-' + S.SHIFT_CLASS[r.shift]
      + (r.mine ? ' mine' : '')
      + (r.rest ? ' restrow' : '')
      + (r.now ? ' now' : '');
    var tag = r.rest ? '休息' : (r.mine ? (r.now ? '我 · 在岗' : '我') : '');
    return '<div class="' + cls + '">' +
      '<div class="hname">' + U.esc(r.team) +
      (tag ? '<span class="htag">' + U.esc(tag) + '</span>' : '') + '</div>' +
      '<div class="hmid">' +
      '<span class="chip ' + S.SHIFT_CLASS[r.shift] + '">' + U.esc(S.SHIFT_NAME[r.shift]) + '</span>' +
      (r.range ? '<span class="htime">' + U.esc(r.range) + '</span>' : '') +
      (r.brief ? '<span class="hsub">' + U.esc(r.brief) + '</span>' : '') +
      '</div></div>';
  }

  function monthTitle(ctx) {
    var h = ctx.handover || S.handover(ctx.date, ctx.teamIndex, ctx.ref);
    if (ctx.onDutyNow && ctx.onDutyNow.index === ctx.teamIndex) {
      return S.SHIFT_NAME[ctx.onDutyNow.shift] + '　' + ctx.onDutyNow.range +
        '　<span class="nowtag">正在上班</span>';
    }
    if (!h.onDuty) return ctx.team.name + '　休息';
    return S.SHIFT_NAME[h.shift] + '　' + h.range;
  }

  /* ==================================================================
   * 4) 总貌图：当月 5 个班组 × 每一天
   * ================================================================== */
  function overview(ctx) {
    var m = ctx.month, i = ctx.teamIndex;
    var mx = S.monthMatrix(m.y, m.m);
    var today = S.todayStr();
    var out = [];

    out.push('<div class="row between mb10">' +
      '<button class="btn sm" data-act="prev-month">‹ 上月</button>' +
      '<b>' + U.monthLabel(m.y, m.m) + '</b>' +
      '<button class="btn sm" data-act="next-month">下月 ›</button>' +
      '</div>');

    var head = '<tr><th class="stickyc">班组</th>';
    for (var d = 1; d <= mx.days; d++) {
      var ds = m.y + '-' + S.pad2(m.m) + '-' + S.pad2(d);
      var wd = '日一二三四五六'.charAt(new Date(Date.UTC(m.y, m.m - 1, d)).getUTCDay());
      head += '<th class="dcol' + (ds === today ? ' istoday' : '') + (ds === ctx.date ? ' issel' : '') + '">' +
        '<span class="dd">' + d + '</span><span class="wd">' + wd + '</span></th>';
    }
    head += '</tr>';

    var body = mx.rows.map(function (row) {
      var tr = '<tr' + (row.index === i ? ' class="mine"' : '') + '>' +
        '<th class="stickyc">' + U.esc(row.short) + (ctx.myTeam === row.index ? '<i class="my">我的</i>' : '') + '</th>';
      for (var k = 0; k < row.cells.length; k++) {
        var c = row.cells[k];
        tr += '<td class="shiftcell ' + c.cls +
          (c.isToday ? ' istoday' : '') + (c.date === ctx.date ? ' issel' : '') + '"' +
          ' data-pick="' + c.date + '"' +
          ' title="' + U.esc(S.TEAMS[row.index] + ' ' + c.date + ' ' + S.SHIFT_NAME[c.shift] + ' ' + S.SHIFT_HOURS[c.shift]) + '">' +
          S.SHIFT_BADGE[c.shift] + (c.isFirst ? '<i class="c1"></i>' : '') + '</td>';
      }
      return tr + '</tr>';
    }).join('');

    out.push('<div class="mxwrap"><table class="mx">' +
      '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>');
    out.push('<div class="legend mt6">' +
      Object.keys(S.SHIFT_NAME).map(function (k) {
        return '<span><i class="lg ' + S.SHIFT_CLASS[k] + '"></i>' + U.esc(S.SHIFT_NAME[k]) + '</span>';
      }).join('') +
      '<span>点格子 = 跳到那天</span></div>');
    return out.join('');
  }

  /* ================================================================== */
  function render(ctx) {
    var i = ctx.teamIndex;
    var out = [];
    out.push('<div class="main-col">');
    out.push(bigDate(ctx));
    out.push(teamPick(ctx));
    out.push(U.card(monthTitle(ctx),
      '<div class="hlist">' + shiftRows(ctx, i).map(shiftRow).join('') + '</div>',
      { rawTitle: true }));
    out.push('</div>');
    out.push('<div class="ov-col">' + overview(ctx) + '</div>');
    return out.join('');
  }

  function mount(el, ctx) {
    /* 事件都由 app.js 在 #view 上统一委托 */
  }

  return { id: 'shift', title: '倒班日历', render: render, mount: mount };
}));
