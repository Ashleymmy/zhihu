/* TIMO Web Demo — 模拟数据层
 * 所有数字由固定种子生成，并按已确认的计酬规则推算：
 *   任务收益 → 执行人；团队管理收益 → 业绩日当天的团长；邀请收益 → 直接邀请人（仅一级，180 天有效）
 *   邀请人即团长时不叠加；独立达人的团队差价、过期/失效的邀请收益记为平台留存。
 */
(function () {
  'use strict';

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var R = mulberry(20261019);
  function ri(a, b) { return a + Math.floor(R() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(R() * arr.length)]; }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ds(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ds(d); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function r2(v) { return Math.round(v * 100) / 100; }

  var TODAY = '2026-10-19';
  var DAYS = 90;
  var dates = [];
  for (var i = DAYS - 1; i >= 0; i--) dates.push(addDays(TODAY, -i));
  var PENDING_FROM = addDays(TODAY, -13); // 最近两周账单未确认 → 收益「待确认」

  /* ---------- 项目（渠道） ---------- */
  var projects = [
    { id: 'zhihu', name: '知乎推文', short: '知乎', color: '#3D5AFE', metric: '拉新', unit: '单', up: 3.0, creator: 2.0, leader: 0.3, referral: 0.1, status: '运行中', since: '2026-03-01', base: 6, sync: '3 分钟前' },
    { id: 'hongguo', name: '红果短剧推荐', short: '红果', color: '#FF6B4A', metric: '有效观看', unit: '次', up: 1.2, creator: 0.8, leader: 0.12, referral: 0.04, status: '运行中', since: '2026-07-10', base: 22, sync: '11 分钟前' },
    { id: 'pan', name: '网盘拉新', short: '网盘', color: '#14B8A6', metric: '拉新', unit: '人', up: 4.5, creator: 3.0, leader: 0.45, referral: 0.15, status: '灰度中', since: '2026-09-01', base: 3, sync: '1 小时前' }
  ];
  var P = {};
  projects.forEach(function (p) { P[p.id] = p; });
  P.platform = { id: 'platform', name: '平台运营奖励', short: '平台', color: '#8B5CF6' };

  /* ---------- 成员 ---------- */
  var SUR = '林苏陈许周顾沈江何叶唐宋陆韩秦温白程方袁乔孟谢夏邵'.split('');
  var GIV = ['小满', '一诺', '知夏', '书言', '星野', '若溪', '南乔', '子衿', '清和', '予安', '听澜', '未央', '念念', '嘉树', '沐阳', '晚晴', '景行', '安然', '思源', '一舟', '亦可', '初九', '长歌', '半夏', '云起', '见山', '时雨', '青禾', '望舒', '星河', '鹿鸣', '知意', '乐游', '岁宁'];
  var used = {};
  function newName() { for (;;) { var n = pick(SUR) + pick(GIV); if (!used[n]) return n; } }

  var users = [], byId = {}, seq = 1000;
  var memberships = [], roleHist = [];

  function mk(o) {
    o.id = o.id || ('u' + (++seq));
    o.status = o.status || 'active';
    o.phone = '1' + ri(30, 89) + '****' + pad(ri(0, 99)) + pad(ri(0, 99));
    o.hue = ri(0, 359);
    o.skill = o.skill || (0.35 + R() * 1.4);
    o.act = o.act || (0.35 + R() * 0.5);
    o.qual = o.qual || (0.8 + R() * 0.19);
    o.projects = o.projects || { zhihu: R() < 0.92, hongguo: R() < 0.55, pan: R() < 0.4 };
    users.push(o); byId[o.id] = o; used[o.name] = 1;
    return o;
  }
  function join(u, leaderId, from, reason) {
    memberships.push({ userId: u.id, leaderId: leaderId, from: from, to: null, reason: reason });
    u.leaderId = leaderId;
  }
  function minDate(a, b) { return a < b ? a : b; }

  // 员工
  mk({ id: 's1', name: '周屿', role: 'admin', duty: 'all', joinDate: '2026-01-05', staff: true, title: '超级管理员' });
  mk({ id: 's2', name: '陈墨', role: 'operator', duty: 'operations', joinDate: '2026-01-12', staff: true, title: '运营管理' });
  mk({ id: 's3', name: '许晴', role: 'admin', duty: 'finance', joinDate: '2026-02-01', staff: true, title: '财务管理' });
  mk({ id: 's4', name: '顾言', role: 'developer', duty: 'all', joinDate: '2026-01-05', staff: true, title: '开发者' });

  function addCreator(inviterId, leaderId, minAgo, maxAgo, extra) {
    var jd = addDays(TODAY, -ri(minAgo, maxAgo));
    if (inviterId && byId[inviterId].joinDate >= jd) jd = minDate(addDays(byId[inviterId].joinDate, ri(3, 25)), addDays(TODAY, -1));
    var o = { name: newName(), role: 'creator', inviterId: inviterId, joinDate: jd };
    if (extra) for (var k in extra) o[k] = extra[k];
    var u = mk(o);
    join(u, leaderId, jd, inviterId ? '邀请链接注册' : '自然注册');
    roleHist.push({ userId: u.id, role: 'creator', from: jd, reason: '注册' });
    return u;
  }

  // 团长
  var leaderNames = ['苏禾', '唐知远', '何若溪', '宋北辰', '温嘉树'];
  leaderNames.forEach(function (n) { used[n] = 1; });
  used['林小满'] = 1; used['江照野'] = 1;
  var leaders = leaderNames.map(function (n, i) {
    var jd = addDays(TODAY, -ri(160, 230));
    var u = mk({ id: i === 0 ? 'L1' : undefined, name: n, role: 'leader', inviterId: i < 3 ? 's2' : null, joinDate: jd, leaderSince: jd,
      skill: 0.9 + R() * 0.6, act: 0.45 + R() * 0.2, projects: { zhihu: true, hongguo: i % 2 === 0, pan: i < 2 } });
    join(u, null, jd, i < 3 ? '员工邀请注册' : '自然注册');
    roleHist.push({ userId: u.id, role: 'leader', from: jd, reason: '初始团长' });
    return u;
  });

  // 当前达人视角用户：林小满，苏禾邀请、在苏禾的团队
  var C1 = addCreator('L1', 'L1', 125, 125, { id: 'C1', name: '林小满', skill: 1.15, act: 0.82, qual: 0.955, projects: { zhihu: true, hongguo: true, pan: true } });
  C1.joinDate = '2026-06-16'; memberships[memberships.length - 1].from = C1.joinDate; roleHist[roleHist.length - 1].from = C1.joinDate;
  addCreator('C1', 'L1', 20, 60);
  addCreator('C1', 'L1', 150, 150); // 将被截到林小满注册之后，测试过期窗口
  addCreator('C1', 'L1', 6, 15);

  leaders.forEach(function (L, li) {
    var n = ri(5, 8);
    for (var k = 0; k < n; k++) {
      var c = addCreator(L.id, L.id, 20, 200);
      if (R() < 0.42) {
        var m = ri(1, 3);
        for (var j = 0; j < m; j++) {
          var g = addCreator(c.id, L.id, 5, 160);
          if (R() < 0.3) addCreator(g.id, L.id, 2, 90);
        }
      }
    }
  });

  // 晋升样例：江照野（唐知远邀请）于 2026-09-20 晋升团长，直接邀请的成员默认跟随，其中 1 人留下
  var L2 = leaders[1];
  var jiang = addCreator(L2.id, L2.id, 200, 200, { name: '江照野', skill: 1.5, act: 0.8, qual: 0.968 });
  jiang.joinDate = '2026-04-02'; memberships[memberships.length - 1].from = jiang.joinDate; roleHist[roleHist.length - 1].from = jiang.joinDate;
  var PROMO_DATE = '2026-09-20';
  var jiangInv = [];
  for (var q = 0; q < 4; q++) {
    var jd = addDays('2026-05-01', ri(0, 120));
    var ju = mk({ name: newName(), role: 'creator', inviterId: jiang.id, joinDate: jd });
    join(ju, L2.id, jd, '邀请链接注册');
    roleHist.push({ userId: ju.id, role: 'creator', from: jd, reason: '注册' });
    jiangInv.push(ju);
  }
  function closeAndOpen(u, leaderId, date, reason) {
    memberships.forEach(function (m) { if (m.userId === u.id && !m.to) m.to = date; });
    join(u, leaderId, date, reason);
  }
  closeAndOpen(jiang, null, PROMO_DATE, '晋升为团长');
  jiang.role = 'leader'; jiang.leaderSince = PROMO_DATE;
  roleHist.push({ userId: jiang.id, role: 'leader', from: PROMO_DATE, reason: '晋升审核通过（PR-0009）' });
  jiangInv.forEach(function (ju, idx) {
    if (idx === 3) { ju.stayed = true; return; } // 留在原团队
    closeAndOpen(ju, jiang.id, PROMO_DATE, '随邀请人晋升转入');
  });

  // 独立达人（平台直管）
  for (var x = 0; x < 7; x++) {
    var ind = addCreator(pick([null, 's2', null]), null, 30, 210);
    if (x < 3) { var cnt = ri(1, 2); for (var y = 0; y < cnt; y++) addCreator(ind.id, null, 5, 120); }
  }

  // 一位已注销的邀请人（其邀请收益此后记为平台留存）
  var disabledCandidate = users.filter(function (u) { return u.role === 'creator' && u.leaderId && u.id !== 'C1' && users.some(function (v) { return v.inviterId === u.id; }); })[0];
  if (disabledCandidate) {
    disabledCandidate.status = 'disabled';
    disabledCandidate.disabledAt = '2026-09-28';
    memberships.forEach(function (m) { if (m.userId === disabledCandidate.id && !m.to) m.to = '2026-09-28'; });
    disabledCandidate.leaderId = null;
  }

  var memBy = {};
  memberships.forEach(function (m) { (memBy[m.userId] = memBy[m.userId] || []).push(m); });
  function leaderAt(uid, d) {
    var ms = memBy[uid] || [];
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (m.from <= d && (!m.to || d < m.to)) return m.leaderId;
    }
    return undefined;
  }

  /* ---------- 业绩事实 ---------- */
  var facts = [];
  users.forEach(function (u) {
    if (u.staff) return;
    projects.forEach(function (p) {
      if (!u.projects[p.id]) return;
      dates.forEach(function (d, di) {
        if (d < u.joinDate || d < p.since) return;
        if (u.disabledAt && d >= u.disabledAt) return;
        var act = u.act * (u.role === 'leader' && (!u.leaderSince || d >= u.leaderSince) ? 0.65 : 1);
        if (R() > act) return;
        var qn = Math.max(1, Math.round(u.skill * p.base * (0.55 + R() * 0.9) * (1 + 0.18 * Math.sin(di / 5))));
        facts.push({ d: d, u: u.id, p: p.id, q: qn, up: r2(p.up * qn) });
      });
    });
  });

  /* ---------- 计酬（两方封顶） ---------- */
  var lines = [], retained = [];
  facts.forEach(function (f) {
    var p = P[f.p], u = byId[f.u];
    var st = f.d >= PENDING_FROM ? 'pending' : 'confirmed';
    var leaderId = leaderAt(u.id, f.d);
    if (leaderId === undefined) leaderId = null;
    var selfLeader = leaderId === null && u.leaderSince && f.d >= u.leaderSince;
    var snap = { leader: leaderId, inviter: u.inviterId || null };
    if (selfLeader) {
      lines.push({ d: f.d, u: u.id, t: 'task', p: f.p, q: f.q, unit: r2(p.creator + p.leader), a: r2((p.creator + p.leader) * f.q), f: u.id, st: st, rule: 'leader_self', snap: snap });
    } else {
      lines.push({ d: f.d, u: u.id, t: 'task', p: f.p, q: f.q, unit: p.creator, a: r2(p.creator * f.q), f: u.id, st: st, rule: 'creator', snap: snap });
      if (leaderId) lines.push({ d: f.d, u: leaderId, t: 'team', p: f.p, q: f.q, unit: p.leader, a: r2(p.leader * f.q), f: u.id, st: st, rule: f.p === 'zhihu' ? 'leader_creator' : 'leader_override', snap: snap });
      else retained.push({ d: f.d, p: f.p, a: r2(p.leader * f.q), reason: 'no_team', f: u.id });
    }
    var inv = u.inviterId ? byId[u.inviterId] : null;
    if (inv && !inv.staff) {
      var ra = r2(p.referral * f.q);
      if (inv.id === leaderId) { /* 邀请人即团长：不叠加 */ }
      else if (inv.status === 'disabled' && f.d >= inv.disabledAt) retained.push({ d: f.d, p: f.p, a: ra, reason: 'inviter_unavailable', f: u.id });
      else if (daysBetween(u.joinDate, f.d) > 180) retained.push({ d: f.d, p: f.p, a: ra, reason: 'referral_window_expired', f: u.id });
      else lines.push({ d: f.d, u: inv.id, t: 'referral', p: f.p, q: f.q, unit: p.referral, a: ra, f: u.id, st: st, rule: 'referral', snap: snap });
    }
  });

  /* ---------- 团队激励 ---------- */
  var incBatches = [
    { id: 'IB-2026-08', month: '2026-08', status: 'posted', proposer: 's2', reviewer: 's3', created: '2026-09-03', postedAt: '2026-09-06' },
    { id: 'IB-2026-09', month: '2026-09', status: 'posted', proposer: 's2', reviewer: 's3', created: '2026-10-04', postedAt: '2026-10-08' },
    { id: 'IB-2026-10', month: '2026-10', status: 'draft', proposer: null, reviewer: null, created: '2026-10-18' }
  ];
  var incItems = [];
  incBatches.forEach(function (b) {
    var monthEnd = b.month + '-31';
    users.filter(function (u) { return u.leaderSince && u.leaderSince <= monthEnd; }).forEach(function (L) {
      var qual = 0.86 + R() * 0.12, active = 0.55 + R() * 0.4;
      var tier = qual >= 0.94 && active >= 0.8 ? 'A' : qual >= 0.9 && active >= 0.65 ? 'B' : 'C';
      var amt = { A: 1200, B: 600, C: 0 }[tier] + (tier === 'C' ? 0 : ri(0, 4) * 50);
      incItems.push({ batch: b.id, leaderId: L.id, qual: qual, active: active, tier: tier, amount: amt,
        note: tier === 'C' ? '本月未达评定标准' : '作品合格率 ' + (qual * 100).toFixed(1) + '%，团队活跃度 ' + (active * 100).toFixed(0) + '%，评定 ' + tier + ' 档' });
      if (b.status === 'posted' && amt > 0) lines.push({ d: b.postedAt, u: L.id, t: 'incentive', p: 'platform', q: 1, unit: amt, a: amt, f: null, st: 'confirmed', rule: 'team_incentive', batch: b.id, snap: {} });
    });
  });

  /* ---------- 账单（每项目每周） ---------- */
  var statements = [];
  projects.forEach(function (p) {
    for (var w = 0; w < 12; w++) {
      var end = addDays(TODAY, -7 * w), start = addDays(end, -6);
      if (end < p.since) continue;
      var fs = facts.filter(function (f) { return f.p === p.id && f.d >= start && f.d <= end; });
      if (!fs.length) continue;
      statements.push({ id: 'ST-' + p.short + '-' + end.replace(/-/g, '').slice(2), p: p.id, start: start, end: end,
        q: fs.reduce(function (a, f) { return a + f.q; }, 0), up: r2(fs.reduce(function (a, f) { return a + f.up; }, 0)),
        status: end >= PENDING_FROM ? 'pending' : 'confirmed', by: end >= PENDING_FROM ? null : 's3' });
    }
  });

  /* ---------- 提现 ---------- */
  var withdrawals = [];
  var payees = users.filter(function (u) { return !u.staff && u.status === 'active'; });
  var wseq = 3301;
  function wd(uid, amount, at, status) { withdrawals.push({ id: 'WD' + (wseq++), u: uid, amount: amount, at: at, status: status, fee: r2(amount * 0.006) }); }
  wd('C1', 300, '2026-09-12', '已打款'); wd('C1', 420, '2026-10-06', '已打款');
  wd('L1', 1200, '2026-10-02', '已打款'); wd('L1', 800, '2026-10-17', '待审批');
  for (var wi = 0; wi < 16; wi++) {
    var pu = pick(payees);
    var st = wi < 5 ? '待审批' : wi < 7 ? '待打款' : wi === 7 ? '已驳回' : '已打款';
    wd(pu.id, ri(1, 30) * 20, addDays(TODAY, -(wi < 7 ? ri(0, 3) : ri(4, 40))), st);
  }

  /* ---------- 作品 ---------- */
  var KW = { zhihu: ['降噪耳机', '考研择校', '露营装备', '空气炸锅', '副业选择', '猫粮推荐', '机械键盘'], hongguo: ['逆光而行', '长街十里', '她的第二人生', '归途有灯'], pan: ['考公真题', 'PS 教程', '英语四六级', '纪录片'] };
  var WT = { zhihu: ['如何评价{k}？亲测说说', '{k}值得入手吗？', '关于{k}，我踩过的坑'], hongguo: ['《{k}》高能片段推荐', '追完《{k}》的三点感受'], pan: ['{k}资料合集', '{k}整理与使用指南'] };
  var works = [];
  var workers = users.filter(function (u) { return !u.staff && u.status === 'active'; });
  for (var wk = 0; wk < 110; wk++) {
    var wu = wk < 9 ? byId.C1 : wk < 30 ? pick(workers.filter(function (u) { return u.leaderId === 'L1'; })) : pick(workers);
    var pids = projects.filter(function (p) { return wu.projects[p.id]; });
    var pp = pids.length ? pick(pids) : projects[0];
    var k = pick(KW[pp.id]);
    var stt = pick(['审核中', '审核中', '需修改', '已通过', '已通过', '已结算', '已结算', '已结算', '待提交']);
    works.push({ id: 'W' + (52000 + wk), u: wu.id, p: pp.id, title: pick(WT[pp.id]).replace('{k}', k), status: stt,
      at: addDays(TODAY, -ri(0, 28)), q: stt === '已通过' || stt === '已结算' ? ri(3, 60) : 0,
      remark: stt === '需修改' ? pick(['首段需补充真实体验', '外链格式不符合规范', '标题与正文关联度不足']) : '' });
  }
  works.sort(function (a, b) { return a.at < b.at ? 1 : -1; });

  /* ---------- 任务大厅 ---------- */
  var tasks = [
    { id: 'T801', p: 'zhihu', title: '数码类问答 · 降噪耳机关键词', reward: '¥2.00 / 拉新', slots: 40, taken: 31, due: '10-25', tags: ['热门', '新手友好'] },
    { id: 'T802', p: 'zhihu', title: '教育类问答 · 考研择校', reward: '¥2.00 / 拉新', slots: 30, taken: 12, due: '10-28', tags: ['高转化'] },
    { id: 'T803', p: 'zhihu', title: '生活类文章 · 露营装备清单', reward: '¥2.00 / 拉新', slots: 25, taken: 25, due: '10-22', tags: ['已满'] },
    { id: 'T804', p: 'hongguo', title: '短剧推荐 · 《逆光而行》', reward: '¥0.80 / 有效观看', slots: 60, taken: 18, due: '10-31', tags: ['新剧'] },
    { id: 'T805', p: 'hongguo', title: '短剧混剪 · 《长街十里》', reward: '¥0.80 / 有效观看', slots: 50, taken: 44, due: '10-24', tags: [] },
    { id: 'T806', p: 'pan', title: '资料分享 · 考公真题合集', reward: '¥3.00 / 拉新', slots: 20, taken: 6, due: '11-05', tags: ['灰度', '高单价'] },
    { id: 'T807', p: 'pan', title: '教程分享 · PS 入门', reward: '¥3.00 / 拉新', slots: 20, taken: 9, due: '11-02', tags: ['灰度'] },
    { id: 'T808', p: 'zhihu', title: '宠物类问答 · 猫粮推荐', reward: '¥2.00 / 拉新', slots: 35, taken: 20, due: '10-30', tags: [] },
    { id: 'T809', p: 'hongguo', title: '短剧推荐 · 《归途有灯》', reward: '¥0.80 / 有效观看', slots: 40, taken: 3, due: '11-08', tags: ['新剧'] }
  ];

  /* ---------- 晋升 ---------- */
  function last30(uid) {
    var from = addDays(TODAY, -29), q = 0, days = {};
    facts.forEach(function (f) { if (f.u === uid && f.d >= from) { q += f.q; days[f.d] = 1; } });
    return { q: q, days: Object.keys(days).length };
  }
  var candPool = users.filter(function (u) { return u.role === 'creator' && u.status === 'active' && u.id !== 'C1' && u.qual > 0.88; })
    .map(function (u) { var s = last30(u.id); return { u: u, s: s }; })
    .sort(function (a, b) { return b.s.q - a.s.q; }).slice(0, 7);
  var promos = [];
  candPool.forEach(function (c, i) {
    var stage = i < 3 ? 'candidate' : i < 5 ? 'review' : 'done';
    promos.push({ id: 'PR-' + pad(13 + i) + '0'.slice(1), userId: c.u.id, stage: stage, source: i % 3 === 1 ? '运营提名' : '系统候选',
      proposer: stage === 'candidate' ? null : 's2', at: addDays(TODAY, -ri(0, 6)), result: stage === 'done' ? 'rejected' : null,
      decidedBy: stage === 'done' ? 's1' : null, reason: stage === 'done' ? '近 30 天活跃天数不足 20 天，下期再评' : '' });
  });
  promos.push({ id: 'PR-0009', userId: jiang.id, stage: 'done', source: '系统候选', proposer: 's2', at: '2026-09-17', result: 'approved', decidedBy: 's1', decidedAt: '2026-09-19', reason: '连续两月合格率 > 96%，团队培训表现突出' });
  promos.forEach(function (p, i) { p.id = 'PR-' + (p.id === 'PR-0009' ? '0009' : String(13 + i).padStart(4, '0')); });

  /* ---------- 入团申请 ---------- */
  var independents = users.filter(function (u) { return u.role === 'creator' && !u.leaderId && u.status === 'active'; });
  var joinRequests = independents.slice(0, 2).map(function (u, i) {
    return { id: 'JR' + (501 + i), userId: u.id, leaderId: 'L1', at: addDays(TODAY, -i), msg: i ? '想跟着团队一起做红果项目' : '朋友推荐，希望加入苏禾老师的团队' };
  });

  /* ---------- 计费规则提议 ---------- */
  var rateProposals = [
    { id: 'RP-031', p: 'hongguo', field: 'referral', from: 0.04, to: 0.05, by: 's2', at: '2026-10-17', status: 'pending', reason: '红果拉新竞争加剧，提升邀请激励' }
  ];
  var referralPolicy = { enabled: true, windowDays: 180, payWhenInviterIsLeader: false };

  /* ---------- 审计 ---------- */
  var audits = [];
  var ACTS = [
    ['s3', '确认账单', 'ST-知乎-261005', '金额与上游报表一致'],
    ['s2', '提名晋升', 'PR-0016', '系统候选，转人工审核'],
    ['s1', '审批晋升', 'PR-0009', '通过：江照野晋升团长，3 人跟随'],
    ['s2', '转队', '何若溪团队 → 宋北辰团队', '成员主动申请，次日生效'],
    ['s3', '打款', 'WD3302', '批量打款 12 笔'],
    ['s4', '发布版本', 'server v2.14.0', '计酬快照字段上线'],
    ['s2', '拟定激励', 'IB-2026-09', '5 位团长，合计 ¥4,350'],
    ['s3', '复核激励', 'IB-2026-09', '复核通过并入账'],
    ['s1', '修改权限', '顾言', '临时授权资金操作 2 小时'],
    ['s2', '移出团队', '温嘉树团队', '长期未活跃'],
    ['s3', '驳回提现', 'WD3310', '收款账户实名不一致'],
    ['s4', '巡检', 'parent_id 一致性', '0 条差异']
  ];
  ACTS.forEach(function (a, i) {
    audits.push({ at: addDays(TODAY, -Math.floor(i / 2)) + ' ' + pad(ri(9, 21)) + ':' + pad(ri(0, 59)), by: a[0], act: a[1], obj: a[2], detail: a[3], ip: '10.0.' + ri(1, 9) + '.' + ri(10, 250) });
  });

  /* ---------- 导出任务 ---------- */
  var exportJobs = [
    { id: 'EX-1207', name: '收益明细_2026-09.csv', ds: 'earnings', by: 's3', at: '2026-10-08 10:12', rows: 18422, progress: 100, status: 'done' },
    { id: 'EX-1206', name: '成员关系_全量.csv', ds: 'members', by: 's2', at: '2026-10-06 16:40', rows: users.length, progress: 100, status: 'done' },
    { id: 'EX-1205', name: '提现记录_Q3.csv', ds: 'withdrawals', by: 's3', at: '2026-10-02 09:03', rows: 642, progress: 100, status: 'expired' }
  ];

  window.DB = {
    TODAY: TODAY, dates: dates, PENDING_FROM: PENDING_FROM, PROMO_DATE: PROMO_DATE,
    projects: projects, P: P, users: users, byId: byId, memberships: memberships, memBy: memBy, roleHist: roleHist,
    facts: facts, lines: lines, retained: retained, incBatches: incBatches, incItems: incItems,
    statements: statements, withdrawals: withdrawals, works: works, tasks: tasks, promos: promos,
    joinRequests: joinRequests, rateProposals: rateProposals, referralPolicy: referralPolicy,
    audits: audits, exportJobs: exportJobs,
    leaderAt: leaderAt, addDays: addDays, daysBetween: daysBetween, r2: r2
  };
})();

