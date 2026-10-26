'use strict';
// 运行：node --test test/   （不连真实 Shopify）
const { test, before, after } = require('node:test'); const assert = require('node:assert');
const { spawn } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os');
const S = require('../lib/shopify');
const PW = 'test-pw-' + Math.random().toString(36).slice(2), PORT = 18000 + Math.floor(Math.random() * 1000), B = `http://127.0.0.1:${PORT}`;
let kb, proc, ck = '';
async function boot(env) { const p = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, DASH_PASSWORD: PW, DASH_SECRET: 'x'.repeat(32), PORT, KB_DIR: kb, SHOPIFY_SHOP: '', SHOPIFY_ADMIN_TOKEN: '', SHOPIFY_MOCK: '', ...env }, stdio: 'pipe' });
  await new Promise(ok => p.stdout.on('data', ok)); return p; }
const req = (u, o = {}) => fetch(B + u, { ...o, headers: { cookie: ck, ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(o.headers || {}) } });
const postj = (u, b) => req(u, { method: 'POST', body: JSON.stringify(b) });
const logLines = () => fs.readFileSync(path.join(kb, 'logs/company.log.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
before(async () => { kb = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-')); const src = path.join(__dirname, '..', '..', 'knowledge');
  for (const f of ['agents.json', 'todo.json', 'accounts.json', 'logs', 'metrics', 'reports', 'playbooks', 'agents']) fs.cpSync(path.join(src, f), path.join(kb, f), { recursive: true });
  proc = await boot({}); const r = await postj('/api/login', { password: PW }); ck = r.headers.get('set-cookie').split(';')[0]; });
after(() => { proc && proc.kill(); fs.rmSync(kb, { recursive: true, force: true }); });

test('未登录拒绝，错误密码 401', async () => { const save = ck; ck = ''; assert.equal((await req('/api/overview')).status, 401); assert.equal((await req('/api/shopify/summary')).status, 401); assert.equal((await req('/api/accounts')).status, 401);
  assert.equal((await postj('/api/login', { password: 'nope' })).status, 401); ck = save; });
test('静态白名单与路径穿越', async () => { assert.equal((await req('/')).status, 200); assert.equal((await req('/server.js')).status, 404); const code = await new Promise(ok => require('http').get({ host: '127.0.0.1', port: PORT, path: '/%2e%2e/server.js' }, r => { r.resume(); ok(r.statusCode); })); assert.equal(code, 400); });
test('overview 含 system 日报、状态推导', async () => { const d = await (await req('/api/overview')).json(); assert.equal(d.system_report.date, '2026-10-23'); assert.ok(d.system_report.markdown.length > 0);
  for (const s of Object.values(d.statuses)) assert.ok(['running', 'idle', 'pending'].includes(s.key)); assert.equal(d.statuses.ceo.key, 'idle'); });
test('agent 详情：日志按 agent 过滤、日报、成果文件、回退日期标记', async () => { const d = await (await req('/api/agent/facebook')).json();
  assert.ok(d.logs.every(e => e.agent_id === 'facebook')); assert.ok(d.reports.length >= 1); assert.ok(d.artifacts.some(a => a.name === 'system-prompt.md')); assert.equal(d.date_is_fallback, true); });
test('新任务 Q- 前缀，默认不需审批，写日志；审批写日志', async () => {
  let r = await postj('/api/tasks', { agent: 'pinterest', text: '测试任务', priority: 'P2' }); const t = await r.json(); assert.equal(r.status, 201); assert.match(t.id, /^Q-\d{8}-\d{6}/); assert.equal(t.requires_approval, false);
  r = await postj('/api/tasks', { agent: 'pinterest', text: '需批准', priority: 'P1', requires_approval: true }); const t2 = await r.json();
  r = await postj(`/api/tasks/pinterest/${t2.id}/approve`, {}); assert.equal(r.status, 200);
  const L = logLines(); assert.ok(L.some(e => e.event === 'todo_created' && e.message.includes(t.id))); assert.ok(L.some(e => e.event === 'todo_updated' && e.message.includes(t2.id) && e.agent_id === 'human'));
  fs.mkdirSync(path.join(kb, 'inbox/tiktok'), { recursive: true }); fs.writeFileSync(path.join(kb, 'inbox/tiktok/T-20261020-101010.json'), JSON.stringify({ id: 'T-20261020-101010', agent: 'tiktok', status: 'queued' }));
  assert.ok((await (await req('/api/tasks')).json()).tasks.some(x => x.id === 'T-20261020-101010')); });
test('kbfile 只允许白名单路径', async () => { assert.equal((await req('/api/kbfile?path=reports/2026-10-23/system.md')).status, 200); assert.equal((await req('/api/kbfile?path=accounts.json')).status, 400);
  assert.equal((await req('/api/kbfile?path=agents/facebook/../../todo.json')).status, 400); });
test('账号连接：读取、校验、写入、记日志', async () => { const d = await (await req('/api/accounts')).json(); assert.equal(d.accounts.length, 8);
  assert.equal(d.accounts.find(a => a.platform === 'shopify').status, 'connected'); assert.equal(d.accounts.find(a => a.platform === 'tiktok').status, 'not_connected');
  assert.equal((await postj('/api/accounts/myspace', { handle: 'x' })).status, 404); assert.equal((await postj('/api/accounts/pinterest', { profile_url: 'javascript:alert(1)' })).status, 400);
  assert.equal((await postj('/api/accounts/pinterest', { password: 'x' })).status, 400); assert.equal((await postj('/api/accounts/pinterest', { status: 'hacked' })).status, 400);
  assert.equal((await postj('/api/accounts/pinterest', { notes: 'token: abc' })).status, 400);
  const r = await postj('/api/accounts/pinterest', { handle: 'lovmsjewelry', profile_url: 'https://www.pinterest.com/lovmsjewelry/', status: 'pending' }); assert.equal(r.status, 200);
  const f = JSON.parse(fs.readFileSync(path.join(kb, 'accounts.json'))); assert.equal(f.accounts.find(a => a.platform === 'pinterest').handle, 'lovmsjewelry');
  assert.ok(logLines().some(e => e.event === 'kb_update' && e.message.includes('pinterest'))); });
test('Shopify 未配置时返回未连接（不编数字）', async () => { const d = await (await req('/api/shopify/summary')).json(); assert.equal(d.connected, false); assert.equal(d.reason, 'not_configured'); assert.equal(d.today, undefined); });
test('Shopify mock 模式带 example:true', async () => { const p = spawn; const save = proc; proc.kill(); proc = await boot({ SHOPIFY_MOCK: '1' }); ck = (await postj('/api/login', { password: PW })).headers.get('set-cookie').split(';')[0];
  const d = await (await req('/api/shopify/summary')).json(); assert.equal(d.example, true); assert.equal(d.mode, 'mock'); assert.ok(d.d30.orders > 0); });
test('summarize：GraphQL 订单 → 摘要映射（上海切日、剔除取消、无 PII）', () => {
  const orders = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/orders.json'))); const now = Date.parse('2026-10-26T12:00:00+08:00');
  const s = S.summarize(orders, { active: { count: 40 }, draft: { count: 5 }, all: { count: 45 }, shop: { name: 'LOVMS', currencyCode: 'USD' } }, now, null);
  assert.deepEqual(s.today, { orders: 1, sales: 88, aov: 88 }); assert.deepEqual(s.d7, { orders: 2, sales: 208, aov: 104 }); assert.deepEqual(s.d30, { orders: 3, sales: 268, aov: 89.33 });
  assert.equal(s.top_products[0].title, 'Solitaire Ring'); assert.equal(s.top_products[0].quantity, 3); assert.equal(s.top_products[0].sales, 140); assert.deepEqual(s.products, { active: 40, draft: 5, total: 45 });
  assert.equal(s.series_30d.length, 30); assert.equal(s.series_30d[29].date, '2026-10-26'); assert.equal(s.series_30d[29].sales, 88);
  const keys = Object.keys(s.recent_orders[0]).sort(); assert.deepEqual(keys, ['cancelled', 'city', 'country', 'created_at', 'currency', 'financial_status', 'first_name', 'name', 'total']); });
test('summary：API 报错时未连接且不泄露 token；fetch 正常时走 live', async () => {
  const env = { SHOPIFY_SHOP: 'qw1wau-ty.myshopify.com', SHOPIFY_ADMIN_TOKEN: 'shpat_SECRET123' }; S._resetCache();
  let d = await S.summary({ env, fetchImpl: async () => { throw new Error('boom shpat_SECRET123'); } }); assert.equal(d.connected, false); assert.ok(!JSON.stringify(d).includes('SECRET123'));
  S._resetCache(); const orders = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/orders.json'))); let seenTok;
  const fx = async (u, o) => { seenTok = o.headers['X-Shopify-Access-Token']; const q = JSON.parse(o.body).query; const data = q.includes('orders(') ? { orders: { pageInfo: { hasNextPage: false }, nodes: orders } } : q.includes('shopifyqlQuery') ? { shopifyqlQuery: { parseErrors: [], tableData: { columns: [{ name: 'day' }, { name: 'sessions' }], rows: [['2026-10-25', 10], ['2026-10-26', 5]] } } } : { active: { count: 1 }, draft: { count: 2 }, all: { count: 3 }, shop: { name: 'LOVMS' } };
    return { ok: true, json: async () => ({ data }) }; };
  d = await S.summary({ env, fetchImpl: fx, now: Date.parse('2026-10-26T12:00:00+08:00') }); assert.equal(seenTok, 'shpat_SECRET123'); assert.equal(d.mode, 'live'); assert.equal(d.example, false); assert.equal(d.sessions.d30, 15); assert.equal(d.today.sales, 88); });
test('团队页数据：overview 含全部 8 位员工的状态和任务（用于计数）', async () => { const d = await (await req('/api/overview')).json();
  assert.equal(d.agents.agents.length, 8); for (const a of d.agents.agents) assert.ok(d.statuses[a.id], a.id); assert.ok(Array.isArray(d.tasks));
  assert.ok(d.tasks.every(t => typeof t.agent === 'string' && typeof t.status === 'string')); });
test('overview 含 agent_meta（真实活动，示例日志不计）与 kb_stats', async () => { const d = await (await req('/api/overview')).json();
  for (const a of ['ceo', 'shopify', 'facebook', 'ops-kb']) assert.ok(d.agent_meta[a] && d.agent_meta[a].tasks, a);
  assert.equal(d.agent_meta.ceo.last_log_ts, null); assert.equal(d.agent_meta.facebook.last_report.date, '2026-10-23'); assert.equal(d.agent_meta.facebook.last_report.example, true);
  assert.ok(d.agent_meta.pinterest.tasks.queued >= 1); assert.ok(d.kb_stats.playbooks >= 1); assert.match(d.today, /^\d{4}-\d{2}-\d{2}$/); });
test('client credentials：换令牌（表单编码）、缓存、401 时刷新、错误里不泄露密钥', async () => {
  const env = { SHOPIFY_SHOP: 'qw1wau-ty.myshopify.com', SHOPIFY_CLIENT_ID: 'cid123', SHOPIFY_CLIENT_SECRET: 'shpss_TOPSECRET' }; S._resetCache();
  let ex = 0, gq = 0, valid = 'tokA', bodies = [];
  const fx = async (u, o) => { if (u.endsWith('/admin/oauth/access_token')) { ex++; bodies.push(o); return { ok: true, json: async () => ({ access_token: ex === 1 ? 'tokA' : 'tokB', expires_in: 86399, scope: 'read_orders' }) }; }
    gq++; if (o.headers['X-Shopify-Access-Token'] !== valid) return { ok: false, status: 401, json: async () => ({}) };
    const q = JSON.parse(o.body).query; return { ok: true, json: async () => ({ data: q.includes('orders(') ? { orders: { pageInfo: { hasNextPage: false }, nodes: [] } } : q.includes('shopifyqlQuery') ? { shopifyqlQuery: null } : { active: { count: 97 }, draft: { count: 1 }, all: { count: 98 }, shop: { name: 'LOVMS' } } }) }; };
  const t0 = Date.parse('2026-10-26T12:00:00+08:00');
  let d = await S.summary({ env, fetchImpl: fx, now: t0, force: true }); assert.equal(d.mode, 'live'); assert.deepEqual(d.products, { active: 97, draft: 1, total: 98 }); assert.equal(ex, 1);
  assert.equal(bodies[0].headers['Content-Type'], 'application/x-www-form-urlencoded'); const ps = new URLSearchParams(bodies[0].body); assert.equal(ps.get('grant_type'), 'client_credentials'); assert.equal(ps.get('client_id'), 'cid123');
  d = await S.summary({ env, fetchImpl: fx, now: t0 + 3600e3, force: true }); assert.equal(ex, 1, '令牌应被缓存');
  valid = 'tokB'; d = await S.summary({ env, fetchImpl: fx, now: t0 + 7200e3, force: true }); assert.equal(d.mode, 'live'); assert.equal(ex, 2, '401 后应刷新一次');
  valid = 'tokB'; await S.summary({ env, fetchImpl: fx, now: t0 + 27 * 3600e3, force: true }); assert.equal(ex, 3, '快过期应重新换取');
  S._resetCache(); d = await S.summary({ env, fetchImpl: async () => { throw new Error('boom shpss_TOPSECRET cid123'); }, now: t0, force: true });
  assert.equal(d.connected, false); assert.ok(!JSON.stringify(d).includes('TOPSECRET'));
  S._resetCache(); d = await S.summary({ env, fetchImpl: async u => u.endsWith('access_token') ? { ok: false, status: 400, json: async () => ({}) } : null, now: t0, force: true }); assert.equal(d.connected, false); assert.match(d.hint, /令牌换取失败/); });
