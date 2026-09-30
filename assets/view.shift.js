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
   * 1) 大日期（点日期打开月历；右边一个「今天」）
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
      '<button class="navbtn" data-act="today" aria-label="回到今天" title="回到今天">今</button>' +
      '<button class="navbtn" data-d="1" aria-label="后一天">›</button>' +
      '</div>';
  }

  /* ==================================================================
   * 2) 班组选择器：1值班～5值班，点一下就切。
   *    右上角那个「我的」小标已经拿掉 —— 那一行是横向滚动容器，负偏移的标会被裁一半；
   *    右边那个「我的」按钮也拿掉了，这一栏只留 1～5值班。
   *    要看自己那个班被重点标出来的话，长按某个值班按钮认一下就行（可选，不按就没有"我"）。
   * ================================================================== */
  function teamPick(ctx) {
    var d = ctx.date;
    var mine = ctx.myTeam;                    // null = 没认过
    return '<div class="teamrow"><div class="teampick">' +
      S.TEAMS.map(function (name, i) {
        var sh = S.shiftOf(d, i);
        var isMe = i === mine;
        return '<button type="button" data-team="' + i + '"' +
          (i === ctx.teamIndex ? ' class="on"' : '') +
          (isMe ? ' data-me="1"' : '') +
          ' title="' + U.esc(name + (isMe ? '（我的班组）' : '') + ' · 长按认作我的班组') + '">' +
          '<b>' + U.esc(name) + '</b>' +
          '<span class="ic ' + S.SHIFT_CLASS[sh] + '">' + U.esc(S.SHIFT_BADGE[sh]) + '</span>' +
          '</button>';
      }).join('') +
      '</div></div>';
  }

  /* ==================================================================
   * 3) 本日一览：固定 夜班 → 白班 → 中班
   * ================================================================== */
  function shiftRows(ctx, i) {
    var d = ctx.date;
    var now = ctx.onDutyNow;
    // "我"是**我的班组**（myTeam），不是"正在看的那个班组"（i）——
    // 切到别人班去看的时候，不能在别人那一行上标"我"。
    // myTeam 为 null 表示还没认过，那就谁都不标。
    var me = ctx.myTeam == null ? null : ctx.myTeam;
    var onNow = !!(me != null && now && now.index === me);
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
        mine: me != null && who === me
      });
    }

    // 我这一天休息 → 最后永远补一行"我的休息"。
    // 不管当前在看哪个班组都要补：正看别人班时，"我"也是当天在岗的三个班之一，
    // 只不过我这一格是"休息"，把它单独列出来才看得见（放在最后一行）。
    // 这一行长得跟"我上班"那行一样（蓝框加粗），但右边徽章是绿的「休息」、
    // 左侧颜色条是休息色，所以不会跟"我在上班"混淆。
    if (me != null) {
      var hasMine = false;
      for (var q = 0; q < rows.length; q++) if (rows[q].mine) hasMine = true;
      if (!hasMine) {
        rows.push({
          shift: '休', index: me, team: S.team(me).name, range: '', mine: true, rest: true
        });
      }
    }

    for (var r2 = 0; r2 < rows.length; r2++) {
      if (onNow && rows[r2].index === me && !rows[r2].rest) { rows[r2].now = true; rows[r2].range = now.range; }
    }
    return rows;
  }

  function shiftRow(r) {
    var cls = 'hrow s-' + S.SHIFT_CLASS[r.shift]
      + (r.mine ? ' mine' : '')
      + (r.rest ? ' restrow' : '')
      + (r.now ? ' now' : '');
    // 「我」的标：
    //   我上班 → 「我」（在岗时是「我 · 在岗」）
    //   我休息 → 「我 · 休」，并且这一行带 restrow 样式（灰底 + 左侧灰条 + 绿色徽章），
    //            这样"我在休息"跟"我在上班"一眼分得开，不会看成正在看的那个班在上班
    var tag = '';
    if (r.mine) tag = r.rest ? '我 · 休' : (r.now ? '我 · 在岗' : '我');
    return '<div class="' + cls + '">' +
      '<div class="hname">' + U.esc(r.team) +
      (tag ? '<span class="htag">' + U.esc(tag) + '</span>' : '') + '</div>' +
      '<div class="hmid">' +
      '<span class="chip ' + S.SHIFT_CLASS[r.shift] + '">' + U.esc(S.SHIFT_NAME[r.shift]) + '</span>' +
      (r.range ? '<span class="htime">' + U.esc(r.range) + '</span>' : '') +
      (r.brief ? '<span class="hsub">' + U.esc(r.brief) + '</span>' : '') +
      '</div></div>';
  }

  /**
   * 卡片头上那一行：**正在看的这个班组，这天到底上什么班**。
   * 三行是按班次排的（夜/白/中），所以当这个班休息时，三行里根本没有它 ——
   * 光看那三行看不出"他现在是什么班"，这一行就是回答这个问题的。
   */
  function teamToday(ctx) {
    var name = ctx.team.name;
    var h = ctx.handover || S.handover(ctx.date, ctx.teamIndex, ctx.ref);
    var onNow = ctx.onDutyNow && ctx.onDutyNow.index === ctx.teamIndex;
    var cls, label, time = '';

    if (h.onDuty) {
      cls = S.SHIFT_CLASS[h.shift];
      label = S.SHIFT_NAME[h.shift];
      time = h.range || S.mmRange(h.start, h.end);
    } else {
      // 休息。可能是"昨晚的中班还没下"或"今天的夜班已经下了"，那也算今天在岗过
      var py = S.addDays(ctx.date, -1);
      var carried = S.shiftOf(py, ctx.teamIndex);
      if (carried === '中') {
        cls = S.SHIFT_CLASS['中']; label = '中班'; time = '上到次日 02:55';
      } else if (S.shiftOf(ctx.date, ctx.teamIndex) === '夜') {
        cls = S.SHIFT_CLASS['夜']; label = '夜班'; time = '02:55-10:25';
      } else {
        cls = S.SHIFT_CLASS['休']; label = '休息';
      }
    }

    return '<div class="teamhead">' +
      '<b>' + U.esc(name) + '</b>' +
      '<span class="chip ' + cls + '">' + U.esc(label) + '</span>' +
      (time ? '<span class="htime">' + U.esc(time) + '</span>' : '') +
      (onNow ? '<span class="nowtag">正在上班</span>' : '') +
      '</div>';
  }

  /* ==================================================================
   * 4) 总貌图：当月 5 个班组 × 每一天
   * ================================================================== */
  function overview(ctx) {
    var m = ctx.month, i = ctx.teamIndex;
    var mx = S.monthMatrix(m.y, m.m);
    var today = S.todayStr();
    var out = [];

    out.push('<div class="row between mb6">' +
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
        '<th class="stickyc">' + U.esc(row.short) + '</th>';
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
    return out.join('');
  }

  /* ================================================================== */
  function render(ctx) {
    var i = ctx.teamIndex;
    var out = [];
    out.push('<div class="main-col">');
    out.push(bigDate(ctx));
    out.push(teamPick(ctx));
    // 班次卡：头上写明"正在看的这个班组今天什么班"，下面 夜/白/中 三行（我休息时多一行）
    out.push('<div class="card tight rows-card">' + teamToday(ctx) +
      '<div class="hlist">' + shiftRows(ctx, i).map(shiftRow).join('') + '</div></div>');
    out.push('</div>');
    out.push('<div class="ov-col">' + overview(ctx) + '</div>');
    return out.join('');
  }

  function mount(el, ctx) {
    /* 事件都由 app.js 在 #view 上统一委托 */
  }

  return { id: 'shift', title: '倒班日历', render: render, mount: mount };
}));
