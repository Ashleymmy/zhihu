/* TIMO Web Demo — 页面与交互
 * 6 种角色 × 18 个页面；抽屉、确认弹窗、命令面板（Ctrl K）、通知、项目筛选、深色模式、手机端底部 Tab。
 * 所有数字来自 data.js；操作只改内存数据，刷新即还原。
 */
(function () {
  'use strict';
  const D = window.DB, C = window.Charts;
  const TODAY = D.TODAY, MONTH = TODAY.slice(0, 7) + '-01';
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  /* ---------- 格式 ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = v => '¥' + (+v).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const yen0 = v => '¥' + Math.round(v).toLocaleString('zh-CN');
  const yenS = v => '¥' + C.short(v);
  const int = v => Math.round(v).toLocaleString('zh-CN');
  const pct = (v, d) => (v * 100).toFixed(d == null ? 1 : d) + '%';
  const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  const md = s => s.slice(5);
  const ago = n => D.addDays(TODAY, -n);
  const mask = n => n.length <= 1 ? n : n.length === 2 ? n[0] + '*' : n[0] + '*' + n.slice(2);
  const WEEK = '日一二三四五六';
  function dayList(from, to) { const out = []; for (let d = from; d <= to; d = D.addDays(d, 1)) out.push(d); return out; }
  function groupBy(arr, k) { const m = {}; arr.forEach(x => (m[x[k]] = m[x[k]] || []).push(x)); return m; }
  function nowTime() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  /* ---------- 图标（24 栅格线性） ---------- */
  const IC = {
    home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5',
    wallet: 'M3 7a2 2 0 0 1 2-2h13v4M3 7v10a2 2 0 0 0 2 2h15V9H5a2 2 0 0 1-2-2zM16 14h.01',
    yen: 'M6 3l6 8 6-8M12 11v10M7 13h10M7 17h10',
    users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
    user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    branch: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
    userPlus: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
    chart: 'M3 3v18h18M7 16v-5M12 16V8M17 16v-8',
    trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
    gift: 'M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z',
    receipt: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
    send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
    download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
    bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
    sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
    menu: 'M3 6h18M3 12h18M3 18h18',
    x: 'M18 6 6 18M6 6l12 12',
    chevR: 'm9 18 6-6-6-6',
    chevD: 'm6 9 6 6 6-6',
    check: 'M20 6 9 17l-5-5',
    alert: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
    plus: 'M12 5v14M5 12h14',
    copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
    swap: 'M16 3l4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
    spark: 'M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z',
    expand: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
    edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21'
  };
  function ico(n, s) { s = s || 18; return `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${IC[n] || ''}"/></svg>`; }

  /* ---------- 状态 ---------- */
  function store(k, v) { try { if (v === undefined) return localStorage.getItem('timo.' + k); localStorage.setItem('timo.' + k, v); } catch (e) { return null; } return null; }
  const S = {
    role: store('role') || 'creator',
    theme: document.documentElement.getAttribute('data-theme') || 'light',
    proj: 'all', page: '', ui: {}, viz: {}, timers: [], sel: new Set(), claimed: new Set()
  };
  const ui = (k, def) => (S.ui[k] = S.ui[k] || Object.assign({}, def));

  /* ---------- 颜色：按实体固定，深色模式用单独校验过的色阶 ---------- */
  const PCOL = { light: { zhihu: '#3D5AFE', hongguo: '#FF6B4A', pan: '#14B8A6', platform: '#8B5CF6' }, dark: { zhihu: '#4F6BFF', hongguo: '#E8603F', pan: '#11A18F', platform: '#9575F7' } };
  const TCOL = { light: { task: '#3D5AFE', team: '#E08A00', referral: '#E64C9A', incentive: '#8B5CF6' }, dark: { task: '#4F6BFF', team: '#D08000', referral: '#E0559C', incentive: '#9575F7' } };
  const KEEP = { light: '#9AA0B4', dark: '#5E6584' };
  const isDark = () => S.theme === 'dark';
  const mode = dark => (dark || isDark()) ? 'dark' : 'light';
  const pc = (id, dark) => PCOL[mode(dark)][id];
  const tc = (t, dark) => TCOL[mode(dark)][t];
  const keepC = dark => KEEP[mode(dark)];

  const TYPES = ['task', 'team', 'referral', 'incentive'];
  const TL = { task: '任务收益', team: '团队管理收益', referral: '邀请收益', incentive: '团队激励' };
  const RULE = { creator: '达人任务单价', leader_self: '团长本人任务（达人价 + 团长价）', leader_creator: '团长管理单价', leader_override: '团长管理单价', referral: '一级邀请单价（注册 180 天内）', team_incentive: '团队激励评定（公开标准）' };
  const RET = { no_team: '独立达人 · 团长差价', referral_window_expired: '邀请已满 180 天', inviter_unavailable: '邀请人已注销' };
  const WST = { '审核中': 'warn', '需修改': 'bad', '已通过': 'ok', '已结算': 'pri', '待提交': '' };
  const PST = { '待审批': 'warn', '待打款': 'info', '已打款': 'ok', '已驳回': 'bad' };

  /* ---------- 角色与权限 ---------- */
  const ROLES = {
    creator: { uid: 'C1', label: '达人', nav: [['我的', ['home', 'tasks', 'works', 'earnings', 'invite', 'wallet']]], tabs: ['home', 'tasks', 'earnings', 'invite', 'wallet'] },
    leader: { uid: 'L1', label: '团长', nav: [['工作台', ['home', 'tasks', 'works']], ['我的团队', ['team', 'tree', 'invite']], ['资金', ['earnings', 'wallet']]], tabs: ['home', 'team', 'earnings', 'invite', 'wallet'] },
    operator: { uid: 's2', label: '运营管理', nav: [['总览', ['overview', 'screen']], ['成员', ['members', 'tree', 'promotions']], ['激励', ['incentives']], ['数据', ['exports', 'audit']]] },
    finance: { uid: 's3', label: '财务管理', nav: [['总览', ['overview', 'screen']], ['资金', ['settlement', 'payouts', 'incentives', 'rules']], ['数据', ['exports', 'audit']]] },
    developer: { uid: 's4', label: '开发者', nav: [['总览', ['overview', 'screen']], ['数据', ['members', 'tree', 'rules', 'exports', 'audit']]] },
    admin: { uid: 's1', label: '超级管理员', nav: [['总览', ['overview', 'screen']], ['成员', ['members', 'tree', 'promotions', 'incentives']], ['资金', ['settlement', 'payouts', 'rules']], ['数据', ['exports', 'audit']]] }
  };
  if (!ROLES[S.role]) S.role = 'creator';
  const CAN = {
    manageMembers: ['operator', 'admin'], nominate: ['operator', 'admin'], approvePromo: ['admin'],
    draftIncentive: ['operator', 'admin'], reviewIncentive: ['finance', 'admin'],
    settle: ['finance', 'admin'], payout: ['finance', 'admin'],
    proposeRate: ['operator', 'finance', 'admin'], approveRate: ['admin'], referralSwitch: ['admin'],
    sensitiveExport: ['finance', 'admin']
  };
  const can = k => CAN[k].indexOf(S.role) >= 0;
  const navPages = () => [].concat.apply([], ROLES[S.role].nav.map(g => g[1]));

  /* ---------- 数据访问 ---------- */
  const U = id => D.byId[id];
  const me = () => U(ROLES[S.role].uid);
  D.lines.forEach((l, i) => { l.id = i; });
  const FBU = groupBy(D.facts, 'u'), LBU = groupBy(D.lines, 'u'), INV = groupBy(D.users.filter(u => u.inviterId), 'inviterId');
  function addLine(l) { l.id = D.lines.length; D.lines.push(l); (LBU[l.u] = LBU[l.u] || []).push(l); }
  const projOk = p => S.proj === 'all' || p === S.proj || p === 'platform';
  const linesOf = (uid, from, to) => (LBU[uid] || []).filter(l => l.d >= (from || '') && l.d <= (to || '9999') && projOk(l.p));
  const factsIn = (from, to) => D.facts.filter(f => f.d >= from && f.d <= to && projOk(f.p));
  const activeLeaders = () => D.users.filter(u => u.role === 'leader' && u.status === 'active');
  function teamMembers(lid) { return D.users.filter(u => !u.staff && u.status === 'active' && u.id !== lid && D.leaderAt(u.id, TODAY) === lid); }
  function independents() { return D.users.filter(u => !u.staff && u.role === 'creator' && u.status === 'active' && D.leaderAt(u.id, TODAY) === null); }
  function downline(uid) { const out = [], q = (INV[uid] || []).slice(); while (q.length) { const n = q.shift(); out.push(n); q.push.apply(q, INV[n.id] || []); } return out; }
  function stat30(uid, all) {
    const from = ago(29), fs = (FBU[uid] || []).filter(f => f.d >= from && (all || projOk(f.p)));
    const ls = (LBU[uid] || []).filter(l => l.d >= from && (all || projOk(l.p)));
    return { days: new Set(fs.map(f => f.d)).size, earn: sum(ls, l => l.a), task: sum(ls.filter(l => l.t === 'task'), l => l.a) };
  }
  function wallet(uid) {
    const ls = LBU[uid] || [], ws = D.withdrawals.filter(w => w.u === uid);
    const confirmed = sum(ls.filter(l => l.st === 'confirmed'), l => l.a), pending = sum(ls.filter(l => l.st === 'pending'), l => l.a);
    const out = sum(ws.filter(w => w.status !== '已驳回'), w => w.amount), paid = sum(ws.filter(w => w.status === '已打款'), w => w.amount);
    return { confirmed, pending, balance: D.r2(confirmed - out), paid, inflight: out - paid };
  }
  function roleOf(u) {
    if (u.staff) return u.title;
    if (u.status === 'disabled') return '已停用';
    if (u.role === 'leader') return '团长';
    return D.leaderAt(u.id, TODAY) ? '达人' : '独立达人';
  }
  function teamOf(u) {
    if (u.role === 'leader') return u.name + '团队（团长）';
    const l = D.leaderAt(u.id, TODAY);
    return l ? U(l).name + '团队' : l === null ? '平台直管' : '—';
  }
  const teamName = lid => lid ? U(lid).name + '团队' : '平台直管';
  function setLeader(u, lid, reason) {
    const ms = D.memBy[u.id] = D.memBy[u.id] || [];
    ms.forEach(m => { if (!m.to) m.to = TODAY; });
    const m = { userId: u.id, leaderId: lid, from: TODAY, to: null, reason };
    ms.push(m); D.memberships.push(m); u.leaderId = lid;
  }
  function log(act, obj, detail) {
    D.audits.unshift({ at: TODAY + ' ' + nowTime(), by: me().id, act, obj, detail, ip: '10.0.3.' + (20 + D.audits.length) });
  }

  /* ---------- 小组件 ---------- */
  function av(u, s) { s = s || 32; return `<span class="av" style="--h:${u.hue};width:${s}px;height:${s}px;font-size:${Math.round(s * 0.42)}px">${esc(u.name[0])}</span>`; }
  function who(u, sub, s) { return `<div class="who">${av(u, s || 32)}<div><b>${esc(u.name)}</b>${sub != null ? `<small>${sub}</small>` : ''}</div></div>`; }
  const tag = (t, cls, dot) => `<span class="tag ${cls || ''}">${dot === false ? '' : '<span class="d"></span>'}${t}</span>`;
  const chipP = p => `<span class="chip-p"><i style="background:${pc(p)}"></i>${esc(D.P[p].short)}</span>`;
  function trend(v) { if (!isFinite(v)) return ''; return `<span class="trend ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '↑' : '↓'} ${Math.abs(v * 100).toFixed(1)}%</span>`; }
  function kpi(o) {
    return `<div class="card kpi" style="--c:${o.c || 'var(--primary)'}">${o.spark ? `<div class="kpi-sp">${o.spark}</div>` : ''}<div class="kpi-i">${ico(o.i)}</div><div class="kpi-l">${o.l}</div><div class="kpi-v num">${o.v}</div><div class="kpi-s">${o.s || ''}</div></div>`;
  }
  const chLegend = series => `<div class="ch-legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  function seg(k, opts, cur) { return `<div class="seg">${opts.map(o => `<button class="${cur === o[0] ? 'on' : ''}" data-act="set" data-k="${k}" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`; }
  function seriesTable(labels, series, fmt) {
    fmt = fmt || yen;
    return `<table class="tbl"><thead><tr><th>日期</th>${series.map(s => `<th class="r"><span class="chip-p"><i style="background:${s.color}"></i>${esc(s.name)}</span></th>`).join('')}<th class="r">合计</th></tr></thead><tbody>${labels.map((l, i) => `<tr><td class="num">${l}</td>${series.map(s => `<td class="r num">${fmt(s.values[i] || 0)}</td>`).join('')}<td class="r num"><b>${fmt(sum(series, s => s.values[i] || 0))}</b></td></tr>`).reverse().join('')}</tbody></table>`;
  }
  function viz(key, chart, table) {
    const m = S.viz[key] || 'chart';
    return {
      tog: `<div class="seg">${[['chart', '图表'], ['table', '表格']].map(o => `<button class="${m === o[0] ? 'on' : ''}" data-act="viz" data-k="${key}" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`,
      body: m === 'chart' ? chart() : `<div class="tscroll" style="max-height:300px;overflow:auto">${table()}</div>`
    };
  }
  const empty = (t, i) => `<div class="empty">${ico(i || 'info', 32)}${t}</div>`;
  function moreBtn(k, shown, total) { return total > shown ? `<div class="tfoot"><button class="btn sm" data-act="more" data-k="${k}">加载更多（还有 ${total - shown} 条）</button></div>` : ''; }

  function earnSeries(uid, days) {
    const idx = {}; days.forEach((d, i) => { idx[d] = i; });
    const series = TYPES.map(t => ({ t, name: TL[t], color: tc(t), values: days.map(() => 0) }));
    (LBU[uid] || []).forEach(l => { const i = idx[l.d]; if (i !== undefined && projOk(l.p)) series[TYPES.indexOf(l.t)].values[i] += l.a; });
    series.forEach(s => { s.values = s.values.map(D.r2); });
    return series.filter(s => s.values.some(v => v > 0));
  }
  function composition(ls) {
    return TYPES.map(t => ({ label: TL[t], color: tc(t), value: D.r2(sum(ls.filter(l => l.t === t), l => l.a)) })).filter(x => x.value > 0);
  }

  /* ---------- 待办（首页、通知、侧栏角标共用） ---------- */
  function todos() {
    const r = S.role, u = me(), out = [];
    if (r === 'creator' || r === 'leader') {
      if (r === 'leader') {
        const jr = D.joinRequests.filter(j => j.leaderId === u.id).length;
        if (jr) out.push({ ic: 'userPlus', cls: 't-acc', t: `${jr} 条入团申请待处理`, s: '独立达人申请加入你的团队', go: 'team', n: jr, page: 'team' });
        const ids = new Set(teamMembers(u.id).map(m => m.id));
        const tf = D.works.filter(w => ids.has(w.u) && w.status === '需修改').length;
        if (tf) out.push({ ic: 'file', cls: 't-warn', t: `团队 ${tf} 篇作品需修改`, s: '提醒成员按审核意见修改', go: 'works' });
      }
      const fix = D.works.filter(w => w.u === u.id && w.status === '需修改').length;
      if (fix) out.push({ ic: 'edit', cls: 't-warn', t: `${fix} 篇作品需修改`, s: '修改后重新提交审核', go: 'works', n: fix, page: 'works' });
      const w = wallet(u.id);
      if (w.pending) out.push({ ic: 'clock', cls: 't-pri', t: `${yen(w.pending)} 收益待确认`, s: '上游账单确认后自动转为可提现', go: 'earnings' });
      const open = D.tasks.filter(t => t.taken < t.slots && !S.claimed.has(t.id)).length;
      out.push({ ic: 'list', cls: 't-info', t: `${open} 个任务可领取`, s: '新剧《归途有灯》已上线', go: 'tasks' });
      return out;
    }
    if (can('payout')) { const n = D.withdrawals.filter(w => w.status === '待审批').length; if (n) out.push({ ic: 'send', cls: 't-warn', t: `${n} 笔提现待审批`, s: '合计 ' + yen(sum(D.withdrawals.filter(w => w.status === '待审批'), w => w.amount)), go: 'payouts', n, page: 'payouts' }); }
    if (can('settle')) { const st = D.statements.filter(s => s.status === 'pending'); if (st.length) out.push({ ic: 'receipt', cls: 't-pri', t: `${st.length} 张账单待确认`, s: '上游金额 ' + yen(sum(st, s => s.up)), go: 'settlement', n: st.length, page: 'settlement' }); }
    if (can('approvePromo')) { const n = D.promos.filter(p => p.stage === 'review').length; if (n) out.push({ ic: 'trophy', cls: 't-acc', t: `${n} 个晋升申请待审批`, s: '运营已提名，等待终审', go: 'promotions', n, page: 'promotions' }); }
    else if (can('nominate')) { const n = D.promos.filter(p => p.stage === 'candidate').length; if (n) out.push({ ic: 'trophy', cls: 't-acc', t: `${n} 位晋升候选人待提名`, s: '系统按公开标准筛出', go: 'promotions', n, page: 'promotions' }); }
    const ib = D.incBatches.find(b => b.status !== 'posted');
    if (ib && ib.status === 'draft' && can('draftIncentive')) out.push({ ic: 'gift', cls: 't-info', t: `${ib.month.slice(5)} 月团队激励待拟定`, s: '草稿已按公开标准生成', go: 'incentives', n: 1, page: 'incentives' });
    if (ib && ib.status === 'review' && can('reviewIncentive') && ib.proposer !== me().id) out.push({ ic: 'gift', cls: 't-info', t: `${ib.month.slice(5)} 月团队激励待复核`, s: '运营已拟定，等待财务复核', go: 'incentives', n: 1, page: 'incentives' });
    if (can('approveRate')) { const n = D.rateProposals.filter(p => p.status === 'pending').length; if (n) out.push({ ic: 'sliders', cls: 't-info', t: `${n} 条计费规则调整待审批`, s: '审批通过后对新业绩生效', go: 'rules', n, page: 'rules' }); }
    if (S.role === 'developer') out.push({ ic: 'shield', cls: 't-ok', t: 'parent_id 一致性巡检：0 条差异', s: '今日 04:00 自动执行', go: 'audit' });
    return out;
  }
  function todoList(items) {
    if (!items.length) return empty('暂无待办', 'check');
    return items.map(t => `<div class="todo-i" data-act="go" data-p="${t.go}"><span class="ti ${t.cls}">${ico(t.ic)}</span><div><b>${t.t}</b><small>${t.s}</small></div>${ico('chevR', 16)}</div>`).join('');
  }

  /* =====================================================================
   * 页面
   * ===================================================================== */
  const PAGES = {};
  function greet() { const h = new Date().getHours(); return h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'; }
  function todayText() { const p = TODAY.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]); return `${+p[1]} 月 ${+p[2]} 日 · 星期${WEEK[d.getDay()]}`; }

  /* ---------- 首页（达人 / 团长） ---------- */
  PAGES.home = {
    t: '首页', ic: 'home', sub: () => todayText(),
    r() {
      const u = me(), isL = S.role === 'leader', w = wallet(u.id);
      const mLs = linesOf(u.id, MONTH, TODAY), mTotal = sum(mLs, l => l.a);
      const prev = sum(linesOf(u.id, '2026-09-01', '2026-09-' + TODAY.slice(8)), l => l.a);
      const days30 = dayList(ago(29), TODAY);
      const daily = days30.map(d => sum((LBU[u.id] || []).filter(l => l.d === d && projOk(l.p)), l => l.a));
      const s30 = stat30(u.id);
      const members = isL ? teamMembers(u.id) : [];
      const typeSum = t => sum(mLs.filter(l => l.t === t), l => l.a);
      const chg = prev ? mTotal / prev - 1 : NaN;
      const heroTrend = isFinite(chg) ? `<span class="trend" style="background:rgba(255,255,255,.16);color:#fff">${chg >= 0 ? '↑' : '↓'} ${Math.abs(chg * 100).toFixed(1)}%</span>` : '';

      const hero = `<div class="hero">
        <div class="hero-l">可提现余额</div>
        <div class="hero-v num"><small>¥</small>${(w.balance).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style="font-size:13px;opacity:.82">本月已入账 ${yen(mTotal)} ${heroTrend}<span style="opacity:.75;margin-left:6px">较上月同期</span></div>
        <div class="hero-meta">
          <div><b class="num">${yen(w.pending)}</b>待确认</div>
          <div><b class="num">${yen(w.inflight)}</b>提现处理中</div>
          <div><b class="num">${yen(w.paid)}</b>累计到账</div>
        </div>
        <div class="hero-act"><button class="btn pri" data-act="withdraw">${ico('wallet', 16)}申请提现</button><button class="btn" data-act="go" data-p="earnings">收益明细</button></div>
      </div>`;

      const kpis = isL ? [
        kpi({ i: 'users', l: '团队成员', v: members.length + '<small>人</small>', s: `本月新加入 ${members.filter(m => (D.memBy[m.id] || []).some(x => x.leaderId === u.id && x.from >= MONTH)).length} 人` }),
        kpi({ i: 'yen', c: tc('team'), l: '本月团队管理收益', v: yen(typeSum('team')), s: '按成员业绩当天归属计算', spark: C.spark(days30.map(d => sum((LBU[u.id] || []).filter(l => l.d === d && l.t === 'team' && projOk(l.p)), l => l.a)), tc('team'), 92, 30) }),
        kpi({ i: 'list', c: tc('task'), l: '本月本人任务收益', v: yen(typeSum('task')), s: '团长本人任务：达人价 + 团长价' }),
        kpi({ i: 'gift', c: tc('incentive'), l: '本月团队激励', v: yen(typeSum('incentive')), s: '按公开标准评定，两级审批' })
      ] : [
        kpi({ i: 'yen', l: '本月收益', v: yen(mTotal), s: trend(prev ? mTotal / prev - 1 : NaN) + '较上月同期', spark: C.spark(daily, tc('task'), 92, 30) }),
        kpi({ i: 'list', c: tc('task'), l: '本月任务收益', v: yen(typeSum('task')), s: '按项目单价 × 有效业绩' }),
        kpi({ i: 'userPlus', c: tc('referral'), l: '本月邀请收益', v: yen(typeSum('referral')), s: `直接邀请 ${(INV[u.id] || []).length} 人 · 仅一级` }),
        kpi({ i: 'clock', c: 'var(--ok)', l: '近 30 天活跃', v: s30.days + '<small>天</small>', s: '连续活跃有助于晋升团长' })
      ];

      const series = earnSeries(u.id, days30);
      const v = viz('home-earn', () => chLegend(series) + `<div style="margin-top:10px">${C.bars({ labels: days30.map(md), series, w: 1080, h: 260, yFmt: yenS, fmt: yen })}</div>`, () => seriesTable(days30.map(md), series));

      let bottom;
      if (isL) {
        const tl = (LBU[u.id] || []).filter(l => l.t === 'team' && l.d >= ago(29));
        const ps = D.projects.filter(p => projOk(p.id)).map(p => ({ name: p.short, color: pc(p.id), values: days30.map(d => sum(tl.filter(l => l.p === p.id && l.d === d), l => l.a)) })).filter(s => s.values.some(x => x));
        const contrib = {}; tl.forEach(l => { contrib[l.f] = (contrib[l.f] || 0) + l.a; });
        const top = members.map(m => ({ m, v: D.r2(contrib[m.id] || 0) })).sort((a, b) => b.v - a.v).slice(0, 8);
        bottom = `<div class="grid g21">
          <div class="card"><div class="card-h"><h3>团队管理收益 · 按项目</h3><span class="sub">近 30 天</span></div>${chLegend(ps)}<div style="margin-top:10px">${C.line({ labels: days30.map(md), series: ps, w: 720, h: 220, yFmt: yenS, fmt: yen })}</div></div>
          <div class="card"><div class="card-h"><h3>成员贡献榜</h3><span class="sub">近 30 天带来的管理收益</span></div>
            ${top.map((x, i) => `<div class="rank" data-act="user" data-id="${x.m.id}" style="cursor:pointer"><span class="n">${i + 1}</span>${who(x.m, (x.m.inviterId === u.id ? '直接邀请' : '团队成员') + ' · 活跃 ' + stat30(x.m.id).days + ' 天', 30)}<b class="num" style="margin-left:auto">${yen(x.v)}</b></div>`).join('') || empty('暂无数据')}
          </div></div>`;
      } else {
        const tk = D.tasks.filter(t => t.taken < t.slots && u.projects[t.p] && projOk(t.p)).slice(0, 4);
        bottom = `<div class="grid g2">
          <div class="card"><div class="card-h"><h3>推荐任务</h3><a class="link" data-act="go" data-p="tasks" style="margin-left:auto;font-size:13px">全部任务</a></div>
            ${tk.map(t => `<div class="proj-card"><span class="proj-ic" style="background:${pc(t.p)}">${esc(D.P[t.p].short[0])}</span><div style="min-width:0"><b style="font-weight:600">${esc(t.title)}</b><div class="muted" style="font-size:12px">${t.reward} · 剩余 ${t.slots - t.taken} 个名额 · ${t.due} 截止</div></div><button class="btn sm ${S.claimed.has(t.id) ? '' : 'pri'}" style="margin-left:auto" data-act="claim" data-id="${t.id}" ${S.claimed.has(t.id) ? 'disabled' : ''}>${S.claimed.has(t.id) ? '已领取' : '领取'}</button></div>`).join('')}
          </div>
          <div class="card"><div class="card-h"><h3>我的项目</h3><span class="sub">本月</span></div>
            ${D.projects.filter(p => u.projects[p.id]).map(p => { const ls = mLs.filter(l => l.p === p.id && l.t === 'task'); return `<div class="proj-card"><span class="proj-ic" style="background:${pc(p.id)}">${esc(p.short[0])}</span><div><b style="font-weight:600">${esc(p.name)}</b><div class="muted" style="font-size:12px">本月 ${int(sum(ls, l => l.q))} ${p.unit}${p.metric} · 单价 ${yen(p.creator)}</div></div><div style="margin-left:auto;text-align:right"><b class="num">${yen(sum(ls, l => l.a))}</b><div>${tag(p.status, p.status === '运行中' ? 'ok' : 'warn')}</div></div></div>`; }).join('')}
          </div></div>`;
      }

      return `<div class="hello"><div><h2>${greet()}，${esc(u.name)}</h2><p>${isL ? `团长 · ${members.length} 位成员` : teamOf(u) + ' · 达人'} · ${todayText()}</p></div><button class="btn" data-act="go" data-p="invite">${ico('userPlus', 16)}邀请好友</button></div>
        <div class="grid g21">${hero}<div class="card"><div class="card-h"><h3>待办</h3></div>${todoList(todos())}</div></div>
        <div class="grid g4">${kpis.join('')}</div>
        <div class="grid"><div class="card"><div class="card-h"><h3>近 30 天收益</h3><span class="sub">按收益类型堆叠</span>${v.tog}</div>${v.body}</div></div>
        ${bottom}`;
    }
  };

  /* ---------- 任务大厅 ---------- */
  PAGES.tasks = {
    t: '任务大厅', ic: 'list', sub: '领取官方下发的项目任务',
    r() {
      const st = ui('tasks', { f: 'open' });
      let ts = D.tasks.filter(t => projOk(t.p));
      if (st.f === 'open') ts = ts.filter(t => t.taken < t.slots && !S.claimed.has(t.id));
      if (st.f === 'mine') ts = ts.filter(t => S.claimed.has(t.id));
      return `<div class="row wrap" style="margin-bottom:16px">${seg('tasks.f', [['open', '可领取'], ['mine', '已领取'], ['all', '全部']], st.f)}<span class="sp"></span><span class="muted" style="font-size:13px">顶栏可切换项目 · 共 ${ts.length} 个</span></div>
        ${ts.length ? `<div class="grid g3">${ts.map(t => {
          const full = t.taken >= t.slots, mine = S.claimed.has(t.id), p = D.P[t.p];
          return `<div class="card task"><div class="row">${chipP(t.p)}<span class="sp"></span>${t.tags.map(x => tag(x, x === '已满' ? '' : x === '热门' || x === '高单价' ? 'acc' : x === '灰度' ? 'warn' : 'pri', false)).join(' ')}</div>
            <h4>${esc(t.title)}</h4>
            <div class="row"><span class="rw num">${t.reward.split(' / ')[0]}</span><span class="muted">/ ${t.reward.split(' / ')[1]}</span></div>
            <div><div class="row" style="font-size:12px;margin-bottom:6px"><span class="muted">已领 ${t.taken}/${t.slots}</span><span class="sp"></span><span class="muted">${ico('clock', 13)}</span><span class="muted">${t.due} 截止</span></div><div class="bar"><i style="width:${t.taken / t.slots * 100}%;background:${pc(t.p)}"></i></div></div>
            <div class="row"><span class="muted" style="font-size:12px">${p.name} · 计量：${p.metric}</span><span class="sp"></span><button class="btn sm ${full || mine ? '' : 'pri'}" data-act="claim" data-id="${t.id}" ${full || mine ? 'disabled' : ''}>${mine ? '已领取' : full ? '名额已满' : '领取任务'}</button></div></div>`;
        }).join('')}</div>` : `<div class="card">${empty(st.f === 'mine' ? '还没有领取任务' : '暂无可领取任务', 'list')}</div>`}`;
    }
  };

  /* ---------- 作品 ---------- */
  PAGES.works = {
    t: '作品管理', ic: 'file', sub: '提交、审核与计量',
    r() {
      const st = ui('works', { tab: '全部', scope: 'mine', limit: 30 }), u = me(), isL = S.role === 'leader';
      const ids = st.scope === 'team' && isL ? new Set(teamMembers(u.id).map(m => m.id)) : new Set([u.id]);
      const base = D.works.filter(w => ids.has(w.u) && projOk(w.p));
      const tabs = ['全部', '审核中', '需修改', '已通过', '已结算', '待提交'];
      const list = st.tab === '全部' ? base : base.filter(w => w.status === st.tab);
      return `<div class="row wrap" style="margin-bottom:12px">${isL ? seg('works.scope', [['mine', '我的作品'], ['team', '团队成员']], st.scope) : ''}<span class="sp"></span><button class="btn pri" data-act="work-new">${ico('plus', 16)}提交作品</button></div>
        <div class="card flat"><div class="tabs" style="padding:0 12px;margin:0">${tabs.map(t => { const n = t === '全部' ? base.length : base.filter(w => w.status === t).length; return `<button class="${st.tab === t ? 'on' : ''}" data-act="set" data-k="works.tab" data-v="${t}">${t}<span class="muted num">${n}</span></button>`; }).join('')}</div>
        <div class="tscroll"><table class="tbl"><thead><tr><th>作品</th>${st.scope === 'team' ? '<th>作者</th>' : ''}<th>项目</th><th>提交日期</th><th>状态</th><th class="r">有效计量</th><th>审核意见</th></tr></thead><tbody>
        ${list.slice(0, st.limit).map(w => `<tr><td><b style="font-weight:600">${esc(w.title)}</b><div class="mono muted">${w.id}</div></td>${st.scope === 'team' ? `<td>${who(U(w.u), null, 26)}</td>` : ''}<td>${chipP(w.p)}</td><td class="num">${w.at}</td><td>${tag(w.status, WST[w.status])}</td><td class="r num">${w.q ? w.q + ' ' + D.P[w.p].unit : '—'}</td><td class="${w.remark ? 'bad' : 'muted'}" style="font-size:13px">${esc(w.remark || '—')}</td></tr>`).join('') || `<tr><td colspan="7">${empty('没有符合条件的作品', 'file')}</td></tr>`}
        </tbody></table></div>${moreBtn('works', st.limit, list.length)}</div>`;
    }
  };

  /* ---------- 收益明细 ---------- */
  const PERIODS = { month: ['本月', MONTH, TODAY], last: ['上月', '2026-09-01', '2026-09-30'], d90: ['近 90 天', D.dates[0], TODAY] };
  PAGES.earnings = {
    t: '收益明细', ic: 'yen', sub: '每一笔收益都能追溯到业绩与规则',
    r() {
      const st = ui('earn', { period: 'month', type: 'all', limit: 40 }), u = me(), P0 = PERIODS[st.period];
      const all = linesOf(u.id, P0[1], P0[2]);
      const ls = st.type === 'all' ? all : all.filter(l => l.t === st.type);
      const days = dayList(P0[1], P0[2]);
      const series = earnSeries(u.id, days).filter(s => st.type === 'all' || s.t === st.type);
      const comp = composition(all), total = sum(all, l => l.a);
      const v = viz('earn', () => chLegend(series) + `<div style="margin-top:10px">${C.bars({ labels: days.map(md), series, w: 720, h: 240, yFmt: yenS, fmt: yen })}</div>`, () => seriesTable(days.map(md), series));
      const sorted = ls.slice().sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : b.a - a.a);
      const src = l => l.t === 'incentive' ? `<span class="mono">${l.batch}</span>` : l.f === u.id ? '<span class="muted">本人</span>' : esc(U(l.f).name);
      return `<div class="row wrap" style="margin-bottom:16px">${seg('earn.period', Object.keys(PERIODS).map(k => [k, PERIODS[k][0]]), st.period)}${seg('earn.type', [['all', '全部类型']].concat(TYPES.filter(t => all.some(l => l.t === t)).map(t => [t, TL[t]])), st.type)}<span class="sp"></span><button class="btn" data-act="csv-earn">${ico('download', 16)}导出 CSV</button></div>
        <div class="note" style="margin-bottom:16px">${ico('shield')}<div><b>计酬规则：</b>任何一笔业绩最多向上付给两方——业绩当天的团长、直接邀请人（仅一级，注册 180 天内）。邀请人就是团长时不重复计算。点击任意一行查看计算过程。</div></div>
        <div class="grid g21">
          <div class="card"><div class="card-h"><h3>每日收益</h3><span class="sub">${P0[0]} · ${P0[1]} 至 ${P0[2]}</span>${v.tog}</div>${v.body}</div>
          <div class="card"><div class="card-h"><h3>收益构成</h3><span class="sub">${P0[0]}</span></div>
            ${comp.length ? `<div class="donut-wrap">${C.donut({ items: comp, size: 168, center: { value: yenS(total), label: '合计' } })}${C.legend(comp, yen)}</div>` : empty('该时段暂无收益')}
          </div>
        </div>
        <div class="card flat"><div class="card-h"><h3>明细</h3><span class="sub">${ls.length} 笔 · 合计 ${yen(sum(ls, l => l.a))}</span></div>
          <div class="tscroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>日期</th><th>类型</th><th>项目</th><th>业绩来源</th><th class="r">数量</th><th class="r">单价</th><th class="r">金额</th><th>状态</th></tr></thead><tbody>
          ${sorted.slice(0, st.limit).map(l => `<tr class="click" data-act="line" data-id="${l.id}"><td class="num">${l.d}</td><td><span class="chip-p"><i style="background:${tc(l.t)}"></i>${TL[l.t]}</span></td><td>${l.p === 'platform' ? '<span class="muted">平台</span>' : chipP(l.p)}</td><td>${src(l)}</td><td class="r num">${l.t === 'incentive' ? '—' : l.q}</td><td class="r num">${l.t === 'incentive' ? '—' : yen(l.unit)}</td><td class="r num"><b>${yen(l.a)}</b></td><td>${l.st === 'pending' ? tag('待确认', 'warn') : tag('已确认', 'ok')}</td></tr>`).join('') || `<tr><td colspan="8">${empty('没有收益记录', 'yen')}</td></tr>`}
          </tbody></table></div>${moreBtn('earn', st.limit, sorted.length)}</div>`;
    }
  };
  function explainLine(id) {
    const l = D.lines[id], recv = U(l.u), src = l.f ? U(l.f) : null, p = D.P[l.p];
    const snapL = l.snap.leader ? U(l.snap.leader).name : '无（平台直管）', snapI = l.snap.inviter ? U(l.snap.inviter).name : '无';
    let why;
    if (l.t === 'task' && l.rule === 'leader_self') why = '团长本人完成任务，同一笔业绩只有一位收款人：达人单价与团长单价一并计入本人。';
    else if (l.t === 'task') why = `这是你本人完成的业绩，按${p.name}的达人单价计算。`;
    else if (l.t === 'team') why = `业绩发生当天（${l.d}），${src.name} 属于你的团队。系统保存了当天的关系快照，之后转队或晋升不影响这笔收益。`;
    else if (l.t === 'referral') { const dd = D.daysBetween(src.joinDate, l.d); why = `${src.name} 由你直接邀请，${src.joinDate} 注册，业绩发生时为第 ${dd} 天（180 天有效期内）。${src.name} 的团长不是你，所以这笔邀请收益不与团队管理收益重叠。`; }
    else { const it = D.incItems.find(x => x.batch === l.batch && x.leaderId === l.u); why = `批次 ${l.batch}：${it ? it.note : ''}。由运营拟定、财务复核后入账，评定标准公开，不与下线收入挂钩。`; }
    const eq = l.t === 'incentive' ? `<div class="eq"><b class="num">${yen(l.a)}</b><span>评定档位奖励</span></div>` : `<div class="eq"><span class="num">${l.q} ${p.unit}</span><span>×</span><span class="num">${yen(l.unit)}</span><span>=</span><b class="num">${yen(l.a)}</b></div>`;
    openDrawer({
      title: TL[l.t] + ' · ' + yen(l.a), sub: `${l.d} · ${l.p === 'platform' ? '平台运营奖励' : p.name}`,
      body: `<div class="calc">${eq}<div class="flow" style="margin-top:14px">${src ? `<span class="nd">${esc(src.name)} 的业绩</span>${ico('arrow', 16)}` : ''}<span class="nd">${RULE[l.rule]}</span>${ico('arrow', 16)}<span class="nd hl">${esc(recv.name)}</span></div></div>
        <div class="note" style="margin:16px 0">${ico('info')}<div>${why}</div></div>
        <dl class="kv"><dt>业绩日期</dt><dd class="num">${l.d}</dd><dt>项目</dt><dd>${l.p === 'platform' ? '平台' : chipP(l.p)}</dd><dt>计酬规则</dt><dd>${RULE[l.rule]}</dd>
        ${l.t !== 'incentive' ? `<dt>快照 · 团长</dt><dd>${esc(snapL)}</dd><dt>快照 · 邀请人</dt><dd>${esc(snapI)}</dd>` : ''}
        <dt>状态</dt><dd>${l.st === 'pending' ? tag('待确认', 'warn') + ' <span class="muted" style="font-size:12px">上游账单确认后可提现</span>' : tag('已确认', 'ok')}</dd><dt>流水号</dt><dd class="mono">EL-${String(100000 + l.id)}</dd></dl>`,
      foot: `<button class="btn" data-act="close">关闭</button>`
    });
  }

  /* ---------- 邀请中心 ---------- */
  function qr(seed) {
    const n = 25, cell = 112 / n; let h = 7, r = '';
    for (const ch of seed) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    const rnd = () => (h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const fx = x >= n - 7 ? x - (n - 7) : x, fy = y >= n - 7 ? y - (n - 7) : y;
      const inF = (x < 7 || x >= n - 7) && (y < 7 || y >= n - 7) && !(x >= n - 7 && y >= n - 7);
      const sep = !inF && (x <= 7 || x >= n - 8) && (y <= 7 || y >= n - 8) && !(x >= n - 8 && y >= n - 8);
      const on = inF ? (fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx >= 2 && fx <= 4 && fy >= 2 && fy <= 4)) : sep ? false : rnd() < 0.5;
      if (on) r += `<rect x="${(x * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${(cell + 0.15).toFixed(2)}" height="${(cell + 0.15).toFixed(2)}"/>`;
    }
    return `<svg viewBox="0 0 112 112" width="112" height="112" fill="#11131C" aria-label="邀请二维码">${r}</svg>`;
  }
  PAGES.invite = {
    t: '邀请中心', ic: 'userPlus', sub: '邀请好友加入，按一级邀请规则获得收益',
    r() {
      const u = me(), direct = INV[u.id] || [], deep = downline(u.id).length - direct.length, pol = D.referralPolicy;
      const code = 'T' + u.id.toUpperCase() + (u.hue * 37).toString(36).toUpperCase();
      const refLs = (LBU[u.id] || []).filter(l => l.t === 'referral');
      const byF = {}; refLs.forEach(l => { byF[l.f] = (byF[l.f] || 0) + l.a; });
      const inWin = direct.filter(x => D.daysBetween(x.joinDate, TODAY) <= 180).length;
      const isL = u.role === 'leader';
      return `${pol.enabled ? '' : `<div class="banner">${ico('alert')}<div><b>邀请收益已暂停发放</b><div class="muted" style="font-size:13px">平台正在调整邀请规则，期间邀请关系照常记录。</div></div></div>`}
        <div class="grid g21">
          <div class="card inv-card"><div><h3 style="font-size:18px;font-weight:750">邀请好友一起做项目</h3><p class="muted" style="margin-top:4px">好友通过你的链接注册后，你们建立邀请关系，且永久不变。好友注册 180 天内产生的业绩，你可按项目的邀请单价获得收益。</p>
            <div class="inv-link"><code>https://timo.app/j/${code}</code><button class="btn sm pri" data-act="copy" data-v="https://timo.app/j/${code}">${ico('copy', 14)}复制链接</button></div>
            <div class="row" style="margin-top:12px"><button class="btn sm" data-act="poster">${ico('image', 14)}生成分享海报</button><span class="muted" style="font-size:12px">邀请码 <b class="mono">${code}</b></span></div></div>
            <div class="qr">${qr(code)}</div></div>
          <div class="card"><div class="card-h"><h3>邀请单价</h3><span class="sub">每单位业绩</span></div>${D.projects.map(p => `<div class="proj-card"><span class="proj-ic" style="background:${pc(p.id)}">${esc(p.short[0])}</span><div><b style="font-weight:600">${esc(p.name)}</b><div class="muted" style="font-size:12px">按好友的有效${p.metric}计算</div></div><b class="num" style="margin-left:auto">${yen(p.referral)} / ${p.unit}</b></div>`).join('')}</div>
        </div>
        <div class="grid g3">
          <div class="layer"><span class="lv t-pri">1</span><div><b>第一层 · 直接邀请</b><div class="muted" style="font-size:12.5px">${direct.length} 人 · 累计邀请收益 <b class="num" style="color:var(--ink)">${yen(sum(refLs, l => l.a))}</b></div></div></div>
          <div class="layer"><span class="lv t-info">${ico('lock', 18)}</span><div><b>第二层及以下</b><div class="muted" style="font-size:12.5px">${deep} 人 · 仅展示人数，不产生收益</div></div></div>
          <div class="layer"><span class="lv t-ok">${ico('clock', 18)}</span><div><b>有效期内</b><div class="muted" style="font-size:12.5px">${inWin} 人仍在 180 天收益期内</div></div></div>
        </div>
        ${isL ? `<div class="note" style="margin-bottom:16px">${ico('info')}<div>你邀请的成员默认加入你的团队，按<b>团队管理收益</b>计算，邀请收益不叠加。只有被邀请人在其他团队或平台直管时，才产生邀请收益。</div></div>` : ''}
        <div class="card flat"><div class="card-h"><h3>我直接邀请的好友</h3><span class="sub">${direct.length} 人</span></div>
          <div class="tscroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>好友</th><th>注册日期</th><th>收益有效期</th><th>当前归属</th><th class="r">近 30 天活跃</th><th class="r">为我带来的邀请收益</th></tr></thead><tbody>
          ${direct.slice().sort((a, b) => a.joinDate < b.joinDate ? 1 : -1).map(x => { const d = D.daysBetween(x.joinDate, TODAY), left = Math.max(0, 180 - d); return `<tr><td>${who(x, x.status === 'disabled' ? '已停用' : roleOf(x), 28)}</td><td class="num">${x.joinDate}</td><td style="min-width:160px">${left ? `<div class="row" style="font-size:12px"><span class="muted">剩余 ${left} 天</span></div><div class="bar" style="margin-top:4px"><i style="width:${left / 180 * 100}%"></i></div>` : tag('已过期', '')}</td><td>${esc(teamOf(x))}</td><td class="r num">${stat30(x.id, true).days} 天</td><td class="r num"><b>${yen(byF[x.id] || 0)}</b></td></tr>`; }).join('') || `<tr><td colspan="6">${empty('还没有邀请好友', 'userPlus')}</td></tr>`}
          </tbody></table></div></div>`;
    }
  };

  /* ---------- 钱包 ---------- */
  PAGES.wallet = {
    t: '钱包与提现', ic: 'wallet', sub: '已确认收益可随时提现，T+1 到账',
    r() {
      const u = me(), w = wallet(u.id), ws = D.withdrawals.filter(x => x.u === u.id).sort((a, b) => a.at < b.at ? 1 : -1);
      return `<div class="grid g21"><div class="hero"><div class="hero-l">可提现余额</div><div class="hero-v num"><small>¥</small>${w.balance.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="hero-meta"><div><b class="num">${yen(w.confirmed)}</b>累计已确认收益</div><div><b class="num">${yen(w.pending)}</b>待确认</div><div><b class="num">${yen(w.inflight)}</b>处理中</div><div><b class="num">${yen(w.paid)}</b>累计到账</div></div>
          <div class="hero-act"><button class="btn pri" data-act="withdraw">${ico('wallet', 16)}申请提现</button></div></div>
        <div class="card"><div class="card-h"><h3>提现说明</h3></div><div class="stack" style="font-size:13px;color:var(--ink-2)">
          <div class="row">${ico('check', 16)}<span>单笔最低 ¥10，手续费 0.6%（第三方通道费用）</span></div>
          <div class="row">${ico('check', 16)}<span>到账账户：微信零钱（已实名 ${esc(mask(u.name))}）</span></div>
          <div class="row">${ico('check', 16)}<span>财务审批后 T+1 到账，可在下方查看进度</span></div>
          <div class="row">${ico('clock', 16)}<span>待确认收益需等上游账单确认，通常 7–14 天</span></div></div></div></div>
        <div class="card flat"><div class="card-h"><h3>提现记录</h3><span class="sub">${ws.length} 笔</span></div><div class="tscroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>单号</th><th>申请日期</th><th class="r">金额</th><th class="r">手续费</th><th class="r">实际到账</th><th>状态</th></tr></thead><tbody>
          ${ws.map(x => `<tr><td class="mono">${x.id}</td><td class="num">${x.at}</td><td class="r num">${yen(x.amount)}</td><td class="r num muted">${yen(x.fee)}</td><td class="r num"><b>${yen(x.amount - x.fee)}</b></td><td>${tag(x.status, PST[x.status])}${x.reason ? `<div class="muted" style="font-size:12px">${esc(x.reason)}</div>` : ''}</td></tr>`).join('') || `<tr><td colspan="6">${empty('暂无提现记录', 'wallet')}</td></tr>`}
        </tbody></table></div></div>`;
    }
  };
  function withdrawDrawer() {
    const w = wallet(me().id);
    openDrawer({
      title: '申请提现', sub: '可提现 ' + yen(w.balance),
      body: `<label class="field"><span>提现金额</span><div class="row"><input class="input num" id="wd-amt" type="number" min="10" step="0.01" placeholder="最低 ¥10" data-inp="wd" style="font-size:18px;height:44px"><button class="btn" data-act="wd-all">全部</button></div><em id="wd-hint">手续费 0.6%</em></label>
        <div class="calc" id="wd-prev"><div class="eq"><span>实际到账</span><b class="num">¥0.00</b></div></div>
        <label class="field" style="margin-top:16px"><span>到账账户</span><select class="select"><option>微信零钱（${esc(mask(me().name))}）</option><option>银行卡 · 招商银行 尾号 6021</option></select></label>`,
      foot: `<span class="muted" style="font-size:12px;margin-right:auto">提交后不可撤回，财务审批后 T+1 到账</span><button class="btn" data-act="close">取消</button><button class="btn pri" data-act="wd-submit">提交申请</button>`
    });
    setTimeout(() => { const el = $('#wd-amt'); if (el) el.focus(); }, 250);
  }

  /* ---------- 我的团队（团长） ---------- */
  PAGES.team = {
    t: '我的团队', ic: 'users', sub: '成员、入团申请与贡献',
    r() {
      const st = ui('team', { tab: 'members' }), u = me(), ms = teamMembers(u.id), jrs = D.joinRequests.filter(j => j.leaderId === u.id);
      const tl = (LBU[u.id] || []).filter(l => l.t === 'team' && l.d >= ago(29));
      const contrib = {}; tl.forEach(l => { contrib[l.f] = (contrib[l.f] || 0) + l.a; });
      const depth = m => { let k = 1, x = m; while (x.inviterId && x.inviterId !== u.id && k < 9) { x = U(x.inviterId); if (!x || x.staff) return 0; k++; } return x && x.inviterId === u.id ? k : 0; };
      const joinedAt = m => { const x = (D.memBy[m.id] || []).filter(y => y.leaderId === u.id).pop(); return x ? x : { from: m.joinDate, reason: '' }; };
      const deepCount = ms.filter(m => depth(m) >= 2).length;
      return `<div class="grid g4">
          ${kpi({ i: 'users', l: '团队成员', v: ms.length + '<small>人</small>', s: `直接邀请 ${ms.filter(m => m.inviterId === u.id).length} 人` })}
          ${kpi({ i: 'branch', c: 'var(--info)', l: '成员邀请的下线', v: deepCount + '<small>人</small>', s: '同属本团队，仅展示人数' })}
          ${kpi({ i: 'yen', c: tc('team'), l: '近 30 天管理收益', v: yen(sum(tl, l => l.a)), s: '成员业绩 × 团长单价' })}
          ${kpi({ i: 'clock', c: 'var(--ok)', l: '近 30 天活跃成员', v: ms.filter(m => stat30(m.id).days > 0).length + '<small>人</small>', s: '有业绩即计为活跃' })}
        </div>
        <div class="card flat"><div class="tabs" style="padding:0 12px;margin:0"><button class="${st.tab === 'members' ? 'on' : ''}" data-act="set" data-k="team.tab" data-v="members">成员 <span class="muted num">${ms.length}</span></button><button class="${st.tab === 'req' ? 'on' : ''}" data-act="set" data-k="team.tab" data-v="req">入团申请 <span class="muted num">${jrs.length}</span></button></div>
        ${st.tab === 'members' ? `<div class="tscroll"><table class="tbl"><thead><tr><th>成员</th><th>关系</th><th>加入团队</th><th class="r">近 30 天活跃</th><th class="r">近 30 天带来管理收益</th><th></th></tr></thead><tbody>
          ${ms.slice().sort((a, b) => (contrib[b.id] || 0) - (contrib[a.id] || 0)).map(m => { const dp = depth(m), j = joinedAt(m); return `<tr class="click" data-act="user" data-id="${m.id}"><td>${who(m, m.inviterId ? '邀请人 ' + esc(U(m.inviterId).name) : '自然注册', 30)}</td><td>${dp === 1 ? tag('直接邀请', 'pri') : dp >= 2 ? tag(`第 ${dp} 层`, 'info') : tag(j.reason.indexOf('转入') >= 0 ? '随晋升转入' : '申请加入', '')}</td><td class="num">${j.from}</td><td class="r num">${stat30(m.id).days} 天</td><td class="r num"><b>${yen(contrib[m.id] || 0)}</b></td><td class="r">${ico('chevR', 16)}</td></tr>`; }).join('')}
          </tbody></table></div>` : `<div style="padding:16px">${jrs.length ? `<div class="grid g2" style="margin:0">${jrs.map(j => { const x = U(j.userId); return `<div class="card"><div class="row">${who(x, '独立达人 · ' + x.joinDate + ' 注册')}<span class="sp"></span><span class="muted" style="font-size:12px">${j.at}</span></div><p style="margin:12px 0;color:var(--ink-2);font-size:13.5px">“${esc(j.msg)}”</p><div class="row"><span class="muted" style="font-size:12px">近 30 天活跃 ${stat30(x.id, true).days} 天</span><span class="sp"></span><button class="btn sm" data-act="jr-no" data-id="${j.id}">婉拒</button><button class="btn sm pri" data-act="jr-ok" data-id="${j.id}">同意加入</button></div></div>`; }).join('')}</div>` : empty('没有待处理的申请', 'check')}</div>`}
        </div>`;
    }
  };

  /* ---------- 成员关系树 ---------- */
  function treeScope() {
    const t = ui('tree', { mode: 'team', q: '', sel: null, open: {} });
    const isL = S.role === 'leader';
    if (t.mode === 'team') {
      const roots = isL ? [me()] : activeLeaders().concat([{ id: 'IND', name: '平台直管（独立达人）', hue: 220, virtual: true }]);
      const sets = {};
      roots.forEach(r => { const ms = r.virtual ? independents() : teamMembers(r.id); sets[r.id] = { ms, ids: new Set(ms.map(m => m.id)) }; });
      const owner = {};
      roots.forEach(r => sets[r.id].ms.forEach(m => { owner[m.id] = r.id; }));
      const kids = x => {
        if (x.virtual || roots.indexOf(x) >= 0) { const s = sets[x.id]; return s.ms.filter(m => m.inviterId === x.id || !s.ids.has(m.inviterId)); }
        const s = sets[owner[x.id]]; return s ? s.ms.filter(m => m.inviterId === x.id) : [];
      };
      return { roots, kids };
    }
    const roots = isL ? [me()] : D.users.filter(u => !u.staff && (!u.inviterId || U(u.inviterId).staff));
    return { roots, kids: x => INV[x.id] || [] };
  }
  function treeRows() {
    const t = ui('tree'), q = (t.q || '').trim(), sc = treeScope(), rows = [];
    const walk = (u, depth) => { const ks = sc.kids(u); rows.push({ u, depth, n: ks.length }); if (t.open[u.id] || q) ks.forEach(k => walk(k, depth + 1)); };
    sc.roots.forEach(r => walk(r, 0));
    const shown = q ? rows.filter(r => !r.u.virtual && r.u.name.indexOf(q) >= 0) : rows;
    if (!shown.length) return empty('没有匹配的成员', 'search');
    return shown.map(r => {
      const u = r.u, d = q ? 0 : r.depth, open = !!t.open[u.id];
      const meta = u.virtual ? `<span>${r.n} 人</span>` : (u.role === 'leader' ? tag('团长', 'pri', false) : '') + (u.status === 'disabled' ? tag('停用', 'bad', false) : '') + (r.n ? `<span class="num">${r.n}</span>` : '');
      return `<div class="tree-row ${t.sel === u.id ? 'on' : ''}" style="padding-left:${8 + d * 20}px" data-act="tree-sel" data-id="${u.id}">${Array.from({ length: d }, (_, i) => `<span class="guide" style="left:${18 + i * 20}px"></span>`).join('')}
        ${r.n && !q ? `<span class="tw ${open ? 'open' : ''}" data-act="tree-tog" data-id="${u.id}">${ico('chevR', 14)}</span>` : '<span class="tw"></span>'}
        ${u.virtual ? `<span class="av" style="--h:220;width:26px;height:26px;font-size:11px">直</span>` : av(u, 26)}<span class="nm">${esc(u.name)}</span><span class="meta">${meta}</span></div>`;
    }).join('');
  }
  PAGES.tree = {
    t: '成员关系', ic: 'branch', sub: '邀请关系 · 团队归属 · 计酬快照，三种关系分开存',
    r() {
      const t = ui('tree', { mode: 'team', q: '', sel: null, open: {} });
      if (!t.sel) { t.sel = S.role === 'leader' ? me().id : 'L1'; treeScope().roots.forEach(r => { t.open[r.id] = S.role === 'leader' || r.id === 'L1'; }); }
      return `<div class="grid g-tree">
        <div class="card"><div class="card-h"><h3>${t.mode === 'team' ? '团队归属' : '邀请关系'}</h3>${seg('tree.mode', [['team', '按团队'], ['invite', '按邀请']], t.mode)}</div>
          <div class="search" style="margin-bottom:10px">${ico('search', 16)}<input class="input sm" placeholder="搜索成员姓名" value="${esc(t.q)}" data-inp="tree-q"></div>
          <div class="tree" id="tree-list">${treeRows()}</div></div>
        <div class="card" id="tree-prof">${profile(t.sel, { actions: true })}</div></div>`;
    }
  };

  /* ---------- 成员档案（树、成员管理、团队共用） ---------- */
  function profile(uid, opts) {
    const u = U(uid);
    if (!u) return empty('请选择成员', 'user');
    const lid = D.leaderAt(uid, TODAY), inv = u.inviterId ? U(u.inviterId) : null, s = stat30(uid, true);
    const direct = INV[uid] || [], deep = downline(uid).length - direct.length, isL = u.role === 'leader';
    const lastTask = (LBU[uid] || []).filter(l => l.t === 'task').slice(-1)[0];
    const ev = [];
    (D.memBy[uid] || []).forEach(m => ev.push({ d: m.from, c: m.leaderId ? 'var(--primary)' : 'var(--muted)', t: m.leaderId ? '加入 ' + teamName(m.leaderId) : (u.leaderSince && m.from >= u.leaderSince ? '自主带队' : '平台直管'), s: m.reason + (m.to ? ` · ${m.to} 结束` : ' · 当前') }));
    D.roleHist.filter(r => r.userId === uid && r.role === 'leader').forEach(r => ev.push({ d: r.from, c: 'var(--accent)', t: r.reason === '初始团长' ? '成为团长' : '晋升为团长', s: r.reason }));
    if (u.disabledAt) ev.push({ d: u.disabledAt, c: 'var(--bad)', t: '账号停用', s: '此后邀请收益记为平台留存' });
    ev.sort((a, b) => a.d < b.d ? 1 : -1);
    const showPhone = S.role !== 'leader' && S.role !== 'creator';
    const acts = opts && opts.actions && can('manageMembers') && !u.staff && u.status === 'active'
      ? `<div class="row" style="margin-top:16px"><button class="btn sm" data-act="transfer" data-id="${uid}" ${isL ? 'disabled title="团长不可转队"' : ''}>${ico('swap', 14)}调整团队</button><button class="btn sm" data-act="disable" data-id="${uid}">停用账号</button></div>` : '';
    return `<div class="prof">${av(u, 56)}<div><h3>${esc(u.name)}</h3><div class="row" style="gap:6px;margin-top:4px">${tag(roleOf(u), isL ? 'pri' : u.status === 'disabled' ? 'bad' : '')}${u.staff ? '' : tag(teamOf(u), '', false)}</div></div></div>
      <div class="stats"><div><small>近 30 天收益</small><b class="num">${yen(s.earn)}</b></div><div><small>近 30 天活跃</small><b class="num">${s.days} 天</b></div><div><small>直接邀请</small><b class="num">${direct.length} 人</b></div><div><small>间接下线（仅人数）</small><b class="num">${deep} 人</b></div></div>
      ${isL ? `<div class="note" style="margin-bottom:16px">${ico('users')}<div>当前团队 <b>${teamMembers(uid).length}</b> 人，自 ${u.leaderSince} 起担任团长。</div></div>` : ''}
      <div class="sec-t"><h2 style="font-size:14px">三种关系</h2></div>
      <div class="rule-c"><h4><i style="background:var(--info)"></i>邀请关系 <span class="muted" style="font-weight:500;font-size:12px">注册时写入，永不改变</span></h4><p>${inv ? `由 <b>${esc(inv.name)}</b>${inv.staff ? '（员工）' : ''} 邀请，${u.joinDate} 注册` : `自然注册（${u.joinDate}），无邀请人`}</p></div>
      <div class="rule-c"><h4><i style="background:var(--primary)"></i>团队归属 <span class="muted" style="font-weight:500;font-size:12px">会变化，保留全部历史</span></h4><p>${esc(teamOf(u))}${lid === undefined && !u.staff ? '（已离开）' : ''}</p></div>
      <div class="rule-c"><h4><i style="background:var(--accent)"></i>计酬快照 <span class="muted" style="font-weight:500;font-size:12px">按业绩当天的关系计算</span></h4><p>${lastTask ? `最近一笔业绩 ${lastTask.d}：团长 ${lastTask.snap.leader ? esc(U(lastTask.snap.leader).name) : '无'} · 邀请人 ${lastTask.snap.inviter ? esc(U(lastTask.snap.inviter).name) : '无'}` : '暂无业绩'}</p></div>
      <div class="sec-t" style="margin-top:16px"><h2 style="font-size:14px">变更记录</h2></div>
      <ul class="tl">${ev.map(e => `<li style="--c:${e.c}"><b>${esc(e.t)}</b><small>${e.d} · ${esc(e.s)}</small></li>`).join('')}</ul>
      <dl class="kv" style="margin-top:4px"><dt>成员 ID</dt><dd class="mono">${u.id}</dd>${showPhone ? `<dt>手机号</dt><dd class="mono">${u.phone}</dd>` : ''}<dt>参与项目</dt><dd>${D.projects.filter(p => u.projects && u.projects[p.id]).map(p => chipP(p.id)).join(' ') || '—'}</dd>${u.qual ? `<dt>作品合格率</dt><dd class="num">${pct(u.qual)}</dd>` : ''}</dl>${acts}`;
  }
  function openProfile(uid) {
    const u = U(uid);
    openDrawer({ title: u.name, sub: roleOf(u) + ' · ' + teamOf(u), body: profile(uid, { actions: true }), foot: `<button class="btn" data-act="close">关闭</button>` });
  }

  /* ---------- 数据总览（员工） ---------- */
  function flows(from) {
    const fs = factsIn(from, TODAY), ls = D.lines.filter(l => l.d >= from && l.t !== 'incentive' && projOk(l.p));
    return D.projects.filter(p => projOk(p.id)).map(p => {
      const up = sum(fs.filter(f => f.p === p.id), f => f.up), pl = ls.filter(l => l.p === p.id);
      const task = sum(pl.filter(l => l.t === 'task'), l => l.a), team = sum(pl.filter(l => l.t === 'team'), l => l.a), ref = sum(pl.filter(l => l.t === 'referral'), l => l.a);
      return { p, up, task, team, ref, keep: up - task - team - ref };
    });
  }
  function sankeyOf(fl, dark, o) {
    return C.sankey({
      left: fl.map(x => ({ id: x.p.id, label: x.p.short, color: pc(x.p.id, dark) })),
      right: [{ id: 'task', label: '成员任务收益', color: tc('task', dark) }, { id: 'team', label: '团长管理收益', color: tc('team', dark) }, { id: 'keep', label: '平台留存', color: keepC(dark) }, { id: 'referral', label: '邀请收益', color: tc('referral', dark) }],
      links: [].concat.apply([], fl.map(x => [{ s: x.p.id, t: 'task', v: x.task }, { s: x.p.id, t: 'team', v: x.team }, { s: x.p.id, t: 'referral', v: x.ref }, { s: x.p.id, t: 'keep', v: x.keep }])),
      fmt: yenS, w: (o && o.w) || 760, h: (o && o.h) || 300, pl: 70, pr: 170
    });
  }
  PAGES.overview = {
    t: '数据总览', ic: 'chart', sub: '上游收入 → 成员收益 → 平台留存',
    r() {
      const st = ui('ov', { range: 30 }), from = ago(st.range - 1), pfrom = ago(st.range * 2 - 1), pto = ago(st.range);
      const fs = factsIn(from, TODAY), pfs = factsIn(pfrom, pto);
      const up = sum(fs, f => f.up), pup = sum(pfs, f => f.up);
      const fl = flows(from), pay = sum(fl, x => x.task + x.team + x.ref), keep = up - pay;
      const inc = sum(D.lines.filter(l => l.t === 'incentive' && l.d >= from), l => l.a);
      const act = new Set(fs.map(f => f.u)).size, pact = new Set(pfs.map(f => f.u)).size;
      const days = dayList(from, TODAY), idx = {}; days.forEach((d, i) => { idx[d] = i; });
      const series = D.projects.filter(p => projOk(p.id)).map(p => { const v = days.map(() => 0); fs.forEach(f => { if (f.p === p.id) v[idx[f.d]] += f.up; }); return { name: p.name, color: pc(p.id), values: v.map(D.r2) }; });
      const vz = viz('ov-trend', () => chLegend(series) + `<div style="margin-top:10px">${C.line({ labels: days.map(md), series, w: 760, h: 240, yFmt: yenS, fmt: yen })}</div>`, () => seriesTable(days.map(md), series));
      const teamUp = {}; D.lines.filter(l => l.d >= from && projOk(l.p) && (l.t === 'team' || l.rule === 'leader_self')).forEach(l => { teamUp[l.u] = (teamUp[l.u] || 0) + D.P[l.p].up * l.q; });
      const ranks = activeLeaders().map(L => ({ label: L.name, value: D.r2(teamUp[L.id] || 0) })).sort((a, b) => b.value - a.value);
      const ret = D.retained.filter(r => r.d >= from && projOk(r.p)), retBy = {};
      ret.forEach(r => { retBy[r.reason] = (retBy[r.reason] || 0) + r.a; });
      const RET_S = { no_team: '无团长差价', referral_window_expired: '邀请满 180 天', inviter_unavailable: '邀请人注销' };
      const retItems = [{ label: '项目单价差', value: D.r2(keep - sum(ret, r => r.a)) }].concat(Object.keys(RET).map(k => ({ label: RET_S[k], value: D.r2(retBy[k] || 0) })));
      return `<div class="row wrap" style="margin-bottom:16px">${seg('ov.range', [[7, '近 7 天'], [30, '近 30 天'], [90, '近 90 天']], st.range)}<span class="sp"></span><span class="muted" style="font-size:12.5px">${D.projects.map(p => `${p.short}同步 ${p.sync}`).join(' · ')}</span></div>
        <div class="grid g4">
          ${kpi({ i: 'yen', l: '上游收入', v: yenS(up), s: trend(pup ? up / pup - 1 : NaN) + '较上一周期' })}
          ${kpi({ i: 'users', c: tc('task'), l: '成员收益支出', v: yenS(pay), s: `占上游 ${pct(up ? pay / up : 0)} · 另有激励 ${yenS(inc)}` })}
          ${kpi({ i: 'shield', c: 'var(--ok)', l: '平台留存', v: yenS(keep), s: `留存率 ${pct(up ? keep / up : 0)}` })}
          ${kpi({ i: 'spark', c: 'var(--accent)', l: '活跃成员', v: act + '<small>人</small>', s: trend(pact ? act / pact - 1 : NaN) + '较上一周期' })}
        </div>
        <div class="grid g21"><div class="card"><div class="card-h"><h3>上游收入趋势</h3><span class="sub">按项目 · 每日</span>${vz.tog}</div>${vz.body}</div>
          <div class="card"><div class="card-h"><h3>待办</h3></div>${todoList(todos())}</div></div>
        <div class="grid g21"><div class="card"><div class="card-h"><h3>资金流向</h3><span class="sub">每笔业绩最多付给两方，其余为平台留存</span></div>${fl.some(x => x.up) ? sankeyOf(fl) : empty('暂无数据')}</div>
          <div class="card"><div class="card-h"><h3>平台留存构成</h3></div>${C.hbars(retItems, yenS)}<div class="note" style="margin-top:14px">${ico('info')}<div>独立达人没有团长，团长那份记为平台留存；邀请超过 180 天或邀请人注销后，邀请收益同样留存。</div></div></div></div>
        <div class="grid g2"><div class="card"><div class="card-h"><h3>团队排行</h3><span class="sub">团队上游贡献</span></div>${C.hbars(ranks, yenS)}</div>
          <div class="card flat"><div class="card-h"><h3>项目明细</h3></div><div class="tscroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>项目</th><th class="r">上游</th><th class="r">成员任务</th><th class="r">团长管理</th><th class="r">邀请</th><th class="r">留存率</th></tr></thead><tbody>${fl.map(x => `<tr><td>${chipP(x.p.id)}</td><td class="r num">${yenS(x.up)}</td><td class="r num">${yenS(x.task)}</td><td class="r num">${yenS(x.team)}</td><td class="r num">${yenS(x.ref)}</td><td class="r num"><b>${pct(x.up ? x.keep / x.up : 0)}</b></td></tr>`).join('')}</tbody></table></div></div></div>`;
    }
  };

  /* ---------- 成员管理 ---------- */
  function memFiltered() {
    const st = ui('mem', { q: '', kind: 'all', team: 'all', limit: 25 });
    return D.users.filter(u => !u.staff).filter(u => {
      if (st.q && u.name.indexOf(st.q) < 0 && u.id.indexOf(st.q) < 0) return false;
      const r = roleOf(u);
      if (st.kind === 'creator' && r !== '达人') return false;
      if (st.kind === 'leader' && r !== '团长') return false;
      if (st.kind === 'ind' && r !== '独立达人') return false;
      if (st.kind === 'disabled' && r !== '已停用') return false;
      if (st.team !== 'all') { const l = D.leaderAt(u.id, TODAY); if (st.team === 'IND' ? !(l === null && u.role !== 'leader') : !(l === st.team || u.id === st.team)) return false; }
      return true;
    }).sort((a, b) => a.joinDate < b.joinDate ? 1 : -1);
  }
  function memTable() {
    const st = ui('mem'), list = memFiltered();
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>成员</th><th>身份</th><th>当前团队</th><th>邀请人</th><th>注册日期</th><th class="r">近 30 天活跃</th><th class="r">近 30 天收益</th><th></th></tr></thead><tbody>
      ${list.slice(0, st.limit).map(u => { const s = stat30(u.id, true), r = roleOf(u); return `<tr class="click" data-act="user" data-id="${u.id}"><td>${who(u, `<span class="mono">${u.id}</span>`, 30)}</td><td>${tag(r, r === '团长' ? 'pri' : r === '已停用' ? 'bad' : r === '独立达人' ? 'info' : '')}</td><td>${esc(teamOf(u))}</td><td>${u.inviterId ? esc(U(u.inviterId).name) : '<span class="muted">—</span>'}</td><td class="num">${u.joinDate}</td><td class="r num">${s.days} 天</td><td class="r num"><b>${yen(s.earn)}</b></td><td class="r">${ico('chevR', 16)}</td></tr>`; }).join('') || `<tr><td colspan="8">${empty('没有符合条件的成员', 'search')}</td></tr>`}
      </tbody></table></div>${moreBtn('mem', st.limit, list.length)}`;
  }
  PAGES.members = {
    t: '成员管理', ic: 'user', sub: '检索、调整团队、停用账号；所有操作留痕',
    r() {
      const st = ui('mem', { q: '', kind: 'all', team: 'all', limit: 25 }), all = D.users.filter(u => !u.staff);
      const newM = all.filter(u => u.joinDate >= MONTH).length;
      return `<div class="grid g4">
          ${kpi({ i: 'users', l: '成员总数', v: all.length + '<small>人</small>', s: `本月新增 ${newM} 人` })}
          ${kpi({ i: 'trophy', c: 'var(--accent)', l: '团长', v: activeLeaders().length + '<small>人</small>', s: '含 1 位本季晋升' })}
          ${kpi({ i: 'user', c: 'var(--info)', l: '独立达人', v: independents().length + '<small>人</small>', s: '平台直管，团长那份留存' })}
          ${kpi({ i: 'alert', c: 'var(--bad)', l: '已停用', v: all.filter(u => u.status === 'disabled').length + '<small>人</small>', s: '历史关系与收益保留' })}
        </div>
        <div class="card flat"><div class="row wrap" style="padding:16px 20px 4px">
          <div class="search" style="width:240px">${ico('search', 16)}<input class="input sm" placeholder="姓名或成员 ID" value="${esc(st.q)}" data-inp="mem-q"></div>
          ${seg('mem.kind', [['all', '全部'], ['creator', '达人'], ['leader', '团长'], ['ind', '独立达人'], ['disabled', '已停用']], st.kind)}
          <select class="select input sm" style="width:auto" data-inp="mem-team"><option value="all">全部团队</option>${activeLeaders().map(L => `<option value="${L.id}" ${st.team === L.id ? 'selected' : ''}>${esc(L.name)}团队</option>`).join('')}<option value="IND" ${st.team === 'IND' ? 'selected' : ''}>平台直管</option></select>
          <span class="sp"></span>${can('manageMembers') ? '' : tag('只读', '', false)}</div>
          <div id="mem-list" style="margin-top:12px">${memTable()}</div></div>`;
    }
  };

  /* ---------- 晋升工作台 ---------- */
  function promoCheck(u) {
    const s = stat30(u.id, true), inv = (INV[u.id] || []).length;
    return [
      { l: '近 30 天活跃 ≥ 20 天', v: s.days + ' 天', ok: s.days >= 20 },
      { l: '作品合格率 ≥ 92%', v: pct(u.qual), ok: u.qual >= 0.92 },
      { l: '直接邀请 ≥ 2 人', v: inv + ' 人', ok: inv >= 2 },
      { l: '近 30 天任务收益 ≥ ¥300', v: yen(s.task), ok: s.task >= 300 }
    ];
  }
  PAGES.promotions = {
    t: '晋升工作台', ic: 'trophy', sub: '系统候选 → 运营提名 → 管理员审批；拟定人不能审批',
    r() {
      const cols = [['candidate', '候选', 'var(--info)'], ['review', '待审批', 'var(--warn)'], ['done', '已完成', 'var(--ok)']];
      return `<div class="note" style="margin-bottom:16px">${ico('info')}<div>晋升后：<b>邀请关系不变</b>；其直接邀请、且仍在原团队的成员默认随迁，可逐个选择留下；原团长不再从晋升者及其团队获得收益，如需认可培养可发一次性奖励。</div></div>
        <div class="kan">${cols.map(c => { const ps = D.promos.filter(p => p.stage === c[0]); return `<div class="kcol"><div class="kcol-h"><span class="tag" style="background:color-mix(in srgb, ${c[2]} 14%, transparent);color:${c[2]};border:0"><span class="d"></span>${c[1]}</span><span class="n">${ps.length}</span></div>
          ${ps.map(p => { const u = U(p.userId), ck = promoCheck(u), pass = ck.filter(x => x.ok).length, s = stat30(u.id, true); return `<div class="kcard" data-act="promo" data-id="${p.id}"><div class="row">${who(u, esc(teamOf(u)), 30)}<span class="sp"></span><span class="mono muted" style="font-size:11px">${p.id}</span></div>
            <div class="kmet"><div><small>活跃天数</small><b class="num">${s.days}</b></div><div><small>合格率</small><b class="num">${pct(u.qual, 0)}</b></div><div><small>标准达成</small><b class="num ${pass === 4 ? 'ok' : ''}">${pass}/4</b></div></div>
            <div class="row" style="margin-top:10px;font-size:12px">${tag(p.source, p.source === '运营提名' ? 'acc' : '', false)}<span class="sp"></span>${p.stage === 'done' ? (p.result === 'approved' ? tag('已通过', 'ok') : tag('未通过', 'bad')) : `<span class="muted">${p.at}</span>`}</div></div>`; }).join('') || empty('暂无')}
          </div>`; }).join('')}</div>`;
    }
  };
  function openPromo(id) {
    const p = D.promos.find(x => x.id === id), u = U(p.userId), ck = promoCheck(u), lid = D.leaderAt(u.id, TODAY);
    const follow = (INV[u.id] || []).filter(x => x.status === 'active' && lid && D.leaderAt(x.id, TODAY) === lid);
    const isProposer = p.proposer === me().id;
    let foot = `<button class="btn" data-act="close">关闭</button>`;
    if (p.stage === 'candidate' && can('nominate')) foot = `<button class="btn" data-act="close">稍后</button><button class="btn pri" data-act="promo-nom" data-id="${id}">提名，提交审批</button>`;
    if (p.stage === 'review') foot = can('approvePromo') ? (isProposer ? `<span class="muted" style="font-size:12px;margin-right:auto">${ico('lock', 14)} 你是拟定人，不能审批自己的提名</span><button class="btn" data-act="close">关闭</button>` : `<button class="btn" data-act="promo-no" data-id="${id}">驳回</button><button class="btn pri" data-act="promo-ok" data-id="${id}">批准晋升</button>`) : `<span class="muted" style="font-size:12px;margin-right:auto">等待超级管理员审批</span><button class="btn" data-act="close">关闭</button>`;
    openDrawer({
      title: '晋升 · ' + u.name, sub: `${p.id} · ${p.source} · ${teamOf(u)}`,
      body: `<div class="steps">${['候选', '提名', '审批'].map((x, i) => `<div class="${i <= ({ candidate: 0, review: 1, done: 2 })[p.stage] ? 'on' : ''}"></div>`).join('')}</div>
        <div class="sec-t"><h2 style="font-size:14px">公开标准</h2><span class="muted" style="font-size:12px">达成 ${ck.filter(x => x.ok).length}/4</span></div>
        ${ck.map(x => `<div class="rule-c row"><span style="color:var(--${x.ok ? 'ok' : 'bad'})">${ico(x.ok ? 'check' : 'x', 16)}</span><span>${x.l}</span><span class="sp"></span><b class="num">${x.v}</b>${tag(x.ok ? '达成' : '未达成', x.ok ? 'ok' : 'bad', false)}</div>`).join('')}
        ${p.stage === 'done' ? `<div class="note ${p.result === 'approved' ? 'ok' : 'warn'}" style="margin-top:12px">${ico(p.result === 'approved' ? 'check' : 'alert')}<div><b>${p.result === 'approved' ? '已批准' : '未通过'}</b> · ${esc(U(p.decidedBy).name)}${p.decidedAt ? ' · ' + p.decidedAt : ''}<br>${esc(p.reason)}</div></div>` : `
        <div class="sec-t" style="margin-top:16px"><h2 style="font-size:14px">随迁成员</h2><span class="muted" style="font-size:12px">直接邀请且仍在原团队 · ${follow.length} 人</span></div>
        ${follow.length ? follow.map(x => `<label class="rule-c row" style="cursor:pointer"><input type="checkbox" class="pf" value="${x.id}" checked style="width:16px;height:16px;accent-color:var(--primary)">${who(x, '近 30 天活跃 ' + stat30(x.id, true).days + ' 天', 28)}<span class="sp"></span><span class="muted" style="font-size:12px">取消勾选 = 留在原团队</span></label>`).join('') : `<div class="muted" style="font-size:13px">无需随迁</div>`}
        ${p.stage === 'review' ? `<dl class="kv" style="margin-top:16px"><dt>提名人</dt><dd>${esc(U(p.proposer).name)}</dd><dt>提名日期</dt><dd class="num">${p.at}</dd></dl>` : ''}`}`,
      foot
    });
  }

  /* ---------- 团队激励 ---------- */
  const TIER = { A: { amt: 1200, cls: 'ok', t: '合格率 ≥ 94% 且团队活跃度 ≥ 80%' }, B: { amt: 600, cls: 'pri', t: '合格率 ≥ 90% 且团队活跃度 ≥ 65%' }, C: { amt: 0, cls: '', t: '未达标准，本月不发放' } };
  PAGES.incentives = {
    t: '团队激励', ic: 'gift', sub: '公开标准评定 · 运营拟定 → 财务复核 → 入账',
    r() {
      const st = ui('inc', { b: D.incBatches[D.incBatches.length - 1].id });
      const b = D.incBatches.find(x => x.id === st.b), items = D.incItems.filter(i => i.batch === b.id);
      const stepOn = { draft: 1, review: 2, posted: 4 }[b.status];
      const editable = b.status === 'draft' && can('draftIncentive');
      let acts = '';
      if (b.status === 'draft' && can('draftIncentive')) acts = `<button class="btn pri" data-act="inc-submit">${ico('send', 16)}拟定完成，提交复核</button>`;
      if (b.status === 'review' && can('reviewIncentive')) acts = b.proposer === me().id ? `<span class="muted" style="font-size:12.5px">${ico('lock', 14)} 你是拟定人，需由他人复核</span>` : `<button class="btn" data-act="inc-back">退回修改</button><button class="btn pri" data-act="inc-post">${ico('check', 16)}复核通过并入账</button>`;
      if (!acts && b.status !== 'posted') acts = `<span class="muted" style="font-size:12.5px">${b.status === 'draft' ? '等待运营拟定' : '等待财务复核'}</span>`;
      const total = sum(items, i => i.amount);
      return `<div class="grid g3">${Object.keys(TIER).map(k => `<div class="rule-c" style="margin:0"><h4>${tag(k + ' 档', TIER[k].cls, false)}<span class="num">${TIER[k].amt ? yen0(TIER[k].amt) + ' 起' : '¥0'}</span></h4><p>${TIER[k].t}</p></div>`).join('')}</div>
        <div class="note" style="margin-bottom:16px">${ico('shield')}<div>团队激励只看公开的定性指标（作品合格率、团队活跃度），<b>不与下线收入挂钩</b>，评定说明对团长可见。拟定与复核必须是不同人员。</div></div>
        <div class="row wrap" style="margin-bottom:12px">${seg('inc.b', D.incBatches.slice().reverse().map(x => [x.id, x.month.replace('-', ' 年 ') + ' 月']), st.b)}</div>
        <div class="card"><div class="card-h"><h3>${b.id}</h3>${tag({ draft: '草稿', review: '待复核', posted: '已入账' }[b.status], { draft: '', review: 'warn', posted: 'ok' }[b.status])}<div class="row">${acts}</div></div>
          <div class="steps" style="margin-bottom:6px">${[0, 1, 2, 3].map(i => `<div class="${i < stepOn ? 'on' : ''}"></div>`).join('')}</div>
          <div class="row muted" style="font-size:12px;margin-bottom:18px">${['生成草稿 ' + b.created, '运营拟定' + (b.proposer ? ' · ' + U(b.proposer).name : ''), '财务复核' + (b.reviewer ? ' · ' + U(b.reviewer).name : ''), '入账' + (b.postedAt ? ' ' + b.postedAt : '')].map(x => `<span style="flex:1">${esc(x)}</span>`).join('')}</div>
          <div class="row" style="gap:28px;margin-bottom:12px"><div><small class="muted">合计金额</small><div style="font-size:22px;font-weight:750" class="num">${yen(total)}</div></div><div><small class="muted">发放人数</small><div style="font-size:22px;font-weight:750" class="num">${items.filter(i => i.amount > 0).length} / ${items.length}</div></div></div>
          <div class="tscroll"><table class="tbl"><thead><tr><th>团长</th><th class="r">作品合格率</th><th class="r">团队活跃度</th><th>档位</th><th class="r">金额</th><th>评定说明（团长可见）</th></tr></thead><tbody>
          ${items.map((i, k) => `<tr><td>${who(U(i.leaderId), teamMembers(i.leaderId).length + ' 位成员', 28)}</td><td class="r num">${pct(i.qual)}</td><td class="r num">${pct(i.active, 0)}</td><td>${editable ? `<select class="select input sm" style="width:84px" data-inp="tier" data-i="${D.incItems.indexOf(i)}">${['A', 'B', 'C'].map(t => `<option ${t === i.tier ? 'selected' : ''}>${t}</option>`).join('')}</select>` : tag(i.tier + ' 档', TIER[i.tier].cls, false)}</td><td class="r num"><b>${yen(i.amount)}</b></td><td style="font-size:12.5px;color:var(--ink-2)">${esc(i.note)}</td></tr>`).join('')}
          </tbody></table></div></div>`;
    }
  };

  /* ---------- 账单结算 ---------- */
  function stBreakdown(s) {
    const ls = D.lines.filter(l => l.p === s.p && l.d >= s.start && l.d <= s.end && l.t !== 'incentive');
    const task = sum(ls.filter(l => l.t === 'task'), l => l.a), team = sum(ls.filter(l => l.t === 'team'), l => l.a), ref = sum(ls.filter(l => l.t === 'referral'), l => l.a);
    return { task, team, ref, keep: s.up - task - team - ref, n: ls.length };
  }
  PAGES.settlement = {
    t: '账单结算', ic: 'receipt', sub: '核对上游账单，确认后成员收益转为可提现',
    r() {
      const st = ui('set', { s: 'pending', limit: 30 });
      const all = D.statements.filter(s => projOk(s.p)), list = st.s === 'all' ? all : all.filter(s => s.status === st.s);
      const pend = all.filter(s => s.status === 'pending'), mConf = all.filter(s => s.status === 'confirmed' && s.end >= MONTH);
      const sel = list.filter(s => S.sel.has(s.id) && s.status === 'pending');
      return `<div class="grid g4">
          ${kpi({ i: 'clock', c: 'var(--warn)', l: '待确认账单', v: pend.length + '<small>张</small>', s: '上游金额 ' + yen(sum(pend, s => s.up)) })}
          ${kpi({ i: 'check', c: 'var(--ok)', l: '本月已确认', v: yenS(sum(mConf, s => s.up)), s: mConf.length + ' 张账单' })}
          ${kpi({ i: 'users', c: tc('task'), l: '待确认成员收益', v: yenS(sum(pend, s => { const b = stBreakdown(s); return b.task + b.team + b.ref; })), s: '确认后进入成员余额' })}
          ${kpi({ i: 'shield', c: 'var(--info)', l: '核对差异', v: '¥0.00', s: '与上游报表逐日比对' })}
        </div>
        <div class="card flat"><div class="row wrap" style="padding:16px 20px 4px">${seg('set.s', [['pending', '待确认'], ['confirmed', '已确认'], ['all', '全部']], st.s)}<span class="sp"></span>${can('settle') ? `<button class="btn pri" data-act="st-batch" ${sel.length ? '' : 'disabled'}>${ico('check', 16)}确认选中账单${sel.length ? `（${sel.length}）` : ''}</button>` : tag('只读', '', false)}</div>
          <div class="tscroll" style="margin-top:12px"><table class="tbl"><thead><tr>${can('settle') ? `<th class="c"><input type="checkbox" data-act="sel-all" data-k="st" ${sel.length && sel.length === list.filter(s => s.status === 'pending').length ? 'checked' : ''}></th>` : ''}<th>账单号</th><th>项目</th><th>周期</th><th class="r">业绩量</th><th class="r">上游金额</th><th class="r">成员收益</th><th class="r">平台留存</th><th>状态</th></tr></thead><tbody>
          ${list.slice(0, st.limit).map(s => { const b = stBreakdown(s); return `<tr class="click" data-act="st" data-id="${s.id}">${can('settle') ? `<td class="c">${s.status === 'pending' ? `<input type="checkbox" data-act="sel" data-id="${s.id}" ${S.sel.has(s.id) ? 'checked' : ''}>` : ''}</td>` : ''}<td class="mono">${s.id}</td><td>${chipP(s.p)}</td><td class="num">${md(s.start)} ~ ${md(s.end)}</td><td class="r num">${int(s.q)} ${D.P[s.p].unit}</td><td class="r num"><b>${yen(s.up)}</b></td><td class="r num">${yen(b.task + b.team + b.ref)}</td><td class="r num">${yen(b.keep)}</td><td>${s.status === 'pending' ? tag('待确认', 'warn') : tag('已确认', 'ok') + ` <span class="muted" style="font-size:12px">${esc(U(s.by).name)}</span>`}</td></tr>`; }).join('') || `<tr><td colspan="9">${empty('没有账单', 'receipt')}</td></tr>`}
          </tbody></table></div>${moreBtn('set', st.limit, list.length)}</div>`;
    }
  };
  function openStatement(id) {
    const s = D.statements.find(x => x.id === id), b = stBreakdown(s), p = D.P[s.p];
    openDrawer({
      title: s.id, sub: `${p.name} · ${s.start} 至 ${s.end}`,
      body: `<div class="calc"><div class="eq"><span>上游金额</span><b class="num">${yen(s.up)}</b><span>${int(s.q)} ${p.unit} × ${yen(p.up)}</span></div></div>
        <div class="sec-t" style="margin-top:18px"><h2 style="font-size:14px">分配</h2><span class="muted" style="font-size:12px">${b.n} 笔收益流水</span></div>
        ${C.hbars([{ label: '成员任务收益', value: b.task, color: tc('task') }, { label: '团长管理收益', value: b.team, color: tc('team') }, { label: '邀请收益', value: b.ref, color: tc('referral') }, { label: '平台留存', value: b.keep, color: keepC() }], yen)}
        <div class="note ok" style="margin-top:16px">${ico('check')}<div>与上游报表逐日核对一致，差异 ¥0.00。${s.status === 'pending' ? '确认后，这 ' + b.n + ' 笔收益转为「已确认」，成员可提现。' : `已由 ${esc(U(s.by).name)} 确认。`}</div></div>`,
      foot: s.status === 'pending' && can('settle') ? `<button class="btn" data-act="close">取消</button><button class="btn pri" data-act="st-ok" data-id="${s.id}">确认账单</button>` : `<button class="btn" data-act="close">关闭</button>`
    });
  }
  function confirmStatements(ids) {
    let n = 0;
    ids.forEach(id => {
      const s = D.statements.find(x => x.id === id);
      if (!s || s.status !== 'pending') return;
      s.status = 'confirmed'; s.by = me().id;
      D.lines.forEach(l => { if (l.p === s.p && l.d >= s.start && l.d <= s.end && l.st === 'pending') { l.st = 'confirmed'; n++; } });
      log('确认账单', s.id, `上游 ${yen(s.up)}，与报表一致`);
    });
    ids.forEach(id => S.sel.delete(id));
    return n;
  }

  /* ---------- 提现审批 ---------- */
  PAGES.payouts = {
    t: '提现审批', ic: 'send', sub: '审批 → 打款，驳回需填写原因',
    r() {
      const st = ui('pay', { s: '待审批' }), ss = ['待审批', '待打款', '已打款', '已驳回', '全部'];
      const list = D.withdrawals.filter(w => st.s === '全部' || w.status === st.s).sort((a, b) => a.at < b.at ? 1 : -1);
      const actionable = list.filter(w => w.status === '待审批' || w.status === '待打款');
      const sel = actionable.filter(w => S.sel.has(w.id));
      const batchLabel = st.s === '待打款' ? '批量打款' : '批量通过';
      return `<div class="card flat"><div class="tabs" style="padding:0 12px;margin:0">${ss.map(s => `<button class="${st.s === s ? 'on' : ''}" data-act="set" data-k="pay.s" data-v="${s}">${s}<span class="muted num">${s === '全部' ? D.withdrawals.length : D.withdrawals.filter(w => w.status === s).length}</span></button>`).join('')}</div>
        ${(st.s === '待审批' || st.s === '待打款') && can('payout') ? `<div class="row" style="padding:12px 20px 0"><span class="muted" style="font-size:13px">已选 ${sel.length} 笔 · ${yen(sum(sel, w => w.amount))}</span><span class="sp"></span><button class="btn pri" data-act="wd-batch" ${sel.length ? '' : 'disabled'}>${batchLabel}</button></div>` : ''}
        <div class="tscroll" style="margin-top:12px"><table class="tbl"><thead><tr>${can('payout') && actionable.length ? `<th class="c"><input type="checkbox" data-act="sel-all" data-k="pay" ${sel.length && sel.length === actionable.length ? 'checked' : ''}></th>` : ''}<th>单号</th><th>申请人</th><th>申请日期</th><th class="r">金额</th><th class="r">手续费</th><th>余额校验</th><th>状态</th><th class="r">操作</th></tr></thead><tbody>
        ${list.map(w => { const u = U(w.u), bal = wallet(w.u).balance; return `<tr>${can('payout') && actionable.length ? `<td class="c">${w.status === '待审批' || w.status === '待打款' ? `<input type="checkbox" data-act="sel" data-id="${w.id}" ${S.sel.has(w.id) ? 'checked' : ''}>` : ''}</td>` : ''}<td class="mono">${w.id}</td><td>${who(u, esc(roleOf(u)), 28)}</td><td class="num">${w.at}</td><td class="r num"><b>${yen(w.amount)}</b></td><td class="r num muted">${yen(w.fee)}</td><td>${bal >= 0 ? `<span class="ok" style="font-size:12.5px">${ico('check', 14)}</span> <span style="font-size:12.5px">通过</span>` : `<span class="bad" style="font-size:12.5px">${ico('alert', 14)}</span> <span style="font-size:12.5px">余额不足</span>`}</td><td>${tag(w.status, PST[w.status])}${w.reason ? `<div class="muted" style="font-size:12px">${esc(w.reason)}</div>` : ''}</td>
          <td class="r" style="white-space:nowrap">${can('payout') && w.status === '待审批' ? `<button class="btn sm" data-act="wd-no" data-id="${w.id}">驳回</button> <button class="btn sm pri" data-act="wd-ok" data-id="${w.id}">通过</button>` : can('payout') && w.status === '待打款' ? `<button class="btn sm pri" data-act="wd-pay" data-id="${w.id}">打款</button>` : '<span class="muted">—</span>'}</td></tr>`; }).join('') || `<tr><td colspan="9">${empty('没有记录', 'send')}</td></tr>`}
        </tbody></table></div></div>`;
    }
  };

  /* ---------- 计费规则 ---------- */
  PAGES.rules = {
    t: '计费规则', ic: 'sliders', sub: '项目单价与邀请策略；调整需他人审批，只对新业绩生效',
    r() {
      const pol = D.referralPolicy, rps = D.rateProposals.slice().reverse();
      const FL = { creator: '达人单价', leader: '团长单价', referral: '邀请单价', up: '上游单价' };
      return `<div class="card flat"><div class="card-h"><h3>项目单价</h3><span class="sub">每单位有效业绩</span></div><div class="tscroll" style="margin-top:12px"><table class="tbl"><thead><tr><th>项目</th><th>计量</th><th class="r">上游单价</th><th class="r">达人</th><th class="r">团长</th><th class="r">邀请</th><th class="r">平台留存 / 单位</th><th class="r">留存率</th><th>状态</th><th></th></tr></thead><tbody>
        ${D.projects.map(p => { const k = p.up - p.creator - p.leader - p.referral; return `<tr><td>${chipP(p.id)} <span class="muted" style="font-size:12px">${esc(p.name)}</span></td><td>${p.metric}（${p.unit}）</td><td class="r num">${yen(p.up)}</td><td class="r num">${yen(p.creator)}</td><td class="r num">${yen(p.leader)}</td><td class="r num">${yen(p.referral)}</td><td class="r num"><b>${yen(k)}</b></td><td class="r num">${pct(k / p.up)}</td><td>${tag(p.status, p.status === '运行中' ? 'ok' : 'warn')}</td><td class="r">${can('proposeRate') ? `<button class="btn sm" data-act="rate-edit" data-id="${p.id}">${ico('edit', 14)}提议调整</button>` : ''}</td></tr>`; }).join('')}
        </tbody></table></div></div>
        <div class="grid g2" style="margin-top:16px">
          <div class="card"><div class="card-h"><h3>邀请收益策略</h3></div>
            <div class="rule-c row"><div><h4>发放邀请收益</h4><p>关闭后邀请关系照常记录，邀请收益记为平台留存</p></div><span class="sp"></span><button class="switch ${pol.enabled ? 'on' : ''}" data-act="ref-switch" ${can('referralSwitch') ? '' : 'disabled'} aria-label="发放邀请收益"></button></div>
            <div class="rule-c row"><div><h4>收益有效期</h4><p>自被邀请人注册日起计算</p></div><span class="sp"></span><b class="num">${pol.windowDays} 天</b></div>
            <div class="rule-c row"><div><h4>${ico('lock', 14)} 收款方上限：两方</h4><p>业绩当天的团长 + 直接邀请人；第 2 层及以下只记录、不计酬</p></div><span class="sp"></span>${tag('合规锁定', 'info', false)}</div>
            <div class="rule-c row"><div><h4>${ico('lock', 14)} 邀请人即团长时不叠加</h4><p>同一笔业绩不重复付给同一人</p></div><span class="sp"></span>${tag('合规锁定', 'info', false)}</div>
          </div>
          <div class="card"><div class="card-h"><h3>调整提议</h3><span class="sub">提议人不能审批自己的提议</span></div>
            ${rps.map(r => `<div class="rule-c"><div class="row"><b class="mono">${r.id}</b>${chipP(r.p)}<span class="sp"></span>${tag({ pending: '待审批', approved: '已生效', rejected: '已驳回' }[r.status], { pending: 'warn', approved: 'ok', rejected: 'bad' }[r.status])}</div>
              <p style="margin-top:6px">${FL[r.field]}：<span class="num">${yen(r.from)}</span> → <b class="num">${yen(r.to)}</b> · ${esc(U(r.by).name)} · ${r.at}</p><p class="muted" style="font-size:12.5px">${esc(r.reason)}</p>
              ${r.status === 'pending' ? `<div class="row" style="margin-top:10px">${can('approveRate') && r.by !== me().id ? `<span class="sp"></span><button class="btn sm" data-act="rp-no" data-id="${r.id}">驳回</button><button class="btn sm pri" data-act="rp-ok" data-id="${r.id}">批准生效</button>` : `<span class="muted" style="font-size:12px">${r.by === me().id ? '等待他人审批' : '等待超级管理员审批'}</span>`}</div>` : ''}</div>`).join('') || empty('暂无提议', 'sliders')}
          </div></div>`;
    }
  };
  function rateDrawer(pid) {
    const p = D.P[pid];
    openDrawer({
      title: '提议调整 · ' + p.name, sub: `上游单价 ${yen(p.up)} / ${p.unit}`,
      body: `${['creator', 'leader', 'referral'].map(f => `<label class="field"><span>${{ creator: '达人单价', leader: '团长单价', referral: '邀请单价' }[f]}</span><input class="input num" type="number" step="0.01" min="0" id="r-${f}" value="${p[f]}" data-inp="rate" data-p="${pid}"><em>当前 ${yen(p[f])}</em></label>`).join('')}
        <div class="calc" id="rate-prev"></div>
        <label class="field" style="margin-top:16px"><span>调整理由</span><textarea class="input" id="r-reason" placeholder="说明调整原因，审批人可见"></textarea></label>`,
      foot: `<button class="btn" data-act="close">取消</button><button class="btn pri" data-act="rate-submit" data-id="${pid}">提交审批</button>`
    });
    ratePreview(pid);
  }
  function ratePreview(pid) {
    const p = D.P[pid], v = f => parseFloat(($('#r-' + f) || {}).value) || 0;
    const keep = p.up - v('creator') - v('leader') - v('referral'), el = $('#rate-prev');
    if (el) el.innerHTML = `<div class="eq"><span>平台留存 / 单位</span><b class="num ${keep < 0 ? 'bad' : ''}">${yen(keep)}</b><span>留存率 ${pct(keep / p.up)}</span></div>${keep < 0 ? `<div class="bad" style="font-size:12.5px;margin-top:6px">三项单价之和超过上游单价，无法提交</div>` : ''}`;
  }

  /* ---------- 数据大屏 ---------- */
  PAGES.screen = {
    t: '数据大屏', ic: 'monitor', sub: '实时运营态势',
    r() {
      const from = ago(29), fs = factsIn(from, TODAY), today = factsIn(TODAY, TODAY);
      const fl = flows(from), up = sum(fl, x => x.up), keep = sum(fl, x => x.keep);
      const days = dayList(from, TODAY), idx = {}; days.forEach((d, i) => { idx[d] = i; });
      const series = D.projects.filter(p => projOk(p.id)).map(p => { const v = days.map(() => 0); fs.forEach(f => { if (f.p === p.id) v[idx[f.d]] += f.up; }); return { name: p.short, color: pc(p.id, true), values: v.map(D.r2), area: true }; });
      const pItems = D.projects.filter(p => projOk(p.id)).map(p => ({ label: p.short, color: pc(p.id, true), value: D.r2(sum(fs.filter(f => f.p === p.id), f => f.up)) }));
      const teamUp = {}; D.lines.filter(l => l.d >= from && projOk(l.p) && (l.t === 'team' || l.rule === 'leader_self')).forEach(l => { teamUp[l.u] = (teamUp[l.u] || 0) + D.P[l.p].up * l.q; });
      const ranks = activeLeaders().map(L => ({ label: L.name, value: D.r2(teamUp[L.id] || 0), color: '#6C83FF' })).sort((a, b) => b.value - a.value);
      const recent = D.facts.filter(f => f.d >= ago(1) && projOk(f.p)).slice(-8).reverse();
      const pend = todos();
      return `<div class="scr"><div class="scr-h"><h2>TIMO 实时运营大屏</h2><span class="live"><i></i>实时</span><span class="clock" id="clock">${TODAY} ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}</span><button class="btn sm" data-act="present">${ico('expand', 14)}${document.body.classList.contains('present') ? '退出全屏' : '全屏展示'}</button></div>
        <div class="scr-k">
          <div class="panel"><h4>今日上游收入</h4><div class="big"><small>¥</small>${int(sum(today, f => f.up))}</div><div class="sub">${today.length} 笔业绩</div></div>
          <div class="panel"><h4>今日活跃成员</h4><div class="big">${new Set(today.map(f => f.u)).size}</div><div class="sub">共 ${D.users.filter(u => !u.staff && u.status === 'active').length} 位成员</div></div>
          <div class="panel"><h4>近 30 天上游收入</h4><div class="big"><small>¥</small>${C.short(up)}</div><div class="sub">${D.projects.filter(p => projOk(p.id)).length} 个项目</div></div>
          <div class="panel"><h4>近 30 天平台留存率</h4><div class="big">${pct(up ? keep / up : 0)}</div><div class="sub">留存 ${yenS(keep)}</div></div>
        </div>
        <div class="scr-g">
          <div class="stack"><div class="panel"><h4>项目构成</h4><div class="donut-wrap" style="flex-direction:column;align-items:stretch;gap:14px">${C.donut({ items: pItems, size: 140, thickness: 16, center: { value: yenS(up), label: '30 天' } }).replace('class="donut"', 'class="donut" style="margin:0 auto;width:140px;height:140px"')}${C.legend(pItems, yenS)}</div></div>
            <div class="panel"><h4>团队排行</h4>${C.hbars(ranks, yenS)}</div></div>
          <div class="stack center"><div class="panel"><h4>上游收入趋势 · 近 30 天</h4>${chLegend(series)}<div style="margin-top:8px">${C.line({ labels: days.map(md), series, w: 560, h: 220, yFmt: yenS, fmt: yen })}</div></div>
            <div class="panel"><h4>资金流向</h4>${sankeyOf(fl, true, { w: 600, h: 290 })}</div></div>
          <div class="stack"><div class="panel"><h4>实时动态</h4><ul class="feed" id="feed">${recent.map(f => feedItem(f, f.d === TODAY ? nowTime() : '昨天')).join('')}</ul></div>
            <div class="panel"><h4>待处理</h4>${pend.length ? pend.map(t => `<div class="row" style="padding:7px 0;font-size:13px;color:#C9CFF2;border-bottom:1px solid rgba(124,140,255,.1)">${ico(t.ic, 15)}<span>${t.t}</span></div>`).join('') : '<div class="sub">暂无</div>'}</div></div>
        </div></div>`;
    },
    after() {
      S.timers.push(setInterval(() => { const c = $('#clock'); if (c) c.textContent = TODAY + ' ' + new Date().toLocaleTimeString('zh-CN', { hour12: false }); }, 1000));
      const pool = D.facts.filter(f => f.d >= ago(3) && projOk(f.p));
      S.timers.push(setInterval(() => {
        const feed = $('#feed'); if (!feed || !pool.length) return;
        feed.insertAdjacentHTML('afterbegin', feedItem(pool[Math.floor(Math.random() * pool.length)], new Date().toLocaleTimeString('zh-CN', { hour12: false })));
        while (feed.children.length > 9) feed.lastElementChild.remove();
      }, 2600));
    }
  };
  function feedItem(f, t) {
    const u = U(f.u), p = D.P[f.p];
    return `<li><span class="t">${t}</span><i style="width:8px;height:8px;border-radius:3px;background:${pc(f.p, true)};flex:none"></i><b>${esc(mask(u.name))}</b><span style="color:#8C95C4">${p.short} ${f.q} ${p.unit}</span><span class="amt">+${yen(f.up)}</span></li>`;
  }

  /* ---------- 导出中心 ---------- */
  const DATASETS = {
    earnings: { name: '收益明细', ic: 'yen', desc: '每一笔收益流水，含计酬快照', fields: ['日期', '收款人', '收益类型', '项目', '数量', '单价', '金额', '状态', '业绩来源', '快照团长', '快照邀请人'], rows: () => D.lines.length },
    members: { name: '成员关系', ic: 'branch', desc: '成员、邀请人、当前团队', fields: ['成员 ID', '姓名', '身份', '当前团队', '邀请人', '注册日期', '状态', '手机号'], rows: () => D.users.filter(u => !u.staff).length },
    memberships: { name: '团队归属历史', ic: 'clock', desc: '每次入团、转队、晋升的起止', fields: ['成员', '团队', '开始', '结束', '原因'], rows: () => D.memberships.length },
    withdrawals: { name: '提现记录', ic: 'send', desc: '含收款信息，仅财务可导出', fields: ['单号', '申请人', '金额', '手续费', '申请日期', '状态'], rows: () => D.withdrawals.length, sensitive: true },
    statements: { name: '项目账单', ic: 'receipt', desc: '上游周账单与确认记录', fields: ['账单号', '项目', '开始', '结束', '业绩量', '上游金额', '状态'], rows: () => D.statements.length, sensitive: true },
    audits: { name: '审计日志', ic: 'shield', desc: '所有后台操作记录', fields: ['时间', '操作人', '动作', '对象', '说明', 'IP'], rows: () => D.audits.length }
  };
  function datasetRows(k, fields) {
    const pick = (o) => fields.map(f => o[f]);
    const ph = s => s.replace(/(\d{3})\*{4}(\d{4})/, '$1****$2');
    let rows = [];
    if (k === 'earnings') rows = D.lines.map(l => pick({ '日期': l.d, '收款人': U(l.u).name, '收益类型': TL[l.t], '项目': D.P[l.p].name, '数量': l.q, '单价': l.unit, '金额': l.a, '状态': l.st === 'pending' ? '待确认' : '已确认', '业绩来源': l.f ? U(l.f).name : l.batch, '快照团长': l.snap.leader ? U(l.snap.leader).name : '', '快照邀请人': l.snap.inviter ? U(l.snap.inviter).name : '' }));
    if (k === 'members') rows = D.users.filter(u => !u.staff).map(u => pick({ '成员 ID': u.id, '姓名': u.name, '身份': roleOf(u), '当前团队': teamOf(u), '邀请人': u.inviterId ? U(u.inviterId).name : '', '注册日期': u.joinDate, '状态': u.status === 'active' ? '正常' : '停用', '手机号': ph(u.phone) }));
    if (k === 'memberships') rows = D.memberships.map(m => pick({ '成员': U(m.userId).name, '团队': teamName(m.leaderId), '开始': m.from, '结束': m.to || '', '原因': m.reason }));
    if (k === 'withdrawals') rows = D.withdrawals.map(w => pick({ '单号': w.id, '申请人': U(w.u).name, '金额': w.amount, '手续费': w.fee, '申请日期': w.at, '状态': w.status }));
    if (k === 'statements') rows = D.statements.map(s => pick({ '账单号': s.id, '项目': D.P[s.p].name, '开始': s.start, '结束': s.end, '业绩量': s.q, '上游金额': s.up, '状态': s.status === 'pending' ? '待确认' : '已确认' }));
    if (k === 'audits') rows = D.audits.map(a => pick({ '时间': a.at, '操作人': U(a.by).name, '动作': a.act, '对象': a.obj, '说明': a.detail, 'IP': a.ip }));
    return [fields].concat(rows);
  }
  function download(name, rows) {
    const csv = '﻿' + rows.map(r => r.map(v => { v = v == null ? '' : String(v); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }
  function jobsHtml() {
    return D.exportJobs.map(j => `<div class="job"><span class="fi" style="${j.status === 'running' ? 'background:var(--primary-soft);color:var(--primary)' : j.status === 'expired' ? 'background:var(--surface-2);color:var(--muted)' : ''}">${ico(j.status === 'running' ? 'clock' : 'file')}</span><div style="flex:1;min-width:0"><b style="font-weight:600">${esc(j.name)}</b><div class="muted" style="font-size:12px">${esc(U(j.by).name)} · ${j.at} · ${int(j.rows)} 行</div>${j.status === 'running' ? `<div class="bar"><i style="width:${j.progress}%"></i></div>` : ''}</div>
      ${j.status === 'done' ? (j.fields ? `<button class="btn sm" data-act="export-dl" data-id="${j.id}">${ico('download', 14)}下载</button>` : tag('已完成', 'ok')) : j.status === 'running' ? `<span class="muted num" style="font-size:12px">${j.progress}%</span>` : tag('已过期', '')}</div>`).join('');
  }
  PAGES.exports = {
    t: '导出中心', ic: 'download', sub: '异步导出，手机号自动脱敏，下载链接 7 天有效',
    r() {
      return `<div class="grid g3">${Object.keys(DATASETS).map(k => { const ds = DATASETS[k], locked = ds.sensitive && !can('sensitiveExport'); return `<div class="card"><div class="row"><span class="kpi-i" style="--c:var(--primary);margin:0">${ico(ds.ic)}</span><div><b style="font-weight:650">${ds.name}</b><div class="muted" style="font-size:12px">${int(ds.rows())} 行 · ${ds.fields.length} 个字段</div></div><span class="sp"></span>${ds.sensitive ? tag('敏感', 'warn', false) : ''}</div><p class="muted" style="font-size:13px;margin:12px 0">${ds.desc}</p><button class="btn sm ${locked ? '' : 'pri'}" data-act="export-open" data-id="${k}" ${locked ? 'disabled' : ''}>${locked ? ico('lock', 14) + '无权限' : ico('download', 14) + '新建导出'}</button></div>`; }).join('')}</div>
        <div class="card"><div class="card-h"><h3>导出任务</h3><span class="sub">最近 30 天</span></div><div id="jobs">${jobsHtml()}</div></div>`;
    }
  };
  function exportDrawer(k) {
    const ds = DATASETS[k];
    openDrawer({
      title: '导出 · ' + ds.name, sub: `${int(ds.rows())} 行，导出为 CSV（UTF-8，Excel 可直接打开）`,
      body: `<div class="sec-t"><h2 style="font-size:14px">字段</h2></div>${ds.fields.map(f => `<label class="rule-c row" style="cursor:pointer;padding:10px 14px;margin-bottom:6px"><input type="checkbox" class="ef" value="${esc(f)}" checked style="width:16px;height:16px;accent-color:var(--primary)"><span>${esc(f)}</span>${f === '手机号' ? '<span class="sp"></span>' + tag('自动脱敏', 'info', false) : ''}</label>`).join('')}
        <div class="note" style="margin-top:12px">${ico('shield')}<div>导出操作会记录到审计日志。${ds.sensitive ? '该数据集含资金信息，仅财务与超级管理员可导出。' : ''}</div></div>`,
      foot: `<button class="btn" data-act="close">取消</button><button class="btn pri" data-act="export-start" data-id="${k}">开始导出</button>`
    });
  }

  /* ---------- 审计日志 ---------- */
  function audTable() {
    const st = ui('aud', { q: '', by: 'all' }), q = st.q.trim();
    const list = D.audits.filter(a => (st.by === 'all' || a.by === st.by) && (!q || (a.act + a.obj + a.detail + U(a.by).name).indexOf(q) >= 0));
    return `<div class="tscroll"><table class="tbl"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>说明</th><th>IP</th></tr></thead><tbody>
      ${list.map(a => `<tr><td class="num" style="white-space:nowrap">${a.at}</td><td>${who(U(a.by), esc(U(a.by).title), 26)}</td><td>${tag(esc(a.act), /驳回|停用|移出/.test(a.act) ? 'bad' : /审批|复核|确认|打款/.test(a.act) ? 'ok' : 'pri', false)}</td><td class="mono">${esc(a.obj)}</td><td style="font-size:13px;color:var(--ink-2)">${esc(a.detail)}</td><td class="mono muted">${a.ip}</td></tr>`).join('') || `<tr><td colspan="6">${empty('没有匹配的记录', 'search')}</td></tr>`}
      </tbody></table></div>`;
  }
  PAGES.audit = {
    t: '审计日志', ic: 'shield', sub: '后台每一次操作都可追溯',
    r() {
      const st = ui('aud', { q: '', by: 'all' });
      return `<div class="card flat"><div class="row wrap" style="padding:16px 20px 4px"><div class="search" style="width:260px">${ico('search', 16)}<input class="input sm" placeholder="搜索动作、对象或说明" value="${esc(st.q)}" data-inp="aud-q"></div>${seg('aud.by', [['all', '全部人员']].concat(D.users.filter(u => u.staff).map(u => [u.id, u.name])), st.by)}</div><div id="aud-list" style="margin-top:12px">${audTable()}</div></div>`;
    }
  };

  /* =====================================================================
   * 外壳
   * ===================================================================== */
  function navCount(p) { const t = todos().find(x => x.page === p); return t ? t.n : 0; }
  function renderShell() {
    const u = me(), R = ROLES[S.role], pg = PAGES[S.page];
    $('#side').innerHTML = `<div class="brand"><div class="logo">T</div><div><b>TIMO</b><small>推广任务聚合平台</small></div></div>
      <button class="search-btn" data-act="palette">${ico('search', 16)}搜索页面、成员…<kbd>Ctrl K</kbd></button>
      ${R.nav.map(g => `<div class="nav-g"><h6>${g[0]}</h6><nav class="nav">${g[1].map(p => { const n = navCount(p); return `<a href="#/${p}" class="${S.page === p ? 'on' : ''}">${ico(PAGES[p].ic)}<span>${PAGES[p].t}</span>${n ? `<span class="cnt">${n}</span>` : ''}</a>`; }).join('')}</nav></div>`).join('')}
      <div class="side-foot">${av(u, 34)}<div><b>${esc(u.name)}</b><small>${R.label}</small></div><button class="icon-btn" style="margin-left:auto" data-act="role" title="切换角色">${ico('swap', 16)}</button></div>`;
    const proj = S.proj === 'all' ? null : D.P[S.proj];
    const notes = todos();
    $('#top').innerHTML = `<button class="icon-btn only-m" data-act="side" aria-label="菜单">${ico('menu')}</button>
      <div class="top-title"><h1>${pg.t}</h1><span>${typeof pg.sub === 'function' ? pg.sub() : pg.sub}</span></div>
      <div class="top-r">
        <button class="proj-btn hide-m" data-act="proj"><i style="background:${proj ? pc(proj.id) : 'conic-gradient(' + D.projects.map((p, i) => pc(p.id) + ' ' + (i * 120) + 'deg ' + ((i + 1) * 120) + 'deg').join(',') + ')'}"></i>${proj ? esc(proj.name) : '全部项目'}${ico('chevD', 14)}</button>
        <button class="icon-btn only-m" data-act="palette" aria-label="搜索">${ico('search')}</button>
        <button class="icon-btn" data-act="notif" aria-label="通知">${ico('bell')}${notes.length ? '<span class="dot"></span>' : ''}</button>
        <button class="icon-btn" data-act="theme" aria-label="切换深色模式">${ico(isDark() ? 'sun' : 'moon')}</button>
        <button class="role-btn" data-act="role">${av(u, 32)}<div class="hide-m"><b>${esc(u.name)}</b><small>${R.label}</small></div>${ico('chevD', 14)}</button>
      </div>`;
    const tabs = R.tabs || navPages().slice(0, 5);
    $('#tabbar').innerHTML = tabs.map(p => `<a href="#/${p}" class="${S.page === p ? 'on' : ''}">${ico(PAGES[p].ic, 20)}<span>${PAGES[p].t.replace('与提现', '').replace('明细', '')}</span></a>`).join('');
  }
  function render(fresh) {
    S.timers.forEach(clearInterval); S.timers = [];
    const pg = PAGES[S.page], el = $('#page');
    renderShell();
    el.innerHTML = pg.r();
    if (pg.after) pg.after();
    if (fresh) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; window.scrollTo(0, 0); }
  }
  function route() {
    const allowed = navPages();
    let p = (location.hash.match(/^#\/(\w+)/) || [])[1];
    if (!p || allowed.indexOf(p) < 0) { p = allowed[0]; history.replaceState(null, '', '#/' + p); }
    if (p !== S.page) { S.sel.clear(); document.body.classList.remove('present'); }
    const fresh = p !== S.page;
    S.page = p; closeAll(); render(fresh);
  }
  const go = p => { if (location.hash !== '#/' + p) history.pushState(null, '', '#/' + p); route(); };
  function switchRole(r) { S.role = r; store('role', r); S.ui = {}; S.sel.clear(); closeAll(); toast(`已切换为「${ROLES[r].label}」· ${me().name}`); history.pushState(null, '', '#/' + navPages()[0]); S.page = ''; route(); }
  function toggleTheme() { S.theme = isDark() ? 'light' : 'dark'; document.documentElement.setAttribute('data-theme', S.theme); store('theme', S.theme); render(); }

  /* ---------- 浮层 ---------- */
  const scrim = $('#scrim'), drawer = $('#drawer'), modal = $('#modal'), pop = $('#pop'), pal = $('#palette');
  function closeAll() {
    drawer.classList.remove('open'); modal.classList.remove('open'); pal.classList.remove('open'); pop.classList.remove('open');
    $('#side').classList.remove('open'); scrim.classList.remove('on'); drawer.setAttribute('aria-hidden', 'true');
  }
  function openDrawer(o) {
    pop.classList.remove('open');
    drawer.innerHTML = `<div class="dr-h"><div><h3>${esc(o.title)}</h3>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</div><button class="icon-btn" data-act="close" aria-label="关闭">${ico('x')}</button></div><div class="dr-b">${o.body}</div>${o.foot ? `<div class="dr-f">${o.foot}</div>` : ''}`;
    drawer.classList.add('open'); scrim.classList.add('on'); drawer.setAttribute('aria-hidden', 'false');
  }
  let modalOk = null;
  function confirmBox(o, ok) {
    modalOk = ok;
    const tone = o.tone || 'pri';
    modal.innerHTML = `<div class="m-b"><h3><span class="m-ic t-${tone === 'danger' ? 'warn' : 'pri'}">${ico(o.icon || (tone === 'danger' ? 'alert' : 'info'))}</span>${esc(o.title)}</h3><p>${o.text}</p>${o.extra || ''}</div>
      <div class="m-f"><button class="btn" data-act="modal-cancel">取消</button><button class="btn ${tone === 'danger' ? 'danger' : 'pri'}" data-act="modal-ok">${esc(o.ok || '确认')}</button></div>`;
    modal.classList.add('open'); scrim.classList.add('on');
    setTimeout(() => { const f = $('input,textarea,select', modal) || $('[data-act="modal-ok"]', modal); if (f) f.focus(); }, 60);
  }
  function closeModal() { modal.classList.remove('open'); if (!drawer.classList.contains('open')) scrim.classList.remove('on'); }
  function toast(msg, err) {
    const box = $('#toasts');
    while (box.children.length >= 2) box.firstElementChild.remove();
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.innerHTML = ico(err ? 'alert' : 'check', 16) + `<span>${esc(msg)}</span>`;
    box.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .25s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 260); }, 2600);
  }
  function openPop(anchor, html, cls) {
    pop.className = 'pop ' + (cls || '');
    pop.innerHTML = html;
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px';
    requestAnimationFrame(() => pop.classList.add('open'));
  }

  /* ---------- 命令面板 ---------- */
  let palSel = 0, palList = [];
  function palItems(q) {
    q = (q || '').trim().toLowerCase();
    const items = [];
    navPages().forEach(p => items.push({ g: '页面', ic: PAGES[p].ic, label: PAGES[p].t, hint: '跳转', run: () => go(p) }));
    const people = S.role === 'leader' ? teamMembers(me().id) : me().staff ? D.users.filter(u => !u.staff) : [];
    if (q) people.forEach(u => items.push({ g: '成员', ic: 'user', label: u.name, hint: teamOf(u), run: () => openProfile(u.id) }));
    items.push({ g: '操作', ic: isDark() ? 'sun' : 'moon', label: isDark() ? '切换为浅色模式' : '切换为深色模式', hint: '', run: toggleTheme });
    Object.keys(ROLES).forEach(r => { if (r !== S.role) items.push({ g: '切换角色', ic: 'swap', label: `以「${ROLES[r].label}」身份查看`, hint: U(ROLES[r].uid).name, run: () => switchRole(r) }); });
    return q ? items.filter(i => (i.label + i.hint).toLowerCase().indexOf(q) >= 0).slice(0, 40) : items;
  }
  function palRender() {
    let g = '', html = '';
    palList.forEach((it, i) => { if (it.g !== g) { g = it.g; html += `<div class="pg">${g}</div>`; } html += `<div class="it ${i === palSel ? 'on' : ''}" data-act="pal-run" data-i="${i}">${ico(it.ic, 16)}<span>${esc(it.label)}</span><small>${esc(it.hint)}</small></div>`; });
    $('.pl', pal).innerHTML = html || empty('没有结果', 'search');
    const on = $('.it.on', pal); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function openPalette() {
    closeAll();
    pal.innerHTML = `<div class="pi">${ico('search')}<input placeholder="搜索页面、成员或操作…" id="pal-q" autocomplete="off"></div><div class="pl"></div><div class="pf"><span><kbd>↑</kbd> <kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span></div>`;
    palSel = 0; palList = palItems(''); palRender();
    pal.classList.add('open'); scrim.classList.add('on');
    setTimeout(() => $('#pal-q').focus(), 30);
  }

  /* ---------- 事件：动作 ---------- */
  function setPath(k, v) { const p = k.split('.'), o = ui(p[0], {}); o[p[1]] = isNaN(v) || v === '' ? v : +v; if ('limit' in o && p[1] !== 'limit') o.limit = { earn: 40, works: 30, mem: 25, set: 30 }[p[0]] || o.limit; }
  const ACT = {
    go: el => go(el.dataset.p),
    set: el => { setPath(el.dataset.k, el.dataset.v); S.sel.clear(); render(); },
    viz: el => { S.viz[el.dataset.k] = el.dataset.v; render(); },
    more: el => { ui(el.dataset.k).limit += 40; render(); },
    close: () => closeAll(),
    side: () => { $('#side').classList.add('open'); scrim.classList.add('on'); },
    theme: toggleTheme,
    palette: openPalette,
    'pal-run': el => { const it = palList[+el.dataset.i]; closeAll(); if (it) it.run(); },
    proj: el => openPop(el, `<div class="pop-h">按项目筛选</div>${[{ id: 'all', name: '全部项目', status: D.projects.length + ' 个项目' }].concat(D.projects).map(p => `<button class="pop-i ${S.proj === p.id ? 'on' : ''}" data-act="proj-set" data-v="${p.id}">${p.id === 'all' ? ico('chart', 16) : `<i style="width:10px;height:10px;border-radius:3px;background:${pc(p.id)}"></i>`}<div>${esc(p.name)}<small>${p.id === 'all' ? p.status : p.status + ' · 同步于 ' + p.sync}</small></div>${S.proj === p.id ? `<span class="ck">${ico('check', 16)}</span>` : ''}</button>`).join('')}`),
    'proj-set': el => { S.proj = el.dataset.v; pop.classList.remove('open'); render(); },
    notif: el => { const ns = todos(); openPop(el, `<div class="pop-h">通知 · ${ns.length}</div>${ns.map(t => `<button class="pop-i" data-act="go" data-p="${t.go}"><span class="ti ${t.cls}">${ico(t.ic, 16)}</span><div>${t.t}<small>${t.s}</small></div></button>`).join('') || `<div class="empty" style="padding:24px">没有新通知</div>`}`, 'notif'); },
    role: el => openPop(el, `<div class="pop-h">切换角色（演示）</div>${Object.keys(ROLES).map(r => { const u = U(ROLES[r].uid); return `<button class="pop-i ${S.role === r ? 'on' : ''}" data-act="role-set" data-v="${r}">${av(u, 28)}<div>${ROLES[r].label}<small>${esc(u.name)}${u.staff ? '' : ' · ' + esc(teamOf(u))}</small></div>${S.role === r ? `<span class="ck">${ico('check', 16)}</span>` : ''}</button>`; }).join('')}`),
    'role-set': el => { pop.classList.remove('open'); if (el.dataset.v !== S.role) switchRole(el.dataset.v); },
    user: el => openProfile(el.dataset.id),
    line: el => explainLine(+el.dataset.id),
    claim: el => { S.claimed.add(el.dataset.id); const t = D.tasks.find(x => x.id === el.dataset.id); t.taken++; toast('已领取：' + t.title); render(); },
    'work-new': () => openDrawer({
      title: '提交作品', sub: '提交后进入审核，通常 24 小时内完成',
      body: `<label class="field"><span>项目</span><select class="select" id="w-p">${D.projects.filter(p => me().projects[p.id]).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
        <label class="field"><span>作品标题</span><input class="input" id="w-t" placeholder="例如：降噪耳机值得入手吗？"></label>
        <label class="field"><span>作品链接</span><input class="input" id="w-u" placeholder="https://"><em>需为已发布的公开链接</em></label>`,
      foot: `<button class="btn" data-act="close">取消</button><button class="btn pri" data-act="work-submit">提交审核</button>`
    }),
    'work-submit': () => {
      const t = $('#w-t').value.trim();
      if (!t) { toast('请填写作品标题', true); $('#w-t').focus(); return; }
      D.works.unshift({ id: 'W' + (52110 + D.works.length), u: me().id, p: $('#w-p').value, title: t, status: '审核中', at: TODAY, q: 0, remark: '' });
      closeAll(); toast('已提交，进入审核'); render();
    },
    withdraw: withdrawDrawer,
    'wd-all': () => { const el = $('#wd-amt'); el.value = Math.max(0, wallet(me().id).balance).toFixed(2); INP.wd(el); },
    'wd-submit': () => {
      const v = parseFloat($('#wd-amt').value), b = wallet(me().id).balance;
      if (!(v >= 10)) { toast('单笔最低 ¥10', true); return; }
      if (v > b) { toast('超过可提现余额', true); return; }
      D.withdrawals.push({ id: 'WD' + (3400 + D.withdrawals.length), u: me().id, amount: D.r2(v), at: TODAY, status: '待审批', fee: D.r2(v * 0.006) });
      closeAll(); toast('提现申请已提交 · ' + yen(v)); render();
    },
    copy: el => { const v = el.dataset.v; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('链接已复制'), () => toast('已选中链接，请手动复制')); },
    poster: () => toast('海报已生成，可长按保存（演示）'),
    'jr-ok': el => {
      const j = D.joinRequests.find(x => x.id === el.dataset.id), u = U(j.userId);
      confirmBox({ title: `同意 ${u.name} 加入团队？`, text: '从今天起，该成员的新业绩按你的团长单价计算团队管理收益；历史业绩不受影响。', ok: '同意加入' }, () => {
        setLeader(u, j.leaderId, '申请加入，团长同意'); D.joinRequests.splice(D.joinRequests.indexOf(j), 1);
        toast(`${u.name} 已加入团队`); render();
      });
    },
    'jr-no': el => { const j = D.joinRequests.find(x => x.id === el.dataset.id); D.joinRequests.splice(D.joinRequests.indexOf(j), 1); toast('已婉拒申请'); render(); },
    'tree-tog': el => { const t = ui('tree'); t.open[el.dataset.id] = !t.open[el.dataset.id]; $('#tree-list').innerHTML = treeRows(); },
    'tree-sel': el => {
      const t = ui('tree'), id = el.dataset.id;
      if (id === 'IND') { t.open.IND = !t.open.IND; $('#tree-list').innerHTML = treeRows(); return; }
      t.sel = id; $('#tree-list').innerHTML = treeRows(); $('#tree-prof').innerHTML = profile(id, { actions: true });
      if (window.innerWidth <= 960) $('#tree-prof').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    transfer: el => {
      const u = U(el.dataset.id), cur = D.leaderAt(u.id, TODAY);
      confirmBox({
        title: `调整 ${u.name} 的团队`, ok: '确认调整',
        text: '只改变「团队归属」，邀请关系不变。已发生的业绩按当天的快照计酬，不受影响。',
        extra: `<label class="field"><span>调整到</span><select class="select" id="m-team">${activeLeaders().filter(L => L.id !== cur).map(L => `<option value="${L.id}">${esc(L.name)}团队</option>`).join('')}${cur !== null ? '<option value="">平台直管</option>' : ''}</select></label><label class="field"><span>原因</span><input class="input" id="m-reason" placeholder="例如：成员主动申请"></label>`
      }, () => {
        const lid = $('#m-team').value || null, reason = $('#m-reason').value.trim() || '运营调整';
        setLeader(u, lid, reason); log('转队', `${u.name}：${teamName(cur)} → ${teamName(lid)}`, reason);
        closeAll(); toast(`${u.name} 已调整到${teamName(lid)}`); render();
      });
    },
    disable: el => {
      const u = U(el.dataset.id);
      confirmBox({ title: `停用 ${u.name}？`, tone: 'danger', ok: '停用账号', text: `停用后该成员无法登录和领取任务；其团队归属结束，作为邀请人的后续邀请收益记为平台留存。历史数据全部保留。` }, () => {
        u.status = 'disabled'; u.disabledAt = TODAY; (D.memBy[u.id] || []).forEach(m => { if (!m.to) m.to = TODAY; }); u.leaderId = null;
        log('停用账号', u.name, '运营操作'); closeAll(); toast(`已停用 ${u.name}`); render();
      });
    },
    promo: el => openPromo(el.dataset.id),
    'promo-nom': el => { const p = D.promos.find(x => x.id === el.dataset.id); p.stage = 'review'; p.proposer = me().id; p.at = TODAY; p.source = p.source === '系统候选' ? '系统候选' : p.source; log('提名晋升', p.id, U(p.userId).name); closeAll(); toast('已提名，等待超级管理员审批'); render(); },
    'promo-ok': el => {
      const p = D.promos.find(x => x.id === el.dataset.id), u = U(p.userId), stay = $$('.pf', drawer).filter(c => !c.checked).map(c => c.value), follow = $$('.pf', drawer).filter(c => c.checked).map(c => U(c.value));
      confirmBox({ title: `批准 ${u.name} 晋升团长？`, ok: '批准晋升', text: `${u.name} 将成为团长，${follow.length} 位成员随迁${stay.length ? `，${stay.length} 位留在原团队` : ''}。邀请关系不变，已发生的业绩不受影响。` }, () => {
        setLeader(u, null, '晋升为团长'); u.role = 'leader'; u.leaderSince = TODAY;
        D.roleHist.push({ userId: u.id, role: 'leader', from: TODAY, reason: `晋升审核通过（${p.id}）` });
        follow.forEach(x => setLeader(x, u.id, '随邀请人晋升转入'));
        p.stage = 'done'; p.result = 'approved'; p.decidedBy = me().id; p.decidedAt = TODAY; p.reason = '达到公开晋升标准';
        log('审批晋升', p.id, `通过：${u.name} 晋升团长，${follow.length} 人随迁`); closeAll(); toast(`${u.name} 已晋升为团长`); render();
      });
    },
    'promo-no': el => {
      const p = D.promos.find(x => x.id === el.dataset.id);
      confirmBox({ title: '驳回晋升', tone: 'danger', ok: '驳回', text: '驳回原因会通知运营与当事人。', extra: `<textarea class="input" id="m-reason" placeholder="例如：近 30 天活跃天数不足"></textarea>` }, () => {
        p.stage = 'done'; p.result = 'rejected'; p.decidedBy = me().id; p.decidedAt = TODAY; p.reason = $('#m-reason').value.trim() || '未达标准';
        log('驳回晋升', p.id, p.reason); closeAll(); toast('已驳回'); render();
      });
    },
    'inc-submit': () => {
      const b = D.incBatches.find(x => x.id === ui('inc').b);
      confirmBox({ title: '提交复核？', ok: '提交', text: `${b.id} 合计 ${yen(sum(D.incItems.filter(i => i.batch === b.id), i => i.amount))}。提交后由财务复核，你不能复核自己拟定的批次。` }, () => {
        b.status = 'review'; b.proposer = me().id; log('拟定激励', b.id, '提交财务复核'); toast('已提交复核'); render();
      });
    },
    'inc-back': () => { const b = D.incBatches.find(x => x.id === ui('inc').b); b.status = 'draft'; log('退回激励', b.id, '退回运营修改'); toast('已退回'); render(); },
    'inc-post': () => {
      const b = D.incBatches.find(x => x.id === ui('inc').b), items = D.incItems.filter(i => i.batch === b.id && i.amount > 0);
      confirmBox({ title: '复核通过并入账？', ok: '入账', text: `将向 ${items.length} 位团长发放合计 ${yen(sum(items, i => i.amount))}，入账后计入其「团队激励」收益。` }, () => {
        b.status = 'posted'; b.reviewer = me().id; b.postedAt = TODAY;
        items.forEach(i => addLine({ d: TODAY, u: i.leaderId, t: 'incentive', p: 'platform', q: 1, unit: i.amount, a: i.amount, f: null, st: 'confirmed', rule: 'team_incentive', batch: b.id, snap: {} }));
        log('复核激励', b.id, '复核通过并入账'); toast('已入账'); render();
      });
    },
    st: el => openStatement(el.dataset.id),
    'st-ok': el => { const n = confirmStatements([el.dataset.id]); closeAll(); toast(`账单已确认，${n} 笔收益转为可提现`); render(); },
    'st-batch': () => {
      const ids = D.statements.filter(s => S.sel.has(s.id) && s.status === 'pending').map(s => s.id);
      confirmBox({ title: `确认 ${ids.length} 张账单？`, ok: '确认', text: '确认后对应成员收益转为「已确认」，可提现。' }, () => { const n = confirmStatements(ids); toast(`已确认 ${ids.length} 张账单，${n} 笔收益转为可提现`); render(); });
    },
    sel: (el, ev) => { ev.stopPropagation(); const id = el.dataset.id; if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); render(); },
    'sel-all': (el) => {
      const ids = el.dataset.k === 'st' ? D.statements.filter(s => projOk(s.p) && s.status === 'pending').map(s => s.id) : D.withdrawals.filter(w => w.status === ui('pay').s).map(w => w.id);
      const all = ids.every(id => S.sel.has(id)); ids.forEach(id => all ? S.sel.delete(id) : S.sel.add(id)); render();
    },
    'wd-ok': el => { const w = D.withdrawals.find(x => x.id === el.dataset.id); w.status = '待打款'; log('审批提现', w.id, yen(w.amount)); toast(`${w.id} 已通过，进入打款`); render(); },
    'wd-pay': el => { const w = D.withdrawals.find(x => x.id === el.dataset.id); confirmBox({ title: `向 ${U(w.u).name} 打款 ${yen(w.amount - w.fee)}？`, ok: '确认打款', text: '打款通过第三方通道执行，提交后不可撤回。' }, () => { w.status = '已打款'; log('打款', w.id, yen(w.amount)); toast('打款已提交'); render(); }); },
    'wd-no': el => {
      const w = D.withdrawals.find(x => x.id === el.dataset.id);
      confirmBox({ title: `驳回 ${w.id}？`, tone: 'danger', ok: '驳回', text: `金额 ${yen(w.amount)} 将退回 ${esc(U(w.u).name)} 的余额。`, extra: `<textarea class="input" id="m-reason" placeholder="驳回原因（申请人可见）"></textarea>` }, () => {
        const r = $('#m-reason').value.trim();
        if (!r) { toast('请填写驳回原因', true); return false; }
        w.status = '已驳回'; w.reason = r; log('驳回提现', w.id, r); toast('已驳回'); render();
      });
    },
    'wd-batch': () => {
      const st = ui('pay').s, ws = D.withdrawals.filter(w => S.sel.has(w.id) && w.status === st);
      confirmBox({ title: `${st === '待打款' ? '批量打款' : '批量通过'} ${ws.length} 笔？`, ok: '确认', text: `合计 ${yen(sum(ws, w => w.amount))}。` }, () => {
        ws.forEach(w => { w.status = st === '待打款' ? '已打款' : '待打款'; }); log(st === '待打款' ? '打款' : '审批提现', ws.length + ' 笔', '批量操作'); S.sel.clear(); toast(`已处理 ${ws.length} 笔`); render();
      });
    },
    'rate-edit': el => rateDrawer(el.dataset.id),
    'rate-submit': el => {
      const p = D.P[el.dataset.id], v = f => parseFloat($('#r-' + f).value);
      const changed = ['creator', 'leader', 'referral'].filter(f => !isNaN(v(f)) && D.r2(v(f)) !== p[f]);
      if (!changed.length) { toast('没有修改', true); return; }
      if (p.up - v('creator') - v('leader') - v('referral') < 0) { toast('三项单价之和不能超过上游单价', true); return; }
      const reason = $('#r-reason').value.trim() || '未填写';
      changed.forEach(f => D.rateProposals.push({ id: 'RP-0' + (32 + D.rateProposals.length), p: p.id, field: f, from: p[f], to: D.r2(v(f)), by: me().id, at: TODAY, status: 'pending', reason }));
      log('提议调价', p.name, changed.length + ' 项'); closeAll(); toast('已提交，等待审批'); render();
    },
    'rp-ok': el => { const r = D.rateProposals.find(x => x.id === el.dataset.id); confirmBox({ title: '批准生效？', ok: '批准', text: `${D.P[r.p].name} 的单价将从 ${yen(r.from)} 调整为 ${yen(r.to)}，只对生效后新产生的业绩计算。` }, () => { D.P[r.p][r.field] = r.to; r.status = 'approved'; log('审批调价', r.id, '批准生效'); toast('已生效'); render(); }); },
    'rp-no': el => { const r = D.rateProposals.find(x => x.id === el.dataset.id); r.status = 'rejected'; log('驳回调价', r.id, ''); toast('已驳回'); render(); },
    'ref-switch': () => {
      const pol = D.referralPolicy;
      confirmBox({ title: pol.enabled ? '暂停发放邀请收益？' : '恢复发放邀请收益？', tone: pol.enabled ? 'danger' : 'pri', ok: pol.enabled ? '暂停' : '恢复', text: pol.enabled ? '暂停期间邀请关系照常记录，邀请收益记为平台留存，达人端会显示暂停提示。' : '恢复后，新产生的业绩重新计算邀请收益。' }, () => { pol.enabled = !pol.enabled; log('邀请策略', '发放邀请收益', pol.enabled ? '恢复' : '暂停'); toast(pol.enabled ? '已恢复' : '已暂停'); render(); });
    },
    present: () => { document.body.classList.toggle('present'); render(); },
    'export-open': el => exportDrawer(el.dataset.id),
    'export-start': el => {
      const k = el.dataset.id, ds = DATASETS[k], fields = $$('.ef', drawer).filter(c => c.checked).map(c => c.value);
      if (!fields.length) { toast('至少选择一个字段', true); return; }
      const j = { id: 'EX-' + (1208 + D.exportJobs.length), name: `${ds.name}_${TODAY}.csv`, ds: k, by: me().id, at: TODAY + ' ' + nowTime(), rows: ds.rows(), progress: 0, status: 'running', fields };
      D.exportJobs.unshift(j); log('导出数据', j.name, fields.length + ' 个字段'); closeAll(); toast('导出任务已创建'); render();
      const tm = setInterval(() => { j.progress = Math.min(100, j.progress + 17 + Math.floor(Math.random() * 12)); if (j.progress >= 100) { j.status = 'done'; clearInterval(tm); toast(j.name + ' 已生成'); } const box = $('#jobs'); if (box && S.page === 'exports') box.innerHTML = jobsHtml(); }, 450);
    },
    'export-dl': el => { const j = D.exportJobs.find(x => x.id === el.dataset.id); download(j.name, datasetRows(j.ds, j.fields)); },
    'csv-earn': () => {
      const st = ui('earn'), P0 = PERIODS[st.period], u = me();
      const ls = linesOf(u.id, P0[1], P0[2]).filter(l => st.type === 'all' || l.t === st.type);
      download(`收益明细_${u.name}_${P0[0]}.csv`, [['日期', '类型', '项目', '业绩来源', '数量', '单价', '金额', '状态']].concat(ls.map(l => [l.d, TL[l.t], D.P[l.p].name, l.f ? U(l.f).name : l.batch, l.q, l.unit, l.a, l.st === 'pending' ? '待确认' : '已确认'])));
    },
    'modal-ok': () => { const f = modalOk; modalOk = null; const keep = f && f() === false; if (keep) { modalOk = f; return; } closeModal(); },
    'modal-cancel': () => { modalOk = null; closeModal(); }
  };

  /* ---------- 事件：输入 ---------- */
  const INP = {
    'mem-q': el => { ui('mem').q = el.value.trim(); ui('mem').limit = 25; $('#mem-list').innerHTML = memTable(); },
    'mem-team': el => { ui('mem').team = el.value; ui('mem').limit = 25; $('#mem-list').innerHTML = memTable(); },
    'tree-q': el => { ui('tree').q = el.value; $('#tree-list').innerHTML = treeRows(); },
    'aud-q': el => { ui('aud').q = el.value; $('#aud-list').innerHTML = audTable(); },
    wd: el => {
      const v = parseFloat(el.value) || 0, b = wallet(me().id).balance, fee = D.r2(v * 0.006);
      $('#wd-prev').innerHTML = `<div class="eq"><span>实际到账</span><b class="num">${yen(Math.max(0, v - fee))}</b><span>手续费 ${yen(fee)}</span></div>`;
      const h = $('#wd-hint'); h.className = ''; h.textContent = v > b ? '超过可提现余额 ' + yen(b) : v && v < 10 ? '单笔最低 ¥10' : '手续费 0.6%';
      if (v > b || (v && v < 10)) h.className = 'bad';
    },
    rate: el => ratePreview(el.dataset.p),
    tier: el => { const it = D.incItems[+el.dataset.i]; it.tier = el.value; it.amount = TIER[el.value].amt; it.note = el.value === 'C' ? '本月未达评定标准' : `作品合格率 ${pct(it.qual)}，团队活跃度 ${pct(it.active, 0)}，评定 ${el.value} 档（人工调整）`; render(); }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!pop.contains(e.target) && !(el && (el.dataset.act === 'proj' || el.dataset.act === 'notif' || el.dataset.act === 'role'))) pop.classList.remove('open');
    if (!el || el.disabled) return;
    const fn = ACT[el.dataset.act];
    if (!fn) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('input', e => { const el = e.target; if (el.id === 'pal-q') { palSel = 0; palList = palItems(el.value); palRender(); return; } const fn = el.dataset && INP[el.dataset.inp]; if (fn && el.tagName !== 'SELECT') fn(el); });
  document.addEventListener('change', e => { const el = e.target; const fn = el.dataset && INP[el.dataset.inp]; if (fn && el.tagName === 'SELECT') fn(el); });
  scrim.addEventListener('click', () => { modalOk = null; closeAll(); });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal.classList.contains('open') ? closeAll() : openPalette(); return; }
    if (pal.classList.contains('open')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palList.length - 1, palSel + 1); palRender(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); palRender(); }
      else if (e.key === 'Enter') { e.preventDefault(); const it = palList[palSel]; closeAll(); if (it) it.run(); }
    }
    if (e.key === 'Escape') {
      if (modal.classList.contains('open')) { modalOk = null; closeModal(); }
      else if (document.body.classList.contains('present')) { document.body.classList.remove('present'); render(); }
      else closeAll();
    }
    if (e.key === 'Enter' && modal.classList.contains('open') && e.target.tagName === 'INPUT') { e.preventDefault(); ACT['modal-ok'](); }
  });

  /* ---------- 图表悬浮提示 ---------- */
  const tip = $('#tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.classList.remove('on'); return; }
    tip.innerHTML = t.getAttribute('data-tip');
    tip.classList.add('on');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
    tip.style.left = x + 'px'; tip.style.top = y + 'px';
  });
  document.addEventListener('scroll', () => tip.classList.remove('on'), true);

  window.addEventListener('hashchange', route);
  window.TIMO = { S, go, switchRole, toggleTheme, PAGES, ROLES };
  route();
})();
