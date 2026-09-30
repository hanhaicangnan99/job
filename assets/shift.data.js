/*!
 * shift.data.js — 五班三倒轮转规则（倒班日历 App 的唯一数据源）
 *
 * 经典 script + 全局命名空间，不用 ES module —— 这样单文件离线版在 file:// 下也能跑。
 * 同一个文件用 UMD 包装，Node 里可以 require 进来做自测。
 *
 * ── 规则 ──────────────────────────────────────────────────────────
 *   5 个班组 × 3 个班次，10 天一轮，每 2 天换一次班：
 *       白白休夜休休夜中中休
 *   一值班的第 1 个白班 = 2026-09-23（= 轮转第 1 天）
 *   第 t 值班比一值班晚 2×(t−1) 天开工
 *
 * ── 时段（用户给定） ────────────────────────────────────────────
 *   白 10:25 → 18:55      中 18:55 → 次日 02:55      夜 02:55 → 10:25
 *   三班首尾相接，合计正好 24 小时：
 *     夜班 02:55-10:25 ── 白班 10:25-18:55 ── 中班 18:55-次日 02:55 ── 夜班…
 *   每处交接是 5 分钟重叠（上一班的人 10:25 下班，下一班的人 10:25 已经到岗），
 *   没有完全无人值守的空档。
 *   → 夜班 02:55-10:25 **整个都在当天**，所以按当天归格；
 *     跨零点的是中班，它的收尾会落到第二天的格子里。
 *
 *   ⚠ 与健身 App 的关系：H:\健身\app\assets\data.plan.js 里那份
 *     SHIFT_TIME / 轮转序列是同一套班次。本文件规定轮转，健身 App 的
 *     ANCHOR_D1 = 2026-09-25 恰好是本文件里「二值班」的轮转第 1 天。
 *     shift-tools/selftest.mjs 有一条对齐断言盯着这件事，改坏了一跑就红。
 *
 * ── 班组参数的两个口径（别混用） ────────────────────────────────
 *   idxOf(t)      → 0..4 的下标，**内部/页面一律用这个**
 *   normTeam(t)   → 解析外部输入（网址参数、别人手写的 1..5 或 '二值班'）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Shift = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ==================================================================
   * 一、常量
   * ================================================================== */

  /** 一值班的第一个白班 = 轮转第 1 天 */
  var ANCHOR_TEAM1 = '2026-09-23';

  /** 10 天轮转序列（6 天上班 + 4 天休息） */
  var CYCLE = ['白', '白', '休', '夜', '休', '休', '夜', '中', '中', '休'];

  /** 班组名（下标 0 = 一值班） */
  var TEAMS = ['一值班', '二值班', '三值班', '四值班', '五值班'];
  /** 窄格子用的简称 */
  var TEAM_SHORT = ['一班', '二班', '三班', '四班', '五班'];
  /** 每个班比一值班晚几天开工（5 个班 × 2 天 = 一轮 10 天） */
  var TEAM_OFFSET = [0, 2, 4, 6, 8];

  /** 默认「我的班组」：二值班（由 2026-09-25 这个坐标反推，下标 1） */
  var MY_TEAM = 1;

  /** 班次中文名 / 配色 css 类 / 徽标 */
  var SHIFT_NAME = { '白': '白班', '中': '中班', '夜': '夜班', '休': '休息' };
  var SHIFT_CLASS = { '白': 'day', '中': 'mid', '夜': 'night', '休': 'off' };
  var SHIFT_BADGE = { '白': '白', '中': '中', '夜': '夜', '休': '休' };

  var WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /**
   * 每个班次占的时段，写成 [开始分钟, 结束分钟]，都从**上班那天 00:00** 起算。
   * 结束分钟 > 1440 就是跨了零点（只有中班跨零点）。
   *
   *   白 10:25(625)  → 18:55(1135)              当天内，510 分钟
   *   中 18:55(1135) → 次日 02:55(1615)         跨零点，480 分钟
   *   夜 02:55(175)  → 10:25(625)               当天凌晨到上午，450 分钟
   *
   * 三班合计正好 1440 分钟 = 24 小时 —— 首尾相接，没有无人值守的空档。
   */
  var BLOCKS = {
    '白': [[625, 1135]],
    '中': [[1135, 1615]],
    '夜': [[175, 625]],
    '休': []
  };

  /** 中班在当天 18:55-24:00 的部分：305 分钟 */
  var MID_SAME_DAY = 1440 - 1135;
  /** 中班跨到次日凌晨的部分（00:00-02:55）：175 分钟 */
  var MID_CARRY = 175;

  /** 班次时长（分钟）：白 510 / 中 480 / 夜 450 */
  var LEN = (function () {
    var o = {};
    for (var k in BLOCKS) {
      o[k] = BLOCKS[k].reduce(function (a, b) { return a + (b[1] - b[0]); }, 0);
    }
    return o;
  })();

  /** 文字形式：10:25-18:55 / 18:55-次日02:55 / 02:55-10:25 */
  var SHIFT_HOURS = {
    '白': '10:25-18:55',
    '中': '18:55-次日02:55',
    '夜': '02:55-10:25',
    '休': '—'
  };

  /* ==================================================================
   * 二、日期工具（全部用 UTC 天数运算，避免时区/夏令时把日期算偏一天）
   * ================================================================== */
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function dayNum(s) {
    var p = String(s).split('-');
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function fromDayNum(n) {
    var d = new Date(n * 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function addDays(s, n) { return fromDayNum(dayNum(s) + n); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function isValidDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
    var p = String(s).split('-');
    if (+p[1] < 1 || +p[1] > 12) return false;
    if (+p[2] < 1 || +p[2] > 31) return false;
    return fromDayNum(dayNum(s)) === String(s);
  }
  function weekday(s) {
    var p = String(s).split('-');
    return WEEKDAY[new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay()];
  }
  /** 'YYYY-MM-DD' → '9月23日' */
  function mdLabel(s) { var p = String(s).split('-'); return (+p[1]) + '月' + (+p[2]) + '日'; }
  /** 某月天数 */
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  /**
   * 分钟 → 'HH:MM'。
   * 允许 >=1440（跨零点用，例如中班次日 02:55 = 1675）：先减 1440 再格式化，
   * 这样 hhmm(1675) = '02:55'（不是 '03:55'）。
   */
  function hhmm(min) {
    var v = Math.round(min);
    while (v < 0) v += 1440;
    while (v >= 1440) v -= 1440;
    return pad2(Math.floor(v / 60)) + ':' + pad2(v % 60);
  }
  function mod10(n) { return ((n % 10) + 10) % 10; }
  /** 保留 1 位小数，去掉多余的 .0 */
  function h1(v) {
    return (Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, '');
  }

  /* ==================================================================
   * 三、班组
   * ================================================================== */

  /** 相对锚点的天数（可为负） */
  function cycleIndex(dateStr) { return daysBetween(ANCHOR_TEAM1, dateStr); }

  /**
   * 某一天正好是哪个班的轮转第 1 天（下标 0..4）。
   * 每个班每 2 天推进一格，5 个班 = 10 天一循环，正好等于轮转序列长度。
   */
  function teamIndexOf(dateStr) { return mod10(Math.floor(cycleIndex(dateStr) / 2)) % 5; }

  /**
   * 班组**下标** 0..4。
   * 内部一律用下标：0..4 原样返回；其它数字按 1 起算（1 = 一值班）并回绕。
   * ⚠ 不要用它去夹 TEAM_OFFSET 里的值（那里是 0..9 的天数偏移，不是下标）。
   */
  function idxOf(t) {
    var n = Math.round(+t);
    if (!isFinite(n)) return 0;
    if (n >= 0 && n <= 4) return n;
    if (n >= 1 && n <= 5) return n - 1;
    return ((n - 1) % 5 + 5) % 5;
  }

  /**
   * 外部输入（网址参数、别人手写的数字或班名）→ 班组下标 0..4。
   *   数字 1..5 按「第几班」理解（1 = 一值班）；数字 0 = 一值班
   *   'A'..'E'、'一值班'..'五值班'、'一班'..'五班' 都能认
   * ⚠ 页面内部传值用 idxOf()，不要用这个 —— 这里的 1 会被理解成二值班
   */
  function normTeam(v) {
    var i;
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && isFinite(v)) {
      var n = Math.round(v);
      if (n >= 1 && n <= 5) return n - 1;         // 1..5 = 第几班
      if (n === 0) return 0;                      // 0 = 一值班
      return ((n - 1) % 5 + 5) % 5;
    }
    var s = String(v).trim();
    if (/^\d+$/.test(s)) return normTeam(parseInt(s, 10));
    if (/^[A-Ea-e]$/.test(s)) return s.toUpperCase().charCodeAt(0) - 65;
    for (i = 0; i < TEAMS.length; i++) if (s === TEAMS[i]) return i;
    for (i = 0; i < TEAM_SHORT.length; i++) if (s === TEAM_SHORT[i]) return i;
    if (s.indexOf('一') === 0) return 0;
    if (s.indexOf('二') === 0) return 1;
    if (s.indexOf('三') === 0) return 2;
    if (s.indexOf('四') === 0) return 3;
    if (s.indexOf('五') === 0) return 4;
    return 0;
  }

  /**
   * 班组下标 0..4 → 面向 UI 的对象
   * @param {number} index 0..4（0 = 一值班）
   */
  function team(index) {
    var i = idxOf(index);
    return {
      index: i, idx: 'ABCDE'.charAt(i), no: i + 1,
      name: TEAMS[i], short: TEAM_SHORT[i],
      phaseAnchor: addDays(ANCHOR_TEAM1, TEAM_OFFSET[i])
    };
  }

  /** 该日期是哪个班的轮转第 1 天（不是「谁在上班」） */
  function teamOf(dateStr) { return team(teamIndexOf(dateStr)); }

  /**
   * 第 t 班（下标 0..4）在 dateStr 的轮转日序号 1..10。
   * 第 t 班比一值班晚开工 TEAM_OFFSET[t] 天，所以它的轮转序号落后这么多天。
   */
  function dayIndexOf(dateStr, t) {
    return mod10(cycleIndex(dateStr) - TEAM_OFFSET[idxOf(t)]) + 1;
  }

  /** 第 t 班在 dateStr 上什么班 */
  function shiftOf(dateStr, t) { return CYCLE[dayIndexOf(dateStr, t) - 1]; }

  /** 轮转第 n 天上的班次（1..10，越界自动回绕） */
  function shiftAtDayIndex(n) { return CYCLE[mod10(Math.round(n) - 1)]; }

  /* ==================================================================
   * 四、时段
   * ================================================================== */

  /**
   * 当天该显示的三个时段（用户要求「夜班两格都标出来」）：
   *   yesterday 前一天留下的收尾（中班跨零点 → 当天早上 02:55 下班）
   *   today     当天上班的那一段
   *   tomorrow  明天才上班（凌晨开工的那种，前一天的格子要提示一句）
   *
   * 每个字段都是 { kind, shift, shiftName, cls, at, atText, label } 或 null
   */
  function blocksOn(dateStr, t) {
    var i = idxOf(t);
    var n = addDays(dateStr, 1);
    var sy = shiftOf(addDays(dateStr, -1), i), st = shiftOf(dateStr, i), sn = shiftOf(n, i);

    var out = { yesterday: null, today: null, tomorrow: null, myShift: st };

    // 前一天那个班如果跨过了零点，就在**当天早上**下班（只有中班）
    if (LEN[sy]) {
      var endMin = BLOCKS[sy][0][1];
      if (endMin > 1440) {
        out.yesterday = {
          kind: 'end', shift: sy, shiftName: SHIFT_NAME[sy], cls: SHIFT_CLASS[sy],
          at: endMin - 1440, atText: hhmm(endMin - 1440),
          label: SHIFT_NAME[sy] + ' ' + hhmm(endMin - 1440) + ' 下班'
        };
      }
    }

    // 当天上班的那一段
    if (LEN[st]) {
      var startMin = BLOCKS[st][0][0];
      var end2 = BLOCKS[st][0][1];
      out.today = {
        kind: 'start', shift: st, shiftName: SHIFT_NAME[st], cls: SHIFT_CLASS[st],
        at: startMin, atText: hhmm(startMin), startText: hhmm(startMin),
        endText: end2 > 1440 ? ('次日 ' + hhmm(end2)) : hhmm(end2),
        hours: SHIFT_HOURS[st],
        label: SHIFT_NAME[st] + ' ' + hhmm(startMin) + ' 上班，' +
          (end2 > 1440 ? '次日 ' + hhmm(end2) : hhmm(end2)) + ' 下班'
      };
    }

    // 明天的班从凌晨开工 → 今天的格子提示一句「明 02:55 上班」
    if (LEN[sn] && BLOCKS[sn][0][0] < BLOCKS['白'][0][0]) {
      out.tomorrow = {
        kind: 'start', shift: sn, shiftName: SHIFT_NAME[sn], cls: SHIFT_CLASS[sn],
        at: BLOCKS[sn][0][0], atText: hhmm(BLOCKS[sn][0][0]),
        label: '明天（' + mdLabel(n) + '）' + SHIFT_NAME[sn] + ' ' + hhmm(BLOCKS[sn][0][0]) + ' 上班'
      };
    }
    return out;
  }

  /**
   * 当天（00:00-24:00 之内）实际上班多少分钟。
   *   白 10:25-18:55   → 510
   *   中 18:55-次日02:55 → 当天只算 18:55-24:00 = 305，剩下 175 分落到第二天
   *   夜 02:55-10:25   → 450（整段都在当天）
   */
  function workMinutesOn(dateStr, t) {
    var st = shiftOf(dateStr, t);
    var mins = 0;
    for (var k = 0; k < BLOCKS[st].length; k++) {
      // 区间以「上班那天 00:00」为原点，和当天 [0,1440] 求交
      var lo = Math.max(0, BLOCKS[st][k][0]);       // 起点在当天之前的部分不算
      var hi = Math.min(1440, BLOCKS[st][k][1]);    // 跨过 24:00 的部分算给第二天
      if (hi > lo) mins += hi - lo;
    }
    return mins;
  }

  /** 班次时段文字：'10:25-18:55' 等 */
  function hoursOf(dateStr, t) { return SHIFT_HOURS[shiftOf(dateStr, t)]; }

  /**
   * 从 dateStr 起（含当天）往后找第一个上班日
   * @returns {{date,shift,hours,daysUntil,cls}|null}
   */
  function nextWork(dateStr, t, limit) {
    var i = idxOf(t);
    var max = limit > 0 ? limit : 400;
    for (var k = 0; k <= max; k++) {
      var d = addDays(dateStr, k);
      var s = shiftOf(d, i);
      if (LEN[s]) {
        return { date: d, shift: s, hours: SHIFT_HOURS[s], daysUntil: k, cls: SHIFT_CLASS[s] };
      }
    }
    return null;
  }

  /** 从 dateStr 起（含当天）往后找第一个休息日 */
  function nextRest(dateStr, t, limit) {
    var i = idxOf(t);
    var max = limit > 0 ? limit : 400;
    for (var k = 0; k <= max; k++) {
      var d = addDays(dateStr, k);
      if (!LEN[shiftOf(d, i)]) return { date: d, daysUntil: k };
    }
    return null;
  }

  /** 某天某班在岗时占的时间段（相对那天 00:00 的分钟；休息日返回 null） */
  function spanOf(dateStr, t) {
    var sh = shiftOf(dateStr, t);
    if (!LEN[sh]) return null;
    return { start: BLOCKS[sh][0][0], end: BLOCKS[sh][0][1] };
  }

  /**
   * 指定日期、指定班组眼中的「本日一览」——按时间轴排好序的一列。
   * 一行 = 一个班组的一段连续在岗时间，字段：
   *   { index, team, short, shift, start, end, carry, mine, range }
   *     start/end 相对当天 00:00 的分钟；end > 1440 表示跨到次日凌晨
   *     carry = true 表示这是前一天那个班留下来的尾巴（当天凌晨还在岗）
   *
   * 例：二值班 2026-09-30 的视角 →
   *   白班(我) 625-1135 ／ 中班 1135-1615
   *   再加「三值班 夜班 175-625」这一行 —— 它就是当天凌晨接给我的人
   */
  /**
   * 某一天的区间集合，相对该天 00:00 的分钟：
   *   负值 = 前一天那个班留下来的尾巴；>1440 = 跨到次日凌晨的
   * 传了 ref（**绝对分钟**，= dayNum(某天)*1440 + 当天分钟）就按那一刻倒推：
   *   现在在岗的那一段标 nowSeg；在它之前的标 carry（已经过去的）；之后的标 nextDay。
   * 不传 ref 时：行为与「只看日期」的口径一致。
   */
  function daySegments(dateStr, ref) {
    var segs = [];
    var c, sp;
    for (c = 0; c < 5; c++) {
      sp = spanOf(dateStr, c);
      if (!sp) continue;
      segs.push({ index: c, team: TEAMS[c], short: TEAM_SHORT[c], shift: shiftOf(dateStr, c),
        s: sp.start, e: sp.end, carry: false, nextDay: false });
    }
    var py = addDays(dateStr, -1);
    for (c = 0; c < 5; c++) {
      if (spanOf(dateStr, c)) continue;              // 当天自己有班的上面已经列过
      var psp = spanOf(py, c);
      if (psp && psp.end > 1440) {
        segs.push({ index: c, team: TEAMS[c], short: TEAM_SHORT[c], shift: shiftOf(py, c),
          s: psp.end - 1440 - (psp.end - psp.start), e: psp.end - 1440, carry: true, nextDay: false });
      }
    }
    var nx = addDays(dateStr, 1);
    for (c = 0; c < 5; c++) {
      var nsp = spanOf(nx, c);
      if (!nsp) continue;
      segs.push({ index: c, team: TEAMS[c], short: TEAM_SHORT[c], shift: shiftOf(nx, c),
        s: nsp.start + 1440, e: nsp.end + 1440, carry: false, nextDay: true });
    }

    // 相对显示：以「这一行所属的那个日历日」为原点折算分钟
    //   白班/夜班 → 0..1440；中班 → 起于 18:55，结束 1615（渲染成「次日 02:55」）
    //   前一天留下的尾巴 → 负值（渲染成「-02:55」，表示当天凌晨那一段）
    for (var kk = 0; kk < segs.length; kk++) {
      var b = Math.floor(segs[kk].s / 1440) * 1440;
      segs[kk].start = segs[kk].s - b;
      segs[kk].end = segs[kk].e - b;
    }

    if (ref != null && isFinite(ref)) {
      // 实时口径：ref 落在哪一段里，那一段就是「现在」；它前面的是过去、后面的是将来
      var now = null;
      for (var j = 0; j < segs.length; j++) {
        if (segs[j].s <= ref && ref < segs[j].e) { now = segs[j]; break; }
      }
      if (now) {
        for (var m2 = 0; m2 < segs.length; m2++) {
          segs[m2].carry = segs[m2].e <= now.s;
          segs[m2].nowSeg = segs[m2] === now;
          segs[m2].nextDay = segs[m2].s >= now.e;
        }
      }
    }
    segs.sort(function (a, b2) { return a.s - b2.s; });
    return segs;
  }

  /**
   * 指定日期（可选：指定时刻）下的「本日在岗一览」，按时间先后排好。
   * 一行 = 一个班组的一段连续在岗时间。
   * 传了 ref（绝对分钟）就按那一刻倒推，用于「现在的交班关系」。
   */
  function dayRoster(dateStr, t, ref) {
    var i = idxOf(t);
    var segs = daySegments(dateStr, ref);
    var rows = [];
    for (var k = 0; k < segs.length; k++) {
      var g = segs[k];
      var row = {
        index: g.index, team: g.team, short: g.short, shift: g.shift,
        start: g.start, end: g.end, s: g.s, e: g.e,
        carry: !!g.carry, nextDay: !!g.nextDay, nowSeg: !!g.nowSeg, mine: g.index === i
      };
      row.range = mmRange(row.start, row.end);
      rows.push(row);
    }
    return rows;
  }

  /** 分钟区间 → '10:25-18:55' / '18:55-次日02:55' */
  function mmRange(a, b) {
    return hhmm(a) + '-' + (b > 1440 ? '次日' + hhmm(b) : hhmm(b));
  }

  /** 现在的绝对分钟（= dayNum(今天)*1440 + 当天分钟），用于实时交班口径 */
  function nowRef() {
    var d = new Date();
    return dayNum(todayStr()) * 1440 + d.getHours() * 60 + d.getMinutes();
  }

  /** 某个日期在「现在」这一刻已经过去了 / 还没到 */
  function isPastDay(dateStr, ref) {
    var r = (ref == null) ? nowRef() : ref;
    return (dayNum(dateStr) + 1) * 1440 <= r;
  }
  function isFutureDay(dateStr, ref) {
    var r = (ref == null) ? nowRef() : ref;
    return dayNum(dateStr) * 1440 > r;
  }

  /**
   * 交班关系 —— 界面顺序：接班的在上、自己的在中间、交班给谁在下。
   *
   * 口径（按**时间轴**，不是按轮转序号，所以夜班/白班互相接这种跨格子的情况也对）：
   *   接班 arrives = 我上班那一刻把他手上的班交给我的人
   *   交班 leaves  = 我下班那一刻从我手上接过去的人
   *
   * 例：二值班 2026-09-26 白班（10:25-18:55）
   *     接班 = 一值班 夜班（02:55-10:25，10:25 交给我）
   *     交班 = 四值班 中班（18:55-次日 02:55，18:55 从我手上接过去）
   *
   * 例：二值班 2026-09-28 夜班（02:55-10:25）
   *     接班 = 四值班 中班（9/27 晚上上的，当天 02:55 下班交给我）
   *     交班 = 三值班 白班（10:25 从我手上接过去）
   *
   * 休息日：上面显示「我上一个班交班给了谁」，下面显示「我下一个班从谁手里接班」。
   *
   * @param {string} dateStr 日期
   * @param {number} t 班组
   * @param {number} [ref] 可选：参考时刻（绝对分钟 = dayNum(某天)*1440 + 当天分钟）。
   *        传了它就是**实时口径** —— 「我现在在哪个班上」决定上面一行（接班）和下面一行（交班），
   *        和「这一天排的是哪个班」无关。不传就按日期口径（早上/晚上分别看）。
   */
  function handover(dateStr, t, ref) {
    var i = idxOf(t);
    var sh = shiftOf(dateStr, i);
    var out = {
      index: i, team: TEAMS[i], short: TEAM_SHORT[i], shift: sh, range: SHIFT_HOURS[sh],
      onDuty: !!LEN[sh], arrives: null, leaves: null,
      basis: LEN[sh] ? 'shift' : 'rest', nextWork: null, prevWork: null
    };
    var k;

    if (LEN[sh]) {
      // 全部在岗区段换成「紧贴当天的绝对分钟」；传了 ref 就是实时口径
      var segs = daySegments(dateStr, ref);
      var me = null;
      for (k = 0; k < segs.length; k++) {
        if (segs[k].index === i) {
          if (!segs[k].carry && !segs[k].nextDay) { me = segs[k]; break; }
          if (!me) me = segs[k];
        }
      }
      if (ref != null && isFinite(ref)) {
        for (k = 0; k < segs.length; k++) {
          if (segs[k].s <= ref && ref < segs[k].e) { me = segs[k]; break; }
        }
      }
      if (!me) me = { index: i, s: BLOCKS[sh][0][0], e: BLOCKS[sh][0][1] };
      out.range = mmRange(me.start != null ? me.start : me.s, me.end != null ? me.end : me.e);

      // 接班：结束时刻 == 我的开始时刻 的那个人
      for (k = 0; k < segs.length; k++) {
        if (segs[k].index === i || segs[k].nextDay) continue;
        if (segs[k].e === me.s) { out.arrives = segs[k]; break; }
      }
      // 交班：开始时刻 == 我的结束时刻 的那个人（可能是次日凌晨才上班的夜班）
      for (k = 0; k < segs.length; k++) {
        if (segs[k].index === i || segs[k].carry) continue;
        if (segs[k].s === me.e) { out.leaves = segs[k]; break; }
      }
    } else {
      // 休息日：上一个班的交班对象 + 下一个班的接班对象
      for (var b = 1; b <= 11; b++) {
        var pd = addDays(dateStr, -b);
        if (LEN[shiftOf(pd, i)]) {
          out.prevWork = { date: pd };
          var ph = handover(pd, i, ref);
          out.arrives = ph.leaves;
          if (out.arrives) out.arrives.onDate = pd;
          break;
        }
      }
      var nxw = nextWork(dateStr, i);
      out.nextWork = nxw;
      if (nxw && nxw.daysUntil > 0) {
        var nh = handover(nxw.date, i, ref);
        out.leaves = nh.arrives;
        if (out.leaves) out.leaves.onDate = nxw.date;
      }
    }
    return out;
  }

  /* ==================================================================
   * 五、月份总貌 / 统计
   * ================================================================== */

  /**
   * 当月总貌矩阵：5 个班 × 当月每一天
   * @returns {{year,month,days,today,rows:[{index,name,short,cells:[...]}]}}
   */
  function monthMatrix(year, month) {
    var y = Math.round(+year), m = Math.round(+month);
    if (!isFinite(y)) y = 2000;
    if (!(m >= 1 && m <= 12)) m = 1;
    var days = daysInMonth(y, m);
    var today = todayStr();
    var rows = [];
    for (var i = 0; i < 5; i++) {
      var cells = [];
      for (var d = 1; d <= days; d++) {
        var ds = y + '-' + pad2(m) + '-' + pad2(d);
        var st = shiftOf(ds, i);
        cells.push({
          date: ds, day: d, shift: st, cls: SHIFT_CLASS[st],
          isToday: ds === today,
          isFirst: dayIndexOf(ds, i) === 1,
          works: !!LEN[st]
        });
      }
      rows.push({ index: i, name: TEAMS[i], short: TEAM_SHORT[i], cells: cells });
    }
    return { year: y, month: m, days: days, today: today, rows: rows };
  }

  /**
   * 当月某班的统计。
   *   byDay  按「班次记在开始那天」逐日列出，minutes 是**当天这个日历日**在岗的分钟
   *   prevCarry 上个月最后一天的中班拖到本月凌晨的那一段（本月实际也在上班）
   *   nextCarry 本月最后一天的中班拖到下个月凌晨的那一段
   *   总工时 = 本月日历日内的实际在岗工时（= 本月全部班次时长 − nextCarry + prevCarry）
   */
  function monthStats(year, month, t) {
    var i = idxOf(t);
    var y = Math.round(+year), m = Math.round(+month);
    if (!isFinite(y)) y = 2000;
    if (!(m >= 1 && m <= 12)) m = 1;
    var days = daysInMonth(y, m);
    var count = { '白': 0, '中': 0, '夜': 0, '休': 0 };
    var mins = 0;
    var byDay = [];
    for (var d = 1; d <= days; d++) {
      var ds = y + '-' + pad2(m) + '-' + pad2(d);
      var st = shiftOf(ds, i);
      count[st]++;
      var md = workMinutesOn(ds, i);
      mins += md;
      byDay.push({ date: ds, day: d, shift: st, minutes: md, cls: SHIFT_CLASS[st] });
    }
    // 上个月最后一天的中班 → 本月 1 号凌晨那一段
    var ym = m === 1 ? (y - 1) : y, mm = m === 1 ? 12 : (m - 1);
    var lastDs = ym + '-' + pad2(mm) + '-' + pad2(daysInMonth(ym, mm));
    var lastShift = shiftOf(lastDs, i);
    var prevCarry = (lastShift === '中') ? MID_CARRY : 0;
    // 本月最后一天的中班 → 下个月 1 号凌晨那一段
    var endDs = y + '-' + pad2(m) + '-' + pad2(days);
    var nextCarry = (shiftOf(endDs, i) === '中') ? MID_CARRY : 0;

    return {
      index: i, name: TEAMS[i], year: y, month: m, days: days,
      '白': count['白'], '中': count['中'], '夜': count['夜'], '休': count['休'],
      上班天数: count['白'] + count['中'] + count['夜'],
      休息天数: count['休'],
      prevCarry: prevCarry, nextCarry: nextCarry,
      总工时: Math.round((mins + prevCarry) / 6) / 10,
      byDay: byDay
    };
  }

  /* ==================================================================
   * 六、导出
   * ================================================================== */
  return {
    ANCHOR_TEAM1: ANCHOR_TEAM1, CYCLE: CYCLE, TEAMS: TEAMS, TEAM_SHORT: TEAM_SHORT,
    TEAM_OFFSET: TEAM_OFFSET, MY_TEAM: MY_TEAM,
    SHIFT_NAME: SHIFT_NAME, SHIFT_CLASS: SHIFT_CLASS, SHIFT_BADGE: SHIFT_BADGE,
    SHIFT_HOURS: SHIFT_HOURS, BLOCKS: BLOCKS, LEN: LEN, WEEKDAY: WEEKDAY,
    MID_SAME_DAY: MID_SAME_DAY, MID_CARRY: MID_CARRY,

    pad2: pad2, dayNum: dayNum, fromDayNum: fromDayNum, todayStr: todayStr,
    addDays: addDays, daysBetween: daysBetween, isValidDate: isValidDate,
    weekday: weekday, mdLabel: mdLabel, daysInMonth: daysInMonth, hhmm: hhmm, h1: h1,

    cycleIndex: cycleIndex, teamIndexOf: teamIndexOf, teamOf: teamOf, team: team,
    idxOf: idxOf, normTeam: normTeam,
    dayIndexOf: dayIndexOf, shiftOf: shiftOf, shiftAtDayIndex: shiftAtDayIndex,
    blocksOn: blocksOn, workMinutesOn: workMinutesOn, hoursOf: hoursOf,
    nextWork: nextWork, nextRest: nextRest,
    spanOf: spanOf, dayRoster: dayRoster, mmRange: mmRange,
    daySegments: daySegments, handover: handover, nowRef: nowRef,
    isPastDay: isPastDay, isFutureDay: isFutureDay,
    monthMatrix: monthMatrix, monthStats: monthStats
  };
}));
