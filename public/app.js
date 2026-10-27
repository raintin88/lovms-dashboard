'use strict';
// LOVMS 智能营销中心 v2 — 所有数字来自 /api；无数据显示「—」；示例数据带徽章
const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EX = '<span class="badge">示例数据</span>';
const STATUS = { queued: '排队中', in_progress: '进行中', done: '已完成', approved: '已批准', rejected: '已驳回', awaiting_approval: '待批准' };
const EVENT = { task_start: '开始任务', task_done: '完成任务', metric_written: '写入指标', report_written: '写日报', todo_created: '新建事项', todo_updated: '更新事项', escalation: '上报', patrol: '巡视', error: '错误', kb_update: '知识库更新' };
const ACC = { connected: ['ok', '已连接'], pending: ['warn', '进行中'], not_connected: ['no', '未连接'] };
const ROLE = { // 岗位说明（文字，不含数字）
  ceo: ['总指挥', '统筹全部 bot，每小时巡视，汇总晨报交给你拍板', ['巡视各 bot 进度', '汇总每日晨报', '把需要你决定的事上报']],
  shopify: ['店铺运营', '盯 Shopify 店铺的销售、订单与商品', ['读取实时销售数据', '商品上下架与库存检查', '每日写销售指标']],
  'seo-geo': ['SEO / GEO', '站内外 SEO 与 AI 搜索可见度', ['收录与排名检查', '站内文案优化建议', '外链与内容计划']],
  facebook: ['FB / IG 运营', 'Facebook 与 Instagram 内容和数据', ['内容排期与发帖', '次日数据小结', '广告需你单独批准']],
  tiktok: ['TikTok 运营', '短视频内容与账号增长', ['选题与脚本', '发布与互动', '次日数据小结']],
  pinterest: ['Pinterest 运营', 'Pin 图与看板，带来自然流量', ['Pin 图制作', '看板与关键词', '次日数据小结']],
  fulfillment: ['履约 · 售后', '发货、退换与客服邮件', ['订单履约跟踪', '退换货处理', '客服邮箱回复']],
  'influencer-bd': ['达人 BD', '达人筛选、合作外联与进度管理', ['达人筛选与分层', '外联草稿（先过目）', '合作进度跟踪']],
  'ops-kb': ['运营 · 知识库', '维护共享知识库与数据规范', ['整理知识库', '校验数据文件', '归档日报']] };
async function get(u) { const r = await fetch(u, { credentials: 'same-origin' }); if (r.status === 401) { login(); throw 0; } return r.json(); }
async function post(u, b) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); if (r.status === 401 && u !== '/api/login') { login(); throw 0; } return { status: r.status, data: await r.json() }; }
function fmt(m) {
  if (!m || typeof m !== 'object' || !('value' in m)) return '—';
  if (m.value === null || m.value === undefined) return '—' + (m.note ? ` <span class="muted">（${esc(m.note)}）</span>` : '');
  const v = m.value, u = m.unit;
  if (u === 'ratio' && typeof v === 'number' && v < 1) return (v * 100).toFixed(2).replace(/\.?0+$/, '') + '%';
  if (u === 'USD') return '$' + Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (typeof v === 'number') return v.toLocaleString('en-US') + (u && !['count', 'ratio'].includes(u) ? ' ' + esc(u) : '');
  return esc(v);
}
const money = (v, c = 'USD') => v == null ? '—' : (c === 'USD' ? '$' : c + ' ') + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
const shTime = iso => { if (!iso) return '—'; const d = new Date(Date.parse(iso) + 8 * 3600e3).toISOString(); return d.slice(0, 10) + ' ' + d.slice(11, 16); };
function time(ts) { return ts ? esc(String(ts).replace('T', ' ').replace(/:\d\d\+08:00$/, '').replace('+08:00', '')) + ' <span class="muted">上海</span>' : '—'; }
function expand(f, max) { const out = new Set(); for (const p of f.split(',')) { let m; if (p === '*') for (let i = 0; i < max; i++) out.add(i); else if ((m = p.match(/^\*\/(\d+)$/))) for (let i = 0; i < max; i += +m[1]) out.add(i); else if ((m = p.match(/^(\d+)-(\d+)$/))) for (let i = +m[1]; i <= +m[2]; i++) out.add(i); else if (/^\d+$/.test(p)) out.add(+p); else return null; } return [...out].sort((a, b) => a - b); }
function cronTimes(c) { const f = c.split(/\s+/); if (f.length !== 5) return null; const mi = expand(f[0], 60), h = expand(f[1], 24); if (!mi || !h || f.slice(2).some(x => x !== '*')) return null; const t = []; for (const hh of h) for (const mm of mi) t.push(String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0')); return t; }
function cronLabel(c) { const t = cronTimes(c); if (!t) return esc(c); return t.length > 6 ? `每天 ${t.length} 次（${esc(t[0])} 起）` : '每天 ' + t.map(esc).join('、'); }
function md(src) { // minimal, escaped markdown
  if (!src) return '<p class="muted">—</p>';
  src = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  const L = src.split('\n'); let h = '', i = 0;
  while (i < L.length) { const l = L[i];
    if (/^\s*\|/.test(l)) { const rows = []; while (i < L.length && /^\s*\|/.test(L[i])) rows.push(L[i++]); const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      h += '<table>' + rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map((r, k) => '<tr>' + cells(r).map(c => k ? `<td>${inl(c)}</td>` : `<th>${inl(c)}</th>`).join('') + '</tr>').join('') + '</table>'; continue; }
    let m; if ((m = l.match(/^(#{1,4})\s+(.*)/))) h += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`;
    else if (/^\s*[-*]\s+/.test(l)) { h += '<ul>'; while (i < L.length && /^\s*[-*]\s+/.test(L[i])) h += '<li>' + inl(L[i++].replace(/^\s*[-*]\s+/, '')) + '</li>'; h += '</ul>'; continue; }
    else if (l.trim()) h += '<p>' + inl(l) + '</p>'; i++; }
  return h;
}
// ---------- 视觉组件 ----------
const FACE = { ceo: 'crown', shopify: 'bag', 'seo-geo': 'glass', 'influencer-bd': 'chat', facebook: 'chat', tiktok: 'note', pinterest: 'pin', fulfillment: 'box', 'ops-kb': 'book' };
function avatar(id, color, size = 56) {
  const c = /^#[0-9a-fA-F]{3,8}$/.test(color || '') ? color : '#2563EB', k = FACE[id];
  const acc = { crown: '<path d="M20 14l5 5 7-8 7 8 5-5-2 10H22z" fill="#FACC15" stroke="#CA8A04" stroke-width="1"/>',
    bag: '<rect x="42" y="40" width="14" height="12" rx="2" fill="#fff" stroke="#16A34A" stroke-width="1.5"/><path d="M45 40v-2a4 4 0 018 0v2" fill="none" stroke="#16A34A" stroke-width="1.5"/>',
    glass: '<circle cx="48" cy="44" r="6" fill="#fff" stroke="#1D4ED8" stroke-width="2"/><path d="M52 48l5 5" stroke="#1D4ED8" stroke-width="2.5" stroke-linecap="round"/>',
    chat: '<path d="M40 38h16a2 2 0 012 2v8a2 2 0 01-2 2h-9l-4 4v-4h-3a2 2 0 01-2-2v-8a2 2 0 012-2z" fill="#fff" stroke="#3B5BDB" stroke-width="1.5"/>',
    note: '<path d="M50 36v12a3 3 0 11-2-2.8V36h6" fill="none" stroke="#0F172A" stroke-width="2"/>',
    pin: '<path d="M48 36a6 6 0 016 6c0 5-6 11-6 11s-6-6-6-11a6 6 0 016-6z" fill="#E60023"/><circle cx="48" cy="42" r="2" fill="#fff"/>',
    box: '<path d="M40 42l8-4 8 4v9l-8 4-8-4z" fill="#FDE68A" stroke="#B45309" stroke-width="1.2"/><path d="M40 42l8 4 8-4M48 46v9" stroke="#B45309" stroke-width="1.2" fill="none"/>',
    book: '<rect x="40" y="38" width="15" height="16" rx="2" fill="#fff" stroke="#7C3AED" stroke-width="1.5"/><path d="M44 43h7M44 47h7" stroke="#7C3AED" stroke-width="1.5"/>' }[k] || '';
  return `<svg class="av" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="${c}" fill-opacity=".18"/><circle cx="32" cy="34" r="17" fill="#FFE4CC"/>
  <path d="M15 31c0-11 8-17 17-17s17 6 17 17c-3-5-9-8-17-8s-14 3-17 8z" fill="${c}"/><circle cx="26" cy="35" r="2.2" fill="#0F172A"/><circle cx="38" cy="35" r="2.2" fill="#0F172A"/>
  <path d="M27 41q5 4 10 0" stroke="#0F172A" stroke-width="1.8" fill="none" stroke-linecap="round"/><circle cx="22" cy="40" r="2.5" fill="#FDA4AF" opacity=".6"/><circle cx="42" cy="40" r="2.5" fill="#FDA4AF" opacity=".6"/>${acc}</svg>`;
}
const stat = s => s ? `<span class="st ${esc(s.key)}" title="${esc(s.why)}"><i></i>${esc(s.label)}</span>` : '<span class="st"><i></i>待命</span>';
function spark(vals) { if (!vals || vals.length < 2) return ''; const max = Math.max(...vals, 1), W = 200, H = 46, pts = vals.map((v, i) => [i * W / (vals.length - 1), H - 4 - (v / max) * (H - 10)]);
  const l = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(''); return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><defs><linearGradient id="g${vals.length}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2563EB" stop-opacity=".28"/><stop offset="1" stop-color="#2563EB" stop-opacity="0"/></linearGradient></defs><path d="${l}L${W} ${H}L0 ${H}Z" fill="url(#g${vals.length})"/><path d="${l}" fill="none" stroke="#2563EB" stroke-width="2"/></svg>`; }
// value: 数字或 null；kind: money|int
function kpi(label, value, kind, sub, series, badge, cls = '') {
  const shown = value == null ? '—' : `<span data-count="${esc(value)}" data-kind="${kind}">0</span>`;
  return `<div class="card kpi ${cls}">${cls === 'radar' ? '<span class="sweep"></span>' : ''}<div class="lab">${esc(label)}${badge || ''}</div><div class="v">${shown}</div><div class="muted">${sub || ''}</div>${series ? spark(series) : ''}</div>`;
}
function countUp() { app.querySelectorAll('[data-count]').forEach(el => { const to = +el.dataset.count, k = el.dataset.kind, t0 = performance.now(), d = 900;
  const f = n => k === 'money' ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : Math.round(n).toLocaleString('en-US');
  const step = t => { const p = Math.min(1, (t - t0) / d), e = 1 - Math.pow(1 - p, 3); el.textContent = f(to * e); if (p < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); }); }
const skel = () => { app.innerHTML = '<div class="sk big w40"></div><div class="sk w60"></div><div class="grid">' + '<div class="card"><div class="sk w60"></div><div class="sk big w80"></div><div class="sk"></div></div>'.repeat(4) + '</div><div class="card"><div class="sk w80"></div><div class="sk w60"></div><div class="sk"></div></div>'; };
const head = (t, s) => `<div class="ph"><h1>${esc(t)}</h1><p>${esc(s)}</p></div>`;
let AG = []; // agents.json 缓存
function sideV2(r) {
  const g = [['工作台', [['#/', '总览'], ['#/agents', 'AI 员工团队'], ['#/tasks', '任务与审批']]], ['数据', [['#/shopify', 'Shopify 实时数据'], ['#/accounts', '账号连接']]],
    ['员工', AG.map(a => ['#/agent/' + a.id, a.name, a.id])]];
  $('#side').innerHTML = `<a href="#/" class="logo"><i>L</i><span>LOVMS<small>智能营销中心</small></span></a><nav>` + g.map(([t, xs]) => `<div class="grp">${t}</div>` + xs.map(([h, n, id]) => `<a href="${h}" class="${r === h || (id && r.startsWith(h + '/')) || (id && r === h) ? 'on' : ''}">${id ? '<span class="mini"></span>' : ''}${esc(n)}</a>`).join('')).join('') + '<div class="grp">账户</div><a href="#" id="tg">' + (isDark() ? '☀️ 切换浅色' : '🌙 指挥中心（深色）') + '</a><a href="#" id="lo">退出登录</a></nav>';
  $('#tg').onclick = e => { e.preventDefault(); setTheme(isDark() ? 'light' : 'dark'); side(r); };
  $('#lo').onclick = async e => { e.preventDefault(); await post('/api/logout'); login(); };
}
function login() {
  document.body.classList.add('auth'); $('#ticker').innerHTML = '';
  const N = [['纽约', 78, 30], ['波士顿', 84, 18], ['洛杉矶', 14, 62], ['旧金山', 10, 40], ['芝加哥', 60, 26], ['迈阿密', 76, 78], ['伦敦', 38, 14], ['达拉斯', 46, 66], ['西雅图', 16, 16]];
  const E = [[0, 1], [0, 4], [0, 6], [0, 5], [2, 3], [3, 8], [4, 7], [7, 2], [4, 8], [6, 1], [5, 7], [3, 4]];
  const net = `<svg class="net" viewBox="0 0 100 100" preserveAspectRatio="none">${E.map(([a, b]) => `<line x1="${N[a][1]}" y1="${N[a][2]}" x2="${N[b][1]}" y2="${N[b][2]}" vector-effect="non-scaling-stroke"/>`).join('')}</svg>`;
  const dots = '';
  app.innerHTML = `<div class="login-wrap">${net}${dots}<div id="labels"></div><div class="card login"><div class="logo"><i>L</i><span>LOVMS</span></div><p class="muted">智能营销中心 · 美国市场</p>
  <form id="lf"><input type="password" id="pw" autocomplete="current-password" placeholder="请输入看板密码" required><button>进入</button><p class="err" id="er"></p></form></div></div>`;
  const lab = $('#labels'); N.forEach(([n, x, y]) => { const s = document.createElement('div'); s.className = 'node'; s.innerHTML = '<i></i><b></b><span></span>'; s.lastChild.textContent = n; Object.assign(s.style, { left: x + '%', top: y + '%' }); lab.appendChild(s); });
  $('#lf').onsubmit = async e => { e.preventDefault(); const r = await post('/api/login', { password: $('#pw').value }); if (r.status === 200) { document.body.classList.remove('auth'); route(); } else $('#er').textContent = r.data.error || '登录失败'; };
}
function logTL(ls, names, opt = {}) {
  if (!ls.length) return '<p class="muted">暂无日志</p>'; let day = '', h = '<ul class="tl">';
  for (const e of ls) { const d = String(e.ts || '').slice(0, 10); if (d !== day) { day = d; h += `<li class="dayrow"><div class="day">${esc(d || '无日期')}</div></li>`; }
    h += `<li class="${esc(e.level)}"><span class="muted">${esc(String(e.ts || '').slice(11, 16))} 上海</span> ${opt.who ? `<b>${esc(names[e.agent_id] || e.agent_id)}</b> ` : ''}<span class="chip ${e.level === 'error' ? 'err' : e.level === 'warn' ? 'warn' : ''}">${esc(EVENT[e.event] || e.event)}</span>${e.example ? EX : ''}<br>${esc(e.message)}${e.task_minutes != null ? ` <span class="muted">· ${esc(e.task_minutes)} 分钟</span>` : ''}${(e.refs || []).map(r => ` <a href="#/file/${encodeURIComponent(r)}" class="muted">📄 ${esc(r)}</a>`).join('')}</li>`; }
  return h + '</ul>';
}
function taskRows(ts, names, actions) { if (!ts.length) return '<p class="muted">暂无</p>'; return '<div><table><tr><th>时间</th><th>Bot</th><th>优先级</th><th>内容</th><th>状态</th>' + (actions ? '<th></th>' : '') + '</tr>' + ts.map(t => `<tr><td>${esc(shTime(t.created_at))}</td><td>${esc(names[t.agent] || t.agent)}</td><td><span class="chip">${esc(t.priority)}</span></td><td>${esc(t.text)}${t.requires_approval ? ' <span class="pill">需审批</span>' : ''}${t.result_note ? `<br><span class="muted">${esc(t.result_note)}</span>` : ''}<br><span class="muted">${esc(t.id)}</span></td><td>${esc(STATUS[t.status] || t.status)}</td>${actions ? `<td><button data-a="approve" data-g="${esc(t.agent)}" data-i="${esc(t.id)}">批准</button> <button class="ghost" data-a="reject" data-g="${esc(t.agent)}" data-i="${esc(t.id)}">驳回</button></td>` : ''}</tr>`).join('') + '</table></div>'; }
function bindApprove(again) { app.querySelectorAll('button[data-a]').forEach(b => b.onclick = async () => { const r = await post(`/api/tasks/${b.dataset.g}/${b.dataset.i}/${b.dataset.a}`); if (r.status === 200) again(); else alert(r.data.error); }); }
function taskForm(agents, names, fixed) {
  return `<form id="tf">${fixed ? `<input type="hidden" id="ag" value="${esc(fixed)}">` : `<label>Bot</label><select id="ag">${agents.map(a => `<option value="${esc(a)}">${esc(names[a] || a)}</option>`).join('')}</select>`}
  <label>任务内容</label><textarea id="tx" maxlength="4000" required></textarea><label>优先级</label><select id="pr"><option>P1</option><option>P0</option><option>P2</option></select>
  <label class="chk"><input type="checkbox" id="ra"> 花钱或对外发布前需要我批准</label><p class="muted">涉及花钱或对外发布的任务请勾选。</p>
  <button>提交任务</button><p class="muted" id="msg">Bot 会在下一次检查收件箱时领取（不是即时）。</p></form>`; }
function bindForm(again) { $('#tf').onsubmit = async e => { e.preventDefault(); const r = await post('/api/tasks', { agent: $('#ag').value, text: $('#tx').value, priority: $('#pr').value, requires_approval: $('#ra').checked }); if (r.status === 201) again(); else $('#msg').textContent = r.data.error; }; }
function shopNotConnected(s) { return `<div class="notice warn"><b>Shopify 未连接</b> — ${esc(s.hint || '')}</div>`; }
function shopKpis(s) {
  if (!s || !s.connected) return '';
  const b = s.example ? EX : '', ser = s.series_30d ? s.series_30d.map(x => x.sales) : null, os = s.series_30d ? s.series_30d.map(x => x.orders) : null;
  return `<div class="grid">${kpi('今日销售额', s.today.sales, 'money', `${s.today.orders} 单 · 上海时间切日`, null, b)}${kpi('近 7 天销售额', s.d7.sales, 'money', `${s.d7.orders} 单`, ser && ser.slice(-7), b)}
  ${kpi('近 30 天销售额', s.d30.sales, 'money', '订单总额（含运费税，未扣退款）', ser, b)}${kpi('近 30 天订单', s.d30.orders, 'int', '客单价 ' + money(s.d30.aov), os, b)}
  ${kpi('近 30 天访客会话', s.sessions ? s.sessions.d30 : null, 'int', s.sessions ? 'ShopifyQL' : '暂不可用（需 read_reports）', s.sessions ? s.sessions.series.map(x => x.sessions) : null, b)}
  ${kpi('在售商品', s.products ? s.products.active : null, 'int', s.products && s.products.draft != null ? `草稿 ${s.products.draft}` : '—', null, b)}</div>`; }
// ---------- 页面 ----------
function agentCard(a, st) { const r = ROLE[a.id] || [a.id, '', []];
  return `<a class="card agent" href="#/agent/${esc(a.id)}">${stat(st)}${avatar(a.id, a.color)}<h3>${esc(a.name)}</h3><span class="pill">${esc(r[0])}</span>
  <p class="muted">${esc(r[1])}</p><ul>${r[2].map(x => `<li>${esc(x)}</li>`).join('')}</ul></a>`; }
async function overview() {
  skel(); const [d, s] = await Promise.all([get('/api/overview'), get('/api/shopify/summary')]); AG = (d.agents && d.agents.agents) || []; side('#/');
  const names = Object.fromEntries(AG.map(a => [a.id, a.name])), pend = d.tasks.filter(t => t.requires_approval && t.status === 'queued').length;
  const todo = ((d.todo && d.todo.items) || []).filter(t => t.needs_ceo_decision && !['done', 'closed'].includes(t.status));
  const run = Object.values(d.statuses).filter(x => x.key === 'running').length, conn = (d.accounts || []).filter(a => a.status === 'connected').length;
  app.innerHTML = head('LOVMS 智能营销中心', '多渠道 AI 员工团队 · 数据来自 Shopify 与各平台') +
  (s.connected ? '' : shopNotConnected(s)) + shopKpis(s) +
  `<div class="grid">${kpi('运行中的 AI 员工', run, 'int', `共 ${AG.length} 位${d.agents && d.agents.example ? ' · agents.json 为示例' : ''}`, null, '', 'radar')}${kpi('待你批准', pend, 'int', '<a href="#/tasks">去处理 →</a>')}${kpi('已连接平台', conn, 'int', `共 ${(d.accounts || []).length} 个 · <a href="#/accounts">账号连接</a>`)}</div>
  <div class="card"><h2>AI 员工团队 <a class="muted" href="#/agents">打开团队页 →</a></h2>${teamView(d)}</div>
  <div><div class="card"><h2>需要你拍板${d.todo && d.todo.example ? EX : ''}</h2>${todo.length ? todo.map(t => `<p><span class="chip">${esc(t.priority)}</span> ${esc(t.title)}${t.example ? EX : ''}<br><span class="muted">${esc(names[t.owner_agent] || t.owner_agent)} · 截止 ${esc(t.due || '—')}</span></p>`).join('') : '<p class="muted">暂无</p>'}</div></div>
  <div class="cols"><div class="card"><h2>系统日报 · ${esc(d.system_report ? d.system_report.date : '—')}${d.system_report && /example:\s*true|示例/.test(d.system_report.markdown) ? EX : ''}</h2>${d.system_report && d.system_report.date !== d.now.slice(0, 10) ? `<p class="notice warn">今天还没有新日报，下面显示的是 ${esc(d.system_report.date)} 的（最近一份）</p>` : ''}<div class="md">${d.system_report ? md(d.system_report.markdown) : '<p class="muted">尚无 system 日报</p>'}</div></div>
  <div class="card"><h2>公司日志</h2>${logTL(d.logs.slice(0, 15), names, { who: 1 })}</div></div>`;
  countUp(); drawOrg();
}
async function agentsPage() { skel(); const d = await get('/api/overview'); AG = (d.agents && d.agents.agents) || []; side('#/agents');
  const run = AG.filter(a => d.statuses[a.id] && d.statuses[a.id].key === 'running').length, ex = d.agents && d.agents.example ? EX : '';
  const Q = [['+ 新建内容计划', 'ceo', '请为 Pinterest / Facebook / TikTok 各做一份下周内容计划，写进 playbooks 等我确认。'], ['+ 让 SEO 做站内检查', 'seo-geo', '请对 lovms.com 做一次站内 SEO 检查，列出问题和修改建议。'], ['+ 查看昨日数据', 'shopify', '请汇总昨天的 Shopify 销售、订单和访客数据，写成日报。']];
  app.innerHTML = head('AI 员工团队', '点开任意一位，看它的工作日志、成果、计划与任务') +
  `<div class="grid sum2"><div class="card kpi radar"><span class="sweep"></span><div class="lab">忙碌中${ex}</div><div class="v"><span data-count="${run}" data-kind="int">0</span></div><div class="muted">状态为「运行中」的员工</div></div>
   <div class="card kpi"><div class="lab">已雇佣${ex}</div><div class="v"><span data-count="${AG.length}" data-kind="int">0</span></div><div class="muted">agents.json 里的员工数</div></div></div>
  <div class="qbar"><div><h2>快捷指令</h2><p>今天要开始什么任务？告诉 CEO Agent 你的目标，他会分配给对应的 bot。</p></div><div class="qbtns">${Q.map((q, i) => `<button class="qb" data-q="${i}">${esc(q[0])}</button>`).join('')}</div></div>
  <div class="card">${teamView(d)}</div>`;
  app.querySelectorAll('.qb').forEach(b => b.onclick = () => { const q = Q[+b.dataset.q]; sessionStorage.setItem('prefill', JSON.stringify({ agent: q[1], text: q[2] })); location.hash = '#/tasks'; });
  countUp(); drawOrg(); }
// ---------- 组织图 ----------
const GROUPS = [['渠道运营', ['facebook', 'tiktok', 'pinterest', 'influencer-bd']], ['SEO', ['seo-geo']], ['Shopify', ['shopify']], ['履约售后', ['fulfillment']], ['运营知识库', ['ops-kb']]];
function teamCard(a, st, ts, ceo) { const r = ROLE[a.id] || [a.id, '', []], mine = ts.filter(t => t.agent === a.id), n = k => mine.filter(t => t.status === k).length;
  return `<a class="card agent tm ${ceo ? 'ceo' : ''}" data-id="${esc(a.id)}" data-st="${esc(st ? st.key : 'idle')}" href="#/agent/${esc(a.id)}"><div class="tmh">${avatar(a.id, a.color, ceo ? 60 : 48)}<div><h3>${esc(a.name)} ${stat(st)}</h3><span class="pill">${esc(r[0])}</span></div></div>
  <p class="muted">${esc(r[1])}</p><ul>${r[2].map(x => `<li>${esc(x)}</li>`).join('')}</ul>
  <div class="cnt"><span>已安排 <b>${n('queued')}</b></span><span>正在执行 <b>${n('in_progress')}</b></span><span>已完成 <b>${n('done')}</b></span></div></a>`; }
function teamView(d) { const by = Object.fromEntries(AG.map(a => [a.id, a])), ts = d.tasks || [], used = new Set(['ceo']);
  const box = ([t, ids]) => { const xs = ids.filter(i => by[i]); xs.forEach(i => used.add(i)); return xs.length ? `<div class="gbox"><div class="glab">${esc(t)}</div><div class="gcards">${xs.map(i => teamCard(by[i], d.statuses[i], ts)).join('')}</div></div>` : ''; };
  const rows = `<div class="orow">${GROUPS.slice(0, 2).map(box).join('')}</div><div class="orow">${GROUPS.slice(2).map(box).join('')}</div>`;
  const rest = AG.filter(a => !used.has(a.id)); // agents.json 里新增的员工也全部显示
  return `<div class="org"><svg class="olines" aria-hidden="true"></svg><div class="orow top">${by.ceo ? teamCard(by.ceo, d.statuses.ceo, ts, 1) : ''}</div>${rows}${rest.length ? box(['其他', rest.map(a => a.id)]) : ''}</div>`; }
function drawOrg() { document.querySelectorAll('.org').forEach(org => {
  const svg = org.querySelector('.olines'), ceo = org.querySelector('.tm.ceo'); if (!svg || !ceo) return;
  const o = org.getBoundingClientRect(), R = el => { const r = el.getBoundingClientRect(); return { l: r.left - o.left, t: r.top - o.top, r: r.right - o.left, b: r.bottom - o.top, cx: (r.left + r.right) / 2 - o.left, cy: (r.top + r.bottom) / 2 - o.top }; };
  svg.setAttribute('width', o.width); svg.setAttribute('height', o.height); svg.setAttribute('viewBox', `0 0 ${o.width} ${o.height}`);
  const C = R(ceo), cards = [...org.querySelectorAll('.tm:not(.ceo)')].map(el => ({ el, ...R(el) })), narrow = innerWidth < 861, P = [];
  const hit = (x, y1, y2) => cards.some(c => x > c.l - 4 && x < c.r + 4 && c.b > y1 && c.t < y2);
  const rr = 10, el = pts => pts.reduce((s, p, i) => { if (!i) return `M${p[0]} ${p[1]}`; const n = pts[i + 1]; if (!n) return s + ` L${p[0]} ${p[1]}`; const q = pts[i - 1];
    const dx1 = Math.sign(p[0] - q[0]), dy1 = Math.sign(p[1] - q[1]), dx2 = Math.sign(n[0] - p[0]), dy2 = Math.sign(n[1] - p[1]); const k = Math.min(rr, Math.abs(p[0] - q[0] + p[1] - q[1]) / 2, Math.abs(n[0] - p[0] + n[1] - p[1]) / 2);
    return s + ` L${p[0] - dx1 * k} ${p[1] - dy1 * k} Q${p[0]} ${p[1]} ${p[0] + dx2 * k} ${p[1] + dy2 * k}`; }, '');
  for (const c of cards) { let pts;
    if (narrow) { const sx = 8; pts = [[sx, C.b - 20], [sx, c.t + 30], [c.l, c.t + 30]]; }
    else { const by = C.b + 22; if (!hit(c.cx, by, c.t - 1)) pts = [[C.cx, C.b], [C.cx, by], [c.cx, by], [c.cx, c.t]];
      else { const gy = c.t - 16, xs = []; const blk = cards.filter(k => k.b > by && k.t < gy).sort((a, b) => a.l - b.l);
        for (let i = 0; i < blk.length - 1; i++) if (blk[i + 1].l - blk[i].r > 8) xs.push((blk[i].r + blk[i + 1].l) / 2); xs.push(blk[0].l - 14, blk[blk.length - 1].r + 14);
        const gx = xs.filter(x => !hit(x, by, gy)).sort((a, b) => Math.abs(a - c.cx) - Math.abs(b - c.cx))[0] ?? c.cx; pts = [[C.cx, C.b], [C.cx, by], [gx, by], [gx, gy], [c.cx, gy], [c.cx, c.t]]; } }
    P.push({ d: el(pts), st: c.el.dataset.st }); }
  if (narrow) P.push({ d: `M${C.l} ${C.b - 20} L8 ${C.b - 20}`, st: ceo.dataset.st });
  svg.innerHTML = '<defs><filter id="og" filterUnits="userSpaceOnUse" x="-20" y="-20" width="${o.width + 40}" height="${o.height + 40}"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
    P.map(p => `<path class="ln ${esc(p.st)}" d="${p.d}"/><path class="fl ${esc(p.st)}" d="${p.d}" filter="url(#og)"/>`).join(''); }); }
addEventListener('resize', () => { clearTimeout(drawOrg.t); drawOrg.t = setTimeout(drawOrg, 150); });
async function agentPage(id, tab = 'overview') {
  skel(); const [d, o] = await Promise.all([get('/api/agent/' + encodeURIComponent(id)), AG.length ? null : get('/api/overview')]); if (o) AG = (o.agents && o.agents.agents) || [];
  side('#/agent/' + id); if (d.error) { app.innerHTML = `<p class="err">${esc(d.error)}</p>`; return; }
  const a = d.agent || { id, name: id, schedule: [] }, r = ROLE[id] || [id, '', []], names = Object.fromEntries(AG.map(x => [x.id, x.name])), m = d.metrics;
  const T = [['overview', '概览'], ['logs', '工作日志'], ['output', '成果'], ['plan', '计划与手册'], ['tasks', '任务']];
  let body = '';
  if (tab === 'overview') {
    const s = id === 'shopify' ? await get('/api/shopify/summary') : null;
    body = (s ? (s.connected ? shopKpis(s) : shopNotConnected(s)) : '') + `<div class="cols"><div class="card"><h2>岗位</h2><p>${esc(r[1])}</p><ul>${r[2].map(x => `<li>${esc(x)}</li>`).join('')}</ul>
    <h2>排班</h2><table>${(a.schedule || []).map(x => `<tr><td>${cronLabel(x.cron)}</td><td>${esc(x.task)}</td></tr>`).join('') || '<tr><td class="muted">—</td></tr>'}</table></div>
    <div class="card"><h2>负责的账号</h2>${d.accounts.length ? d.accounts.map(x => `<p>${esc(x.label)} <span class="chip ${ACC[x.status][0]}">${ACC[x.status][1]}</span> ${safeUrl(x.profile_url) ? `<a href="${esc(x.profile_url)}" target="_blank" rel="noopener">打开 ↗</a>` : ''}</p>`).join('') : '<p class="muted">无</p>'}
    <h2>最近动态</h2>${logTL(d.logs.slice(0, 5), names)}</div></div>`;
  } else if (tab === 'logs') {
    const days = [...new Set(d.logs.map(e => String(e.ts).slice(0, 10)))];
    body = `<div class="card"><div class="filters"><select id="fd"><option value="">全部日期</option>${days.map(x => `<option>${esc(x)}</option>`).join('')}</select><input id="fq" placeholder="搜索日志…"><span class="muted" id="fc"></span></div><div id="tlw"></div></div>
    <div class="card"><h2>日报</h2>${d.reports.length ? d.reports.map((x, i) => `<details ${i ? '' : 'open'}><summary>${esc(x.date)} 日报${/示例|example:\s*true/.test(x.markdown) ? EX : ''}</summary><div class="md">${md(x.markdown)}</div></details>`).join('') : '<p class="muted">尚无日报</p>'}</div>`;
  } else if (tab === 'output') {
    const rows = m && m.metrics ? Object.entries(m.metrics).filter(([, v]) => !Array.isArray(v)).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmt(v)}</td><td class="muted">${esc(v && v.source)}</td></tr>`).join('') : '';
    body = `<div class="card"><h2>指标 · ${esc(d.date || '—')}${m && m.example ? EX : ''}</h2>${d.date_is_fallback && d.date ? `<p class="notice warn">今天没有指标文件，显示的是最近一天 ${esc(d.date)} 的数据</p>` : ''}${m ? `<table><tr><th>指标</th><th>值</th><th>来源</th></tr>${rows}</table>` : '<p class="muted">— 无 metrics 文件</p>'}
    ${d.metrics_dates.length > 1 ? `<p class="muted">其它日期：${d.metrics_dates.map(esc).join(' · ')}</p>` : ''}</div>
    <div class="cols"><div class="card"><h2>产出的文件（knowledge/agents/${esc(id)}/）</h2>${d.artifacts.length ? d.artifacts.map(x => `<p><a href="#/file/${encodeURIComponent(x.path)}">📄 ${esc(x.name)}</a></p>`).join('') : '<p class="muted">暂无</p>'}</div>
    <div class="card"><h2>日报文件</h2>${d.reports.length ? d.reports.map(x => `<p><a href="#/file/${encodeURIComponent(x.path)}">📄 ${esc(x.path)}</a></p>`).join('') : '<p class="muted">暂无</p>'}</div></div>`;
  } else if (tab === 'plan') {
    body = d.playbooks.length ? d.playbooks.map(p => `<div class="card"><h2>📘 ${esc(p.name)}</h2><details><summary>展开阅读</summary><div class="md">${md(p.markdown)}</div></details></div>`).join('') : '<div class="card"><p class="muted">knowledge/playbooks 下暂无以此 bot 命名的计划/手册</p></div>';
  } else {
    body = `<div class="cols"><div class="card"><h2>给 ${esc(a.name)} 派任务</h2>${taskForm([id], names, id)}</div><div class="card"><h2>它的任务队列</h2>${taskRows(d.tasks, names, false)}</div></div>`;
  }
  app.innerHTML = `<div class="dh">${avatar(id, a.color, 64)}<div><h1>${esc(a.name)}</h1><span class="pill">${esc(r[0])}</span> ${stat(d.status)}</div></div>
  <div class="tabs">${T.map(([k, t]) => `<a href="#/agent/${esc(id)}/${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</div>${body}`;
  if (tab === 'logs') { const draw = () => { const dv = $('#fd').value, q = $('#fq').value.trim().toLowerCase(); const ls = d.logs.filter(e => (!dv || String(e.ts).startsWith(dv)) && (!q || JSON.stringify(e).toLowerCase().includes(q))); $('#fc').textContent = `${ls.length} 条`; $('#tlw').innerHTML = logTL(ls, names); }; $('#fd').onchange = draw; $('#fq').oninput = draw; draw(); }
  if (tab === 'tasks') bindForm(() => agentPage(id, 'tasks'));
  countUp();
}
async function filePage(p) { skel(); const d = await get('/api/kbfile?path=' + encodeURIComponent(p)); if (!AG.length) { const o = await get('/api/overview'); AG = o.agents.agents || []; } side('');
  app.innerHTML = head(p, 'knowledge 知识库文件（只读）') + `<p><a href="#/" id="bk">← 返回</a></p><div class="card">${d.error ? `<p class="err">${esc(d.error)}</p>` : p.endsWith('.md') ? `<div class="md">${md(d.text)}</div>` : `<pre>${esc(d.text)}</pre>`}</div>`; $('#bk').onclick = e => { e.preventDefault(); history.back(); }; }
async function shopifyPage() { skel(); if (!AG.length) { const o = await get('/api/overview'); AG = o.agents.agents || []; } side('#/shopify'); const s = await get('/api/shopify/summary');
  app.innerHTML = head('Shopify 实时数据', s.connected ? `${s.shop_name || 'lovms.com'} · 抓取于 ${shTime(s.fetched_at)} 上海${s.cached ? '（60 秒缓存）' : ''}` : 'lovms.com') + (s.connected ? '' : shopNotConnected(s)) +
  (s.connected ? shopKpis(s) + (s.notes || []).map(n => `<p class="notice">${esc(n)}</p>`).join('') + `<div class="cols"><div class="card"><h2>近 30 天热销商品${s.example ? EX : ''}</h2>${s.top_products.length ? `<table><tr><th>商品</th><th>件数</th><th>销售额</th></tr>${s.top_products.map(p => `<tr><td>${esc(p.title)}</td><td>${p.quantity}</td><td>${money(p.sales, s.currency)}</td></tr>`).join('')}</table>` : '<p class="muted">近 30 天无订单</p>'}</div>
  <div class="card"><h2>最近订单${s.example ? EX : ''}</h2>${s.recent_orders.length ? `<table><tr><th>订单</th><th>时间(上海)</th><th>金额</th><th>客户</th></tr>${s.recent_orders.map(o => `<tr><td>${esc(o.name)}${o.cancelled ? ' <span class="chip err">已取消</span>' : ''}</td><td>${esc(shTime(o.created_at))}</td><td>${money(o.total, o.currency)}</td><td>${esc(o.first_name || '—')}<br><span class="muted">${esc([o.city, o.country].filter(Boolean).join(', '))}</span></td></tr>`).join('')}</table>` : '<p class="muted">暂无订单</p>'}</div></div>
  <p><button class="ghost" id="rf">立即刷新</button></p>` : '');
  const rf = $('#rf'); if (rf) rf.onclick = async () => { await get('/api/shopify/summary?refresh=1'); shopifyPage(); }; countUp(); }
async function accountsPage() { skel(); const [d, o] = await Promise.all([get('/api/accounts'), AG.length ? null : get('/api/overview')]); if (o) AG = o.agents.agents || []; side('#/accounts');
  const names = Object.fromEntries(AG.map(a => [a.id, a.name]));
  app.innerHTML = head('账号连接', '各平台品牌账号的状态与主页链接') + '<div class="notice">⚠️ 这里只记录账号名、主页链接和状态。<b>不要填写密码、令牌或验证码</b>——这些放在密码库/服务器环境变量里。</div>' +
  `<div class="grid">${d.accounts.map(x => `<div class="card acc"><div class="row"><b>${esc(x.label)}</b><span class="chip ${ACC[x.status][0]}">${ACC[x.status][1]}</span></div>
  <div class="muted">${esc(x.handle || '未填写账号')} · 负责：${esc(names[x.owner_agent] || x.owner_agent || '—')}</div>${x.notes ? `<div class="muted">${esc(x.notes)}</div>` : ''}<div class="muted">上次检查：${esc(x.last_checked ? shTime(x.last_checked) + ' 上海' : '—')}</div>
  <div>${safeUrl(x.profile_url) ? `<a class="btn ghost" href="${esc(x.profile_url)}" target="_blank" rel="noopener noreferrer">打开主页 ↗</a>` : '<span class="muted">暂无链接</span>'}</div>
  <details><summary>编辑</summary><form data-p="${esc(x.platform)}"><label>账号名 / handle</label><input type="text" name="handle" maxlength="300" value="${esc(x.handle)}"><label>主页链接（http/https）</label><input type="url" name="profile_url" maxlength="300" value="${esc(x.profile_url)}">
  <label>状态</label><select name="status">${Object.entries(ACC).map(([k, v]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${v[1]}</option>`).join('')}</select><label>备注</label><input type="text" name="notes" maxlength="1000" value="${esc(x.notes)}">
  <p><button>保存</button> <span class="muted msg"></span></p></form></details></div>`).join('')}</div>`;
  app.querySelectorAll('form[data-p]').forEach(f => f.onsubmit = async e => { e.preventDefault(); const b = Object.fromEntries(['handle', 'profile_url', 'status', 'notes'].map(k => [k, f.elements[k].value.trim()]));
    const r = await post('/api/accounts/' + f.dataset.p, b); if (r.status === 200) accountsPage(); else f.querySelector('.msg').textContent = r.data.error; }); }
async function tasksPage() {
  skel(); const [d, o] = await Promise.all([get('/api/tasks'), get('/api/overview')]); AG = (o.agents && o.agents.agents) || []; side('#/tasks'); const names = Object.fromEntries(AG.map(a => [a.id, a.name]));
  const pend = d.tasks.filter(t => t.requires_approval && t.status === 'queued'), rest = d.tasks.filter(t => !pend.includes(t));
  app.innerHTML = head('任务与审批', '给 AI 员工派活；花钱和对外发布需要你批准') + `<div class="cols"><div class="card"><h2>给 Bot 派任务</h2>${taskForm(d.agents, names)}</div>
  <div class="card"><h2>待我批准（${pend.length}）</h2>${taskRows(pend, names, true)}</div></div><div class="card"><h2>全部任务</h2>${taskRows(rest, names)}</div>`;
  try { const p = JSON.parse(sessionStorage.getItem('prefill') || 'null'); if (p) { sessionStorage.removeItem('prefill'); $('#ag').value = p.agent; $('#tx').value = p.text; $('#tx').focus(); $('#msg').textContent = '已预填，确认后点「提交任务」才会发出。'; } } catch {}
  bindForm(tasksPage); bindApprove(tasksPage);
}
// ---------- 主题 / 跑马灯 / 背景 ----------
function isDark() { return document.body.classList.contains('dark'); }
function setTheme(t) { document.body.classList.toggle('dark', t === 'dark'); try { localStorage.setItem('lovms_theme', t); } catch {} bg(); }
let TK = { at: 0, html: '' };
async function ticker() {
  if (Date.now() - TK.at < 60e3 && TK.html) { $('#ticker').innerHTML = TK.html; return; }
  let o, s; try { [o, s] = await Promise.all([get('/api/overview'), get('/api/shopify/summary')]); } catch { return; }
  const A = (o.agents && o.agents.agents) || [], nm = Object.fromEntries(A.map(a => [a.id, a.name])), items = [];
  if (s && s.connected) { const b = s.example ? ' <span class="badge">示例数据</span>' : ''; items.push(`<b>Shopify</b> 今日 ${money(s.today.sales, s.currency)} · ${s.today.orders} 单 · 近 7 天 ${money(s.d7.sales, s.currency)}${b}`); }
  for (const a of A) { const st = o.statuses[a.id]; if (st) items.push(`<span class="st ${esc(st.key)}"><i></i></span>${esc(a.name)} ${esc(st.label)}`); }
  for (const e of o.logs.slice(0, 12)) items.push(`<span class="tt">${esc(String(e.ts || '').slice(5, 16).replace('T', ' '))}</span> <b>${esc(nm[e.agent_id] || e.agent_id)}</b> ${esc(e.message)}${e.example ? ' <span class="badge">示例数据</span>' : ''}`);
  const one = items.map(x => `<span class="ti">${x}</span>`).join('<span class="sep">◆</span>');
  TK = { at: Date.now(), html: items.length ? `<div class="tk-l">● LIVE</div><div class="tk-w"><div class="tk-m">${one}<span class="sep">◆</span>${one}<span class="sep">◆</span></div></div>` : '<div class="tk-l">● LIVE</div><div class="tk-w"><span class="ti">暂无动态</span></div>' };
  $('#ticker').innerHTML = TK.html;
}
let raf = 0;
function bg() {
  const c = $('#bg'); cancelAnimationFrame(raf); const x = c.getContext('2d');
  const off = !isDark() || matchMedia('(prefers-reduced-motion: reduce)').matches || innerWidth < 861;
  c.width = innerWidth; c.height = innerHeight; x.clearRect(0, 0, c.width, c.height); if (off) return;
  const N = Array.from({ length: 34 }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, vx: (Math.random() - .5) * .18, vy: (Math.random() - .5) * .18 }));
  const P = Array.from({ length: 10 }, () => ({ a: 0, b: 1, t: Math.random() }));
  const tick = () => { x.clearRect(0, 0, c.width, c.height); const E = [];
    for (const n of N) { n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > c.width) n.vx *= -1; if (n.y < 0 || n.y > c.height) n.vy *= -1; }
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) { const d = Math.hypot(N[i].x - N[j].x, N[i].y - N[j].y); if (d < 220) { E.push([i, j]); x.strokeStyle = `rgba(56,189,248,${.12 * (1 - d / 220)})`; x.beginPath(); x.moveTo(N[i].x, N[i].y); x.lineTo(N[j].x, N[j].y); x.stroke(); } }
    x.fillStyle = 'rgba(99,102,241,.45)'; for (const n of N) { x.beginPath(); x.arc(n.x, n.y, 1.8, 0, 7); x.fill(); }
    for (const p of P) { p.t += .006; if (p.t > 1 || !E.some(e => e[0] === p.a && e[1] === p.b)) { const e = E[Math.floor(Math.random() * E.length)]; if (!e) continue; [p.a, p.b] = e; p.t = 0; }
      const A = N[p.a], B = N[p.b], px = A.x + (B.x - A.x) * p.t, py = A.y + (B.y - A.y) * p.t; x.fillStyle = 'rgba(56,189,248,.9)'; x.shadowColor = '#38BDF8'; x.shadowBlur = 10; x.beginPath(); x.arc(px, py, 2.2, 0, 7); x.fill(); x.shadowBlur = 0; }
    raf = requestAnimationFrame(tick); };
  tick();
}
try { if (localStorage.getItem('lovms_theme') === 'light') document.body.classList.remove('dark'); } catch {}
addEventListener('resize', () => { clearTimeout(bg.t); bg.t = setTimeout(bg, 300); });
document.addEventListener('visibilitychange', () => document.hidden ? cancelAnimationFrame(raf) : bg());
// =================== v3「公司运转台」（仿参考视频布局） ===================
const DOM = { shopify: ['电商', '#FB923C'], facebook: ['Facebook/IG', '#60A5FA'], tiktok: ['TikTok', '#F472B6'], pinterest: ['Pinterest', '#F87171'], 'seo-geo': ['SEO/GEO', '#34D399'], 'influencer-bd': ['达人 BD', '#22D3EE'], fulfillment: ['履约售后', '#FACC15'], 'ops-kb': ['运营·知识库', '#A78BFA'] };
const COLS = Object.keys(DOM), CEO_C = '#2DD4BF', FOUNDER_C = '#F97316';
let ST = null; // 全局数据缓存
async function load(force) { if (!force && ST && Date.now() - ST.at < 30e3) return ST;
  const [o, s, ac] = await Promise.all([get('/api/overview'), get('/api/shopify/summary'), get('/api/accounts')]); AG = (o.agents && o.agents.agents) || [];
  ST = { at: Date.now(), o, s, ac: ac.accounts || [] }; return ST; }
const hhmm = ts => ts ? String(ts).slice(11, 16) : '—', mmdd = ts => ts ? String(ts).slice(5, 10) : '—';
const nowSHs = () => new Date(Date.now() + 8 * 3600e3).toISOString();
function nextRun(a) { const now = nowSHs().slice(11, 16), t = (a && a.schedule || []).flatMap(s => cronTimes(s.cron) || []).sort(); return t.length ? (t.find(x => x > now) || t[0]) : '—'; }
const pend = o => o.tasks.filter(t => t.requires_approval && ['queued', 'awaiting_approval'].includes(t.status));
const decide = o => ((o.todo && o.todo.items) || []).filter(t => t.needs_ceo_decision && !['done', 'closed'].includes(t.status));
function side(r) { // 顶部导航（复用 #side 容器）
  const o = ST && ST.o, n = o ? pend(o).length + decide(o).filter(t => !t.example).length : 0, run = o ? Object.values(o.statuses).filter(x => x.key === 'running').length : 0, tot = AG.length;
  const tabs = [['#/', '总览'], ['#/shop', '电商'], ['#/content', '内容渠道'], ['#/seo', 'SEO'], ['#/accounts', '账号连接'], ['#/work', 'AI 工作'], ['#/todo', '待办']];
  $('#side').innerHTML = `<a href="#/" class="tlogo"><b>LOVMS</b><small>公司运转台</small></a><nav>${tabs.map(([h, t]) => `<a href="${h}" class="${r === h || (h === '#/todo' && r === '#/tasks') ? 'on' : ''}">${t}${h === '#/todo' && n ? `<span class="rb">${n}</span>` : ''}</a>`).join('')}</nav>
  <div class="tr"><span class="st ${run ? 'running' : ''}"><i></i>${run}/${tot} 个 Agent 在岗</span><span id="clk" class="clk"></span>
  <label class="sw"><input type="checkbox" id="hn" ${document.body.classList.contains('hide-names') ? 'checked' : ''}><span>隐藏店名</span></label>
  <a href="#" id="tg" title="切换主题">${isDark() ? '☀️' : '🌙'}</a><a href="#" id="lo" title="退出">退出</a></div>`;
  $('#tg').onclick = e => { e.preventDefault(); setTheme(isDark() ? 'light' : 'dark'); side(r); };
  $('#lo').onclick = async e => { e.preventDefault(); await post('/api/logout'); ST = null; login(); };
  $('#hn').onchange = e => { document.body.classList.toggle('hide-names', e.target.checked); try { localStorage.setItem('lovms_hn', e.target.checked ? '1' : ''); } catch {} };
  tickClock(); }
function tickClock() { const c = $('#clk'); if (c) c.textContent = nowSHs().slice(11, 19) + ' 上海'; }
setInterval(tickClock, 1000);
try { if (localStorage.getItem('lovms_hn')) document.body.classList.add('hide-names'); } catch {}
// ---- 小图表（全部用真实序列；没有就显示暂无数据） ----
function bars(vals, labels, color = '#38BDF8', h = 90, hl = -1) { if (!vals || !vals.length || vals.every(v => !v)) return '<p class="muted">暂无数据</p>';
  const max = Math.max(...vals), w = 100 / vals.length; return `<svg class="bars" viewBox="0 0 100 ${h + 14}" preserveAspectRatio="none">${vals.map((v, i) => { const bh = v / max * h; return `<rect x="${i * w + w * .15}" y="${h - bh}" width="${w * .7}" height="${Math.max(bh, .5)}" rx="1" fill="${i === hl ? '#F43F5E' : color}" opacity="${v ? 1 : .25}"><title>${esc(labels ? labels[i] : '')}: ${v}</title></rect>`; }).join('')}</svg>${labels ? `<div class="bl">${labels.map((l, i) => `<span class="${i === hl ? 'hl' : ''}">${esc(l)}</span>`).join('')}</div>` : ''}`; }
function area(vals, labels, color = '#38BDF8') { if (!vals || vals.length < 2 || vals.every(v => !v)) return '<p class="muted">暂无数据</p>'; const max = Math.max(...vals, 1), W = 300, H = 110;
  const p = vals.map((v, i) => [i * W / (vals.length - 1), H - 6 - v / max * (H - 16)]), l = p.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('');
  return `<svg class="area" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${l}L${W} ${H}L0 ${H}Z" fill="${color}" fill-opacity=".15"/><path d="${l}" fill="none" stroke="${color}" stroke-width="2"/>${p.map(q => `<circle cx="${q[0]}" cy="${q[1]}" r="2.2" fill="${color}"/>`).join('')}</svg><div class="bl">${labels.filter((_, i) => i % Math.ceil(labels.length / 8) === 0).map(x => `<span>${esc(x)}</span>`).join('')}</div>`; }
function realLogs(o, a) { return o.logs.filter(e => !e.example && (!a || e.agent_id === a)); }
function dayCounts(o, a, n = 14) { const out = [], lab = []; for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() + 8 * 3600e3 - i * 864e5).toISOString().slice(0, 10); lab.push(d.slice(8)); out.push(realLogs(o, a).filter(e => String(e.ts).startsWith(d)).length); } return [out, lab]; }
// ---- 每个领域的主卡 + 子卡数据（真实来源） ----
function headline(o, id) { const m = o.metrics[id], ag = AG.find(a => a.id === id) || {}, k = ag.kpi_headline || {}; const mv = m && m.metrics ? m.metrics[k.metric_key] : null;
  return { v: m ? fmt(mv) : '—', cap: k.label || '', ex: !!(m && m.example), date: o.metrics_date }; }
function colData(id) { const { o, s, ac } = ST, meta = o.agent_meta[id] || { tasks: {} }, acc = ac.filter(x => x.owner_agent === id); let main, subs = [];
  if (id === 'shopify') { const ok = s && s.connected, b = ok && s.example;
    main = { v: ok ? money(s.d7.sales, s.currency) : '—', cap: ok ? '近 7 天销售' : 'Shopify 未连接', ex: b };
    subs = ok ? [['今日销售', money(s.today.sales, s.currency), `${s.today.orders} 单`], ['近 30 天', money(s.d30.sales, s.currency), `${s.d30.orders} 单 · 客单 ${money(s.d30.aov)}`], ['热销', s.top_products[0] ? esc(s.top_products[0].title).slice(0, 22) : '—', s.top_products[0] ? `${s.top_products[0].quantity} 件` : ''], ['在售商品', s.products && s.products.active != null ? s.products.active : '—', s.products && s.products.draft != null ? `草稿 ${s.products.draft}` : '']].map(x => ({ t: x[0], v: x[1], c: x[2], ex: b, key: 'shop:' + x[0] }))
      : [{ t: '店铺', v: '<span class="nm">lovms.com</span>', c: '实时数据未连接', key: 'shop:none' }]; }
  else { const h = headline(o, id); main = { v: h.v, cap: h.cap + (h.v === '—' ? '（无数据）' : ''), ex: h.ex }; }
  subs = subs.concat(acc.filter(x => id !== 'shopify' || x.platform !== 'shopify').map(x => ({ t: x.label, v: `<span class="chip ${ACC[x.status][0]}">${ACC[x.status][1]}</span>`, c: x.handle ? `<span class="nm">${esc(x.handle)}</span>` : '未填写账号', key: 'acc:' + x.platform })));
  if (id === 'ops-kb') subs.push({ t: '手册 playbooks', v: o.kb_stats.playbooks, c: '篇', key: 'kb:pb' }, { t: '日报归档', v: o.kb_stats.report_days, c: '天', key: 'kb:rep' });
  subs.push({ t: '任务', v: `${meta.tasks.queued || 0} / ${meta.tasks.in_progress || 0} / ${meta.tasks.done || 0}`, c: '已安排 / 执行中 / 完成', key: 'task:' + id });
  return { main, subs, meta }; }
// ---- 总览 ----
async function overview() {
  skel(); const { o, s } = await load(true); side('#/'); const T = o.today, rl = realLogs(o);
  const stat6 = [[rl.filter(e => e.agent_id === 'ceo' && e.event === 'patrol' && e.ts.startsWith(T)).length, '今天巡视', CEO_C], [o.tasks.filter(t => String(t.created_at).startsWith(T)).length, '今天派活', '#60A5FA'], [pend(o).length, '等你批准', '#F43F5E'],
    [rl.filter(e => e.event === 'report_written' && e.ts.startsWith(T)).length, '今天汇报', '#34D399'], [ST.ac.filter(a => a.status === 'connected').length, '已连接平台', '#A78BFA'], [rl.filter(e => e.ts.startsWith(T)).length, '今天日志', '#FACC15']];
  const ceo = AG.find(a => a.id === 'ceo') || { name: 'CEO Agent' }, cst = o.statuses.ceo || {}, wait = pend(o).length + decide(o).length, dueNext = decide(o).map(t => t.due).filter(Boolean).sort()[0];
  const cRep = o.agent_meta.ceo.last_report, ceoSched = (ceo.schedule || []).flatMap(x => cronTimes(x.cron) || []);
  const col = id => { const a = AG.find(x => x.id === id) || { id, name: id }, st = o.statuses[id] || {}, d = colData(id), mt = d.meta, [nm, c] = DOM[id];
    return `<div class="tcol" data-id="${id}" data-st="${esc(st.key)}" data-c="${c}"><div class="lchip" data-c="${c}"><span>↓ 派活 ${mt.tasks.queued + mt.tasks.in_progress} 件</span><span>↑ 汇报 ${mt.last_report ? esc(mmdd(mt.last_report.date + 'T')) : '—'}${mt.last_report && mt.last_report.example ? '<em>示例</em>' : ''}</span></div>
    <a class="tnode main" href="#/agent/${id}/logs" data-pop="agent:${id}" data-c="${c}"><div class="mh">${avatar(id, c, 22)}<b>${esc(a.name)}</b><span class="dot ${esc(st.key)}" title="${esc(st.label)}"></span></div>
    <div class="mv">${d.main.v}${d.main.ex ? EX : ''}</div><div class="muted">${esc(d.main.cap)}</div><div class="muted lt">上次 ${hhmm(mt.last_log_ts)} · 下次 ${esc(nextRun(a))}</div></a>
    <div class="subs">${d.subs.map(x => `<div class="tnode sub" data-pop="${esc(x.key)}" data-c="${c}"><i></i><div><b>${esc(x.t)}</b><div class="muted">${x.c || ''}</div></div><div class="sv">${x.v}${x.ex ? '<em>示例</em>' : ''}</div></div>`).join('')}</div></div>`; };
  app.innerHTML = `<div class="ohead"><div><div class="muted mono">LOVMS · ${esc(T)}</div><h1>公司运转图 <span class="live">LIVE</span></h1><p class="muted">鼠标放到任一岗位或平台上看详情，点进去看工作日志。数据来自知识库文件、任务收件箱与 Shopify${s.example ? '（当前 Shopify 为示例模式）' : ''}。</p></div>
   <div class="s6">${stat6.map(([v, l, c]) => `<div class="s6c" data-c="${c}"><b data-count="${v}" data-kind="int">0</b><span>${l}</span></div>`).join('')}</div></div>
  <div class="tree" id="tree"><svg class="tl2" id="tl2" aria-hidden="true"></svg>
   <div class="trow"><div class="tnode founder" data-pop="founder"><span class="fa">T</span><div><b>ting</b><div class="muted">创始人 · 拍板定方向</div></div><a href="#/todo" class="wait">等你 ${wait} 件</a></div></div>
   <div class="trow mid"><div class="flab l"><span class="r">↓ 拍板 · 定方向</span><span class="muted">等你 ${wait} 件${dueNext ? ' · ' + esc(mmdd(dueNext + 'T')) + ' 到期' : ''}</span></div><div class="gap"></div><div class="flab r"><span class="g">↑ 汇报 ${cRep ? esc(mmdd(cRep.date + 'T')) : '—'}${cRep && cRep.example ? '<em>示例</em>' : ''}</span><span class="muted">${ceoSched.length ? '每天 ' + ceoSched.length + ' 次' : '—'}</span></div></div>
   <div class="trow"><a class="tnode ceo" href="#/agent/ceo/logs" data-pop="agent:ceo" data-id="ceo" data-st="${esc(cst.key)}"><span class="radar2"><i></i></span><div><b>${esc(ceo.name)}</b> <span class="dot ${esc(cst.key)}"></span>
     <div class="muted">${(ceo.schedule || []).map(x => esc(x.task)).join(' · ') || '—'} · 今天 ${stat6[0][0]} 轮</div><div class="cs">${esc(cst.label || '待命')} · ${esc(cst.why || '')}</div></div></a></div>
   <div class="cols7">${COLS.map(col).join('')}</div></div>
  <div class="ogrid">
   <div class="card span2"><h2>排班表 <span class="muted">每个岗位每天几点干活 · 红线为现在（上海时间）</span></h2>${schedule()}</div>
   <div class="card"><h2>电商整体情况 <span class="muted">近 14 天每日销售${s.example ? EX : ''}</span></h2>${s.connected ? bars(s.series_30d.slice(-14).map(x => x.sales), s.series_30d.slice(-14).map(x => x.date.slice(8)), '#FB923C', 90, 13) : shopNotConnected(s)}</div>
   <div class="card"><h2>经营效果 <span class="muted">各岗位头条指标 · ${esc(o.metrics_date || '—')}</span></h2><table>${COLS.map(id => { const h = id === 'shopify' ? colData(id).main : headline(o, id); return `<tr><td><span class="dot2" data-c="${DOM[id][1]}"></span>${esc(DOM[id][0])}</td><td>${esc(h.cap)}</td><td class="r">${h.v}${h.ex ? EX : ''}</td></tr>`; }).join('')}</table></div>
   <div class="card"><h2>company.log <span class="muted">各岗位在干什么</span></h2><div class="term" id="term">${termRows(o.logs.slice(0, 60))}</div></div>
   <div class="card"><h2>待办 <span class="muted">等你拍板 / 批准</span> <a class="muted" href="#/todo">全部 →</a></h2>${todoList(o, 6)}</div></div>`;
  countUp(); tint(); drawTree(); bindPops(); autoScroll(); }
function tint() { app.querySelectorAll('[data-c]').forEach(el => el.style.setProperty('--c', el.dataset.c)); }
function termRows(ls) { const nm = Object.fromEntries(AG.map(a => [a.id, a.name])); return ls.length ? ls.slice().reverse().map(e => `<div class="tr1"><span class="t">${esc(String(e.ts).slice(5, 16).replace('T', ' '))}</span><span class="a" data-c="${(DOM[e.agent_id] || [0, CEO_C])[1]}">${esc(nm[e.agent_id] || e.agent_id)}</span><span class="m">${esc(e.message)}${e.example ? ' <em>示例</em>' : ''}</span></div>`).join('') : '<div class="muted">暂无日志</div>'; }
function autoScroll() { const t = $('#term'); if (!t) return; t.scrollTop = t.scrollHeight; }
function todoList(o, n) { const nm = Object.fromEntries(AG.map(a => [a.id, a.name]));
  const it = decide(o).map(t => ({ p: t.priority, title: t.title, id: t.id, who: nm[t.owner_agent] || t.owner_agent, st: '等你拍板', date: t.due ? '到期 ' + mmdd(t.due + 'T') : '', ex: t.example }))
    .concat(pend(o).map(t => ({ p: t.priority, title: t.text, id: t.id, who: nm[t.agent] || t.agent, st: '等你批准', date: '创建 ' + mmdd(t.created_at), ex: false })));
  return it.length ? '<div class="todo">' + it.slice(0, n || 99).map(t => `<a class="ti2" href="#/todo"><span class="pt ${esc(t.p)}">${esc(t.p)}</span><div><b>${esc(t.title)}</b>${t.ex ? EX : ''}<div class="muted">${esc(t.id)} · ${esc(t.who)} · <span class="o">${esc(t.st)}</span></div></div><span class="muted">${esc(t.date)}</span></a>`).join('') + '</div>' : '<p class="muted">暂无待办</p>'; }
function schedule() { const now = nowSHs(), pos = (+now.slice(11, 13) * 60 + +now.slice(14, 16)) / 1440 * 100;
  const rows = AG.map(a => { const t = (a.schedule || []).flatMap(s => (cronTimes(s.cron) || []).map(x => [x, s.task])); const c = (DOM[a.id] || [0, CEO_C])[1];
    return `<div class="sr"><span class="sn">${esc(a.name)}</span><div class="sl">${t.map(([x, task]) => `<i data-c="${c}" data-l="${(+x.slice(0, 2) * 60 + +x.slice(3)) / 14.4}" title="${esc(x + ' ' + task)}"></i>`).join('')}</div></div>`; }).join('');
  setTimeout(() => app.querySelectorAll('.sl i').forEach(i => i.style.left = i.dataset.l + '%'), 0); setTimeout(() => { const n = $('#nowl'); if (n) n.style.left = `calc(110px + (100% - 110px) * ${pos / 100})`; }, 0);
  return `<div class="sched"><div class="sax"><span></span>${[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => `<b>${String(h).padStart(2, '0')}:00</b>`).join('')}</div>${rows}<div class="nowl" id="nowl"></div></div>`; }
// ---- 连线：创始人⇄CEO 弧线 + CEO→各岗位 PCB 走线 + 光点 ----
function drawTree() { const tree = $('#tree'), svg = $('#tl2'); if (!tree || !svg) return;
  const o = tree.getBoundingClientRect(), R = el => { const r = el.getBoundingClientRect(); return { l: r.left - o.left, t: r.top - o.top, r: r.right - o.left, b: r.bottom - o.top, cx: (r.left + r.right) / 2 - o.left, cy: (r.top + r.bottom) / 2 - o.top }; };
  svg.setAttribute('width', o.width); svg.setAttribute('height', o.height); svg.setAttribute('viewBox', `0 0 ${o.width} ${o.height}`);
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches, F = R(tree.querySelector('.founder')), C = R(tree.querySelector('.ceo')), narrow = innerWidth < 861;
  const L = []; let k = 0;
  const rnd = pts => pts.reduce((s, p, i) => { if (!i) return `M${p[0]} ${p[1]}`; const n = pts[i + 1]; if (!n) return s + ` L${p[0]} ${p[1]}`; const q = pts[i - 1]; const d1 = Math.hypot(p[0] - q[0], p[1] - q[1]), d2 = Math.hypot(n[0] - p[0], n[1] - p[1]), r = Math.min(12, d1 / 2, d2 / 2);
    const a = [p[0] - (p[0] - q[0]) / d1 * r, p[1] - (p[1] - q[1]) / d1 * r], b = [p[0] + (n[0] - p[0]) / d2 * r, p[1] + (n[1] - p[1]) / d2 * r]; return s + ` L${a[0].toFixed(1)} ${a[1].toFixed(1)} Q${p[0]} ${p[1]} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`; }, '');
  const add = (d, c, on, dn, up) => { const id = 'tp' + k++; L.push(`<path id="${id}" d="${d}" class="tw ${on ? 'on' : ''}" stroke="${c}"/>`);
    if (motion) { const pt = (rev, dur, beg) => `<rect class="pk ${on ? 'on' : ''}" width="10" height="3.6" rx="1.8" x="-5" y="-1.8" fill="${c}"><animateMotion dur="${dur}s" begin="${beg}s" repeatCount="indefinite" rotate="auto" ${rev ? 'keyPoints="1;0" keyTimes="0;1" calcMode="linear"' : ''}><mpath href="#${id}"/></animateMotion></rect>`;
      for (let i = 0; i < dn; i++) L.push(pt(0, 3.2, -i * 1.1 - k * .37)); for (let i = 0; i < up; i++) L.push(pt(1, 3.8, -i * 1.3 - k * .51)); } };
  const cols = [...tree.querySelectorAll('.tcol')];
  if (!narrow) {
    add(`M${F.cx - 26} ${F.b} C${F.cx - 90} ${(F.b + C.t) / 2}, ${C.cx - 90} ${(F.b + C.t) / 2}, ${C.cx - 26} ${C.t}`, '#F43F5E', true, Math.min(3, pend(ST.o).length + decide(ST.o).length) || 1, 0);
    add(`M${C.cx + 26} ${C.t} C${C.cx + 90} ${(F.b + C.t) / 2}, ${F.cx + 90} ${(F.b + C.t) / 2}, ${F.cx + 26} ${F.b}`, CEO_C, true, 1, 0);
    cols.forEach((col, i) => { const ch = R(col.querySelector('.lchip')), mn = R(col.querySelector('.main')), id = col.dataset.id, on = col.dataset.st === 'running', mt = ST.o.agent_meta[id].tasks, c = DOM[id][1];
      const sx = C.cx + (i - (cols.length - 1) / 2) * 10, y = C.b + 16 + Math.abs(i - (cols.length - 1) / 2) * 7;
      add(rnd([[sx, C.b], [sx, y], [ch.cx, y], [ch.cx, ch.t]]), c, on, on ? Math.min(3, mt.queued + mt.in_progress) || 1 : 1, on ? 1 : 0);
      L.push(`<path d="M${ch.cx} ${ch.b} L${ch.cx} ${mn.t}" class="tw ${on ? 'on' : ''}" stroke="${c}"/>`);
      const subs = [...col.querySelectorAll('.sub')].map(R); if (subs.length) { const x = mn.l + 12, last = subs[subs.length - 1]; add(rnd([[x, mn.b], [x, last.cy], [last.l, last.cy]]), c, on, 0, 0);
        subs.slice(0, -1).forEach(s => L.push(`<path d="M${x} ${s.cy} L${s.l} ${s.cy}" class="tw ${on ? 'on' : ''}" stroke="${c}"/>`)); } });
  } else { const nodes = [...tree.querySelectorAll('.founder,.ceo,.main,.sub')].map(el => ({ el, ...R(el) })), x = 8, last = nodes[nodes.length - 1];
    add(`M${x} ${nodes[0].cy} L${x} ${last.cy}`, CEO_C, true, 2, 0); nodes.forEach(n => L.push(`<path d="M${x} ${n.cy} L${n.l} ${n.cy}" class="tw on" stroke="${(n.el.dataset.c) || CEO_C}"/>`)); }
  svg.innerHTML = '<defs><filter id="gl" filterUnits="userSpaceOnUse" x="-20" y="-20" width="${o.width + 40}" height="${o.height + 40}"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' + L.join(''); }
addEventListener('resize', () => { clearTimeout(drawTree.t); drawTree.t = setTimeout(drawTree, 150); });
// ---- 悬停弹层（只显示真实数据） ----
function popHTML(key) { const { o, s } = ST, nm = Object.fromEntries(AG.map(a => [a.id, a.name]));
  if (key === 'founder') return `<h3>ting · 创始人</h3><p class="muted">等你拍板 ${decide(o).length} 件 · 等你批准 ${pend(o).length} 件</p>${todoList(o, 5)}`;
  let m; if ((m = key.match(/^agent:(.+)$/))) { const id = m[1], [v, lab] = dayCounts(o, id), st = o.statuses[id] || {}, mt = o.agent_meta[id];
    const tl = realLogs(o, id).slice(0, 6), exN = o.logs.filter(e => e.example && e.agent_id === id).length;
    return `<h3>${esc(nm[id] || id)} <span class="st ${esc(st.key)}"><i></i>${esc(st.label || '')}</span></h3><div class="muted">近 14 天每日日志条数（真实，不含示例）</div>${bars(v, lab, (DOM[id] || [0, CEO_C])[1], 60, 13)}
    <div class="pg"><div><span class="muted">已安排</span><b>${mt.tasks.queued}</b></div><div><span class="muted">执行中</span><b>${mt.tasks.in_progress}</b></div><div><span class="muted">已完成</span><b>${mt.tasks.done}</b></div><div><span class="muted">上次日报</span><b>${mt.last_report ? esc(mt.last_report.date.slice(5)) : '—'}</b></div></div>
    ${id === 'shopify' && s.connected ? `<div class="muted">最近订单${s.example ? EX : ''}</div><ul class="tl">${s.recent_orders.slice(0, 5).map(r => `<li><span class="muted">${esc(shTime(r.created_at))}</span> ${esc(r.name)} · ${money(r.total, r.currency)}</li>`).join('')}</ul>` : ''}
    <div class="muted">最近动作</div>${tl.length ? `<ul class="tl">${tl.map(e => `<li><span class="muted">${esc(String(e.ts).slice(5, 16).replace('T', ' '))}</span> ${esc(e.message)}</li>`).join('')}</ul>` : `<p class="muted">暂无真实日志${exN ? `（另有 ${exN} 条示例日志未计入）` : ''}</p>`}<p class="muted">点一下看工作日志 →</p>`; }
  if ((m = key.match(/^shop:(.+)$/))) return s.connected ? `<h3>Shopify · ${esc(m[1])}${s.example ? EX : ''}</h3><div class="muted">近 14 天每日销售</div>${bars(s.series_30d.slice(-14).map(x => x.sales), s.series_30d.slice(-14).map(x => x.date.slice(8)), '#FB923C', 60, 13)}
    <div class="pg"><div><span class="muted">今日</span><b>${money(s.today.sales)}</b></div><div><span class="muted">近 7 天</span><b>${money(s.d7.sales)}</b></div><div><span class="muted">近 30 天订单</span><b>${s.d30.orders}</b></div><div><span class="muted">客单价</span><b>${money(s.d30.aov)}</b></div></div>` : `<h3>Shopify 未连接</h3><p class="muted">${esc(s.hint || '')}</p>`;
  if ((m = key.match(/^acc:(.+)$/))) { const x = ST.ac.find(a => a.platform === m[1]); return x ? `<h3>${esc(x.label)} <span class="chip ${ACC[x.status][0]}">${ACC[x.status][1]}</span></h3><p>账号：<span class="nm">${esc(x.handle || '—')}</span></p><p class="muted">${esc(x.notes || '')}</p><p class="muted">上次检查：${esc(x.last_checked ? shTime(x.last_checked) : '—')}</p><p class="muted">在「账号连接」里修改</p>` : ''; }
  if ((m = key.match(/^task:(.+)$/))) { const ts = o.tasks.filter(t => t.agent === m[1]).slice(0, 6); return `<h3>${esc(nm[m[1]])} · 任务</h3>${ts.length ? `<ul class="tl">${ts.map(t => `<li><span class="muted">${esc(shTime(t.created_at))}</span> ${esc(t.text.slice(0, 60))} <span class="chip">${esc(STATUS[t.status] || t.status)}</span></li>`).join('')}</ul>` : '<p class="muted">暂无任务</p>'}`; }
  if (key.startsWith('kb:')) return `<h3>知识库</h3><div class="pg"><div><span class="muted">手册</span><b>${o.kb_stats.playbooks}</b></div><div><span class="muted">日报天数</span><b>${o.kb_stats.report_days}</b></div><div><span class="muted">指标天数</span><b>${o.kb_stats.metrics_days}</b></div><div><span class="muted">岗位文件</span><b>${o.kb_stats.agent_files}</b></div></div>`;
  return ''; }
function bindPops() { if (matchMedia('(hover: none)').matches) return; let pop = $('#pop'); if (!pop) { pop = document.createElement('div'); pop.id = 'pop'; document.body.appendChild(pop); }
  app.querySelectorAll('[data-pop]').forEach(el => { el.onmouseenter = () => { const h = popHTML(el.dataset.pop); if (!h) return; pop.innerHTML = h; tintIn(pop); document.body.classList.add('dim'); el.classList.add('lit');
    const r = el.getBoundingClientRect(), W = 340; pop.style.width = W + 'px'; pop.classList.add('on'); const ph = pop.offsetHeight; let x = r.right + 14; if (x + W > innerWidth - 8) x = r.left - W - 14; if (x < 8) x = 8;
    pop.style.left = x + 'px'; pop.style.top = Math.max(8, Math.min(r.top, innerHeight - ph - 8)) + 'px'; };
    el.onmouseleave = () => { pop.classList.remove('on'); document.body.classList.remove('dim'); el.classList.remove('lit'); }; }); }
function tintIn(root) { root.querySelectorAll('[data-c]').forEach(el => el.style.setProperty('--c', el.dataset.c)); }
// ---- 其它标签页 ----
async function shopTab() { skel(); const { s } = await load(); side('#/shop');
  app.innerHTML = `<div class="crumb muted">电商 · Shopify</div>` + head('电商', s.connected ? `${s.shop_name || 'lovms.com'} · 抓取于 ${shTime(s.fetched_at)} 上海` : 'lovms.com') + (s.connected ? '' : shopNotConnected(s)) +
  (s.connected ? shopKpis(s) + `<div class="cols"><div class="card"><h2>每日销售 <span class="muted">近 30 天</span>${s.example ? EX : ''}</h2>${area(s.series_30d.map(x => x.sales), s.series_30d.map(x => x.date.slice(5)), '#FB923C')}</div>
   <div class="card"><h2>每日订单 vs 访客 <span class="muted">近 30 天</span>${s.example ? EX : ''}</h2>${bars(s.series_30d.map(x => x.orders), s.series_30d.map(x => x.date.slice(8)), '#38BDF8', 90, 29)}<div class="muted">访客：${s.sessions ? '' : '暂无数据（需 read_reports）'}</div>${s.sessions ? area(s.sessions.series.map(x => x.sessions), s.sessions.series.map(x => x.date.slice(5)), '#34D399') : ''}</div></div>
   <div class="cols"><div class="card"><h2>热销商品${s.example ? EX : ''}</h2>${hbars(s.top_products.map(p => [p.title, p.sales, money(p.sales)]), '#FB923C')}</div><div class="card"><h2>最近订单${s.example ? EX : ''}</h2>${s.recent_orders.length ? `<table>${s.recent_orders.map(r => `<tr><td>${esc(r.name)}</td><td>${esc(shTime(r.created_at))}</td><td>${money(r.total, r.currency)}</td><td>${esc(r.first_name || '—')} <span class="muted">${esc([r.city, r.country].filter(Boolean).join(', '))}</span></td></tr>`).join('')}</table>` : '<p class="muted">暂无</p>'}</div></div>` : '');
  countUp(); tint(); }
function hbars(rows, c) { if (!rows.length) return '<p class="muted">暂无数据</p>'; const max = Math.max(...rows.map(r => r[1]), 1); return rows.map(r => `<div class="hb"><span>${esc(r[0])}</span><div><i data-w="${r[1] / max * 100}" data-c="${c}"></i></div><b>${r[2]}</b></div>`).join(''); }
function fixW() { app.querySelectorAll('.hb i').forEach(i => i.style.width = i.dataset.w + '%'); }
async function contentTab() { skel(); const { o } = await load(); side('#/content');
  app.innerHTML = `<div class="crumb muted">内容渠道</div>` + head('内容渠道', 'Facebook/IG · TikTok · Pinterest — 粉丝/曝光数据接入后自动出现；没有数据显示「—」') + `<div class="cols3x">${['facebook', 'tiktok', 'pinterest'].map(id => { const d = colData(id), h = headline(o, id), m = o.metrics[id], meta = o.agent_meta[id];
    const rows = m && m.metrics ? Object.entries(m.metrics).filter(([, v]) => v && !Array.isArray(v) && typeof v.value === 'number') : [];
    return `<div class="card topc" data-c="${DOM[id][1]}"><div class="lab">${esc(DOM[id][0])}</div><div class="kv">${h.v}${h.ex ? EX : ''}</div><div class="muted">${esc(h.cap)} · ${esc(o.metrics_date || '—')}</div>
    ${d.subs.map(x => `<p class="row2"><span>${esc(x.t)}</span><span>${x.v}</span></p>`).join('')}
    <h2>指标分布</h2>${rows.length ? hbars(rows.map(([k, v]) => [k, v.value, fmt(v)]), DOM[id][1]) : '<p class="muted">暂无数据</p>'}
    <p class="muted">上次日报：${meta.last_report ? `<a href="#/file/${encodeURIComponent(meta.last_report.path)}">${esc(meta.last_report.date)}</a>${meta.last_report.example ? EX : ''}` : '—'}</p><a class="btn ghost" href="#/agent/${id}/logs">工作日志 →</a></div>`; }).join('')}</div>`;
  tint(); fixW(); }
async function seoTab() { skel(); const { o } = await load(); side('#/seo'); const d = colData('seo-geo'), h = headline(o, 'seo-geo'), m = o.metrics['seo-geo'], meta = o.agent_meta['seo-geo'];
  const rows = m && m.metrics ? Object.entries(m.metrics).filter(([, v]) => v && !Array.isArray(v) && 'value' in v) : [];
  app.innerHTML = `<div class="crumb muted">SEO / GEO</div>` + head('SEO', '站内外 SEO 与 AI 搜索可见度') + `<div class="cols"><div class="card topc" data-c="#34D399"><div class="lab">${esc(h.cap)}</div><div class="kv">${h.v}${h.ex ? EX : ''}</div>${d.subs.map(x => `<p class="row2"><span>${esc(x.t)}</span><span>${x.v}</span></p>`).join('')}</div>
  <div class="card"><h2>指标 · ${esc(o.metrics_date || '—')}${m && m.example ? EX : ''}</h2>${rows.length ? `<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${fmt(v)}</td></tr>`).join('')}</table>` : '<p class="muted">暂无数据</p>'}<p class="muted">上次日报：${meta.last_report ? esc(meta.last_report.date) : '—'}</p><a class="btn ghost" href="#/agent/seo-geo/plan">计划与手册 →</a></div></div>`; tint(); }
async function workTab() { skel(); const { o } = await load(true); side('#/work'); const nm = Object.fromEntries(AG.map(a => [a.id, a.name]));
  const wl = AG.map(a => [a.name, realLogs(o, a.id).filter(e => Date.parse(e.ts) > Date.now() - 7 * 864e5).reduce((s, e) => s + (e.task_minutes || 0), 0)]), exN = o.logs.filter(e => e.example).length;
  const Q = [['+ 新建内容计划', 'ceo', '请为 Pinterest / Facebook / TikTok 各做一份下周内容计划，写进 playbooks 等我确认。'], ['+ 让 SEO 做站内检查', 'seo-geo', '请对 lovms.com 做一次站内 SEO 检查，列出问题和修改建议。'], ['+ 查看昨日数据', 'shopify', '请汇总昨天的 Shopify 销售、订单和访客数据，写成日报。']];
  app.innerHTML = `<div class="crumb muted">AI 工作</div>` + head('AI 工作', '谁在干活、干了多久、几点干') + `<div class="qbar"><div><h2>快捷指令</h2><p>今天要开始什么任务？告诉 CEO Agent 你的目标，他会分配给对应的 bot。</p></div><div class="qbtns">${Q.map((q, i) => `<button class="qb" data-q="${i}">${esc(q[0])}</button>`).join('')}</div></div>
  <div class="cols"><div class="card"><h2>派任务</h2>${taskForm(AG.map(a => a.id), nm)}</div><div class="card"><h2>近 7 天工作量 <span class="muted">分钟 · 真实日志${exN ? `（已排除 ${exN} 条示例）` : ''}</span></h2>${wl.some(x => x[1]) ? hbars(wl.map(x => [x[0], x[1], x[1] + ' 分钟']), '#38BDF8') : '<p class="muted">暂无数据</p>'}</div></div>
  <div class="card"><h2>排班表</h2>${schedule()}</div><div class="card"><h2>AI 员工团队</h2>${teamView(o)}</div><div class="card"><h2>company.log</h2><div class="term big" id="term">${termRows(o.logs.slice(0, 200))}</div></div>`;
  app.querySelectorAll('.qb').forEach(b => b.onclick = () => { const q = Q[+b.dataset.q]; $('#ag').value = q[1]; $('#tx').value = q[2]; $('#tx').focus(); $('#msg').textContent = '已预填，确认后点「提交任务」才会发出。'; $('#tf').scrollIntoView({ block: 'center' }); });
  bindForm(workTab); tint(); fixW(); drawOrg(); autoScroll(); }
async function todoTab() { await load(true); await tasksPage(); side('#/todo'); const o = ST.o; app.insertAdjacentHTML('afterbegin', `<div class="card"><h2>等你拍板 / 批准</h2>${todoList(o)}</div>`); bindApprove(todoTab); }
const _agentPage = agentPage; agentPage = async (id, tab) => { await load(); await _agentPage(id, tab); side(''); };
const _acc = accountsPage; accountsPage = async () => { await load(); await _acc(); side('#/accounts'); };
const _file = filePage; filePage = async p => { await load(); await _file(p); side(''); };
async function route() { const h = location.hash || '#/'; document.body.classList.remove('auth', 'dim'); const pp = $('#pop'); if (pp) pp.classList.remove('on');
  try { let m; if ((m = h.match(/^#\/agent\/([a-z-]+)(?:\/(overview|logs|output|plan|tasks))?$/))) await agentPage(m[1], m[2]); else if ((m = h.match(/^#\/file\/(.+)$/))) await filePage(decodeURIComponent(m[1]));
    else if (h === '#/todo' || h === '#/tasks') await todoTab(); else if (h === '#/agents' || h === '#/work') await workTab(); else if (h === '#/shop' || h === '#/shopify') await shopTab(); else if (h === '#/content') await contentTab(); else if (h === '#/seo') await seoTab(); else if (h === '#/accounts') await accountsPage(); else await overview();
    window.scrollTo(0, 0); } catch (e) { if (e) { console.error(e); app.innerHTML = '<p class="err">加载失败</p>'; } } }
bg(); addEventListener('hashchange', route); route();
