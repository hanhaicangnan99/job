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
  /** 某一天在岗的三个班（夜→白→中），按班组视角定"我" */
  function dayRows(ctx, d) {
    var now = ctx.onDutyNow;
    // "我"是**我的班组**（myTeam），不是"正在看的那个班组"（ctx.teamIndex）——
    // 切到别人班去看的时候，不能在别人那一行上标"我"。
    // myTeam 为 null 表示还没认过，那就谁都不标。
    var me = ctx.myTeam == null ? null : ctx.myTeam;
    var isTarget = (d === ctx.date);
    var onNow = !!(me != null && isTarget && now && now.index === me);
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

    // 注意：这里**不再**补"我这一天休息"那一行。
    // 时间轴上每天就是当天在岗的三个班（夜→白→中），我那天的班次看
    // 卡片头上写的那一行，或者看值班按钮上的字就够了。
    for (var r2 = 0; r2 < rows.length; r2++) {
      if (onNow && rows[r2].index === me && !rows[r2].rest) { rows[r2].now = true; rows[r2].range = now.range; }
    }
    return rows;
  }

  /**
   * 连续时间轴：一条竖着的清单，从「前几天」一直排到「后几天」，
   * 中间用日期小标签分隔。每一格就是一个班（谁上、几点到几点）。
   *
   * 为什么要这样：夜→白→中 是一个**首尾相连的闭环** ——
   *   中班 18:55 上到次日 02:55 → 夜班 02:55 接上 → 夜班 10:25 交给白班 →
   *   白班 18:55 交给中班 → …
   * 只看"当天三行"是切不出接班关系的（我那行在中间时，上下两头都被切断）。
   * 展开成时间轴后，往下一滚就能看见"谁接我的班"。
   *
   * 为了能"无限滚"，这里画的是 **5 个完整的 10 天周期**（共 50 天）。
   * 10 天一个循环，所以每 10 天的排版完全一样；滚到边界时只要把 scrollTop
   * 平移一个周期的高度，画面看不出任何变化 —— 于是就是无限滚了。
   */
  var CYCLE_COPIES = 5;
  var COPIES_BEFORE = 2;                 // 先画 2 个周期当前面，留出往回滚的余量

  function timeline(ctx) {
    var today = S.todayStr();
    var start = S.addDays(ctx.date, -10 * COPIES_BEFORE);
    var blocks = [];
    for (var n = 0; n < 10 * CYCLE_COPIES; n++) {
      var d = S.addDays(start, n);
      blocks.push({ d: d, segs: dayRows(ctx, d) });
    }

    // 把所有格串成一条竖线：┌ 开头、├ 中间、└ 结尾。
    // 相邻两格就是真实的交接关系（数据层保证 24 小时无缝衔接）——
    // 前一格的下班时刻 = 后一格的上岗时刻，所以"谁接我的班"就是下一格。
    var flat = [];
    for (var b = 0; b < blocks.length; b++) {
      for (var k = 0; k < blocks[b].segs.length; k++) flat.push(blocks[b].segs[k]);
    }
    for (var f = 0; f < flat.length; f++) {
      flat[f].link = (f === 0) ? TL.FIRST : (f === flat.length - 1 ? TL.LAST : TL.MID);
    }

    var out = [], idx = 0;
    for (var b2 = 0; b2 < blocks.length; b2++) {
      var d2 = blocks[b2].d;
      out.push('<div class="daysep' + (d2 === ctx.date ? ' cur' : '') +
        '" data-day="' + d2 + '">' +
        '<span class="dsdate">' + S.mdLabel(d2) + '</span>' +
        '<span class="dswd">' + S.weekday(d2) + '</span>' +
        (d2 === today ? '<span class="dstoday">今天</span>' : '') +
        '</div>');
      for (var k2 = 0; k2 < blocks[b2].segs.length; k2++) out.push(shiftRow(flat[idx++]));
    }
    return out.join('');
  }

  // 让整条时间轴看起来是"一列"
  var TL = { FIRST: '┌', MID: '├', LAST: '└' };

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
    // 时间轴的连接符（data-link）留着给测试和读屏用；
    // 视觉上的"一条链"由 .hlist 左侧那条轨道线画出来（见 styles.css）
    var link = r.link ? ' data-link="' + r.link + '"' : '';
    return '<div class="' + cls + '"' + link + '>' +
      '<div class="hname">' + U.esc(r.team) +
      (tag ? '<span class="htag">' + U.esc(tag) + '</span>' : '') + '</div>' +
      '<div class="hmid">' +
      '<span class="chip ' + S.SHIFT_CLASS[r.shift] + '">' + U.esc(S.SHIFT_NAME[r.shift]) + '</span>' +
      (r.range ? '<span class="htime">' + U.esc(r.range) + '</span>' : '') +
      (r.brief ? '<span class="hsub">' + U.esc(r.brief) + '</span>' : '') +
      '</div></div>';
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
  /* 各块的 id 挂点：滚动时只换这几块，时间轴那一条不动（不然滚动位置会乱跳） */
  function render(ctx) {
    var out = [];
    out.push('<div class="main-col">');
    out.push('<div id="headHost">' + bigDate(ctx) + '</div>');
    out.push('<div id="pickHost">' + teamPick(ctx) + '</div>');
    // 班次卡：不再放"XX今天什么班"那一行（值班按钮上已经写了），
    // 卡片里直接就是可以上下滚的连续时间轴
    out.push('<div class="card tight rows-card">' +
      '<div class="hlist" id="rowsList">' + timeline(ctx) + '</div></div>');
    out.push('</div>');
    out.push('<div class="ov-col" id="ovHost">' + overview(ctx) + '</div>');
    return out.join('');
  }

  function mount(el, ctx) {
    /* 事件都由 app.js 在 #view 上统一委托 */
  }

  return {
    id: 'shift', title: '倒班日历', render: render, mount: mount,
    // 滚动时按需局部刷新用
    parts: {
      bigDate: bigDate, teamPick: teamPick, overview: overview
    }
  };
}));
