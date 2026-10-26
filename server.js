'use strict';
// LOVMS 看板 v2 — 纯 Node 20，无依赖
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PASSWORD = process.env.DASH_PASSWORD, SECRET = process.env.DASH_SECRET;
if (!PASSWORD || !SECRET || SECRET.length < 16) { console.error('Refusing to start: set DASH_PASSWORD and DASH_SECRET (>=16 chars).'); process.exit(1); }
process.env.TZ = 'Asia/Shanghai';
const PORT = +process.env.PORT || 8787, HOST = process.env.HOST || '127.0.0.1';
const REMOTE = process.env.REMOTE_MODE === '1';
const KB = path.resolve(process.env.KB_DIR || (REMOTE ? '/tmp/kb' : path.join(__dirname, '..', 'knowledge')));
if (REMOTE) fs.mkdirSync(KB, { recursive: true });
const PUB = path.join(__dirname, 'public');
const shopify = require('./lib/shopify');
const makeSync = require('./lib/sync');
const AGENTS = ['ceo','shopify','seo-geo','facebook','tiktok','pinterest','fulfillment','ops-kb'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, TASK_RE = /^[TQ]-\d{8}-\d{6}(-\d+)?$/;
const PLATFORMS = ['shopify','pinterest','facebook','instagram','tiktok','google-search-console','google-analytics','zoho-mail'];
const KBFILE_RE = /^(reports\/\d{4}-\d{2}-\d{2}|playbooks|agents\/[a-z-]+|metrics\/\d{4}-\d{2}-\d{2})\/[^/\\]+\.(md|json)$/;
const STATIC = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const COOKIE = 'lovms_dash', TTL = 7 * 86400e3;

function nowSH() { // ISO with +08:00
  const d = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19);
  return d + '+08:00';
}
function sign(v) { return crypto.createHmac('sha256', SECRET).update(v).digest('base64url'); }
function makeSession() { const p = `${Date.now() + TTL}.${crypto.randomBytes(9).toString('base64url')}`; return p + '.' + sign(p); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function pwEq(a) { // hash first so length is not leaked
  const h = s => crypto.createHash('sha256').update(String(s)).digest(); return crypto.timingSafeEqual(h(a), h(PASSWORD)); }
function authed(req) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  if (!m) return false; const v = m.slice(COOKIE.length + 1), i = v.lastIndexOf('.');
  if (i < 0) return false; const p = v.slice(0, i);
  return safeEq(sign(p), v.slice(i + 1)) && +p.split('.')[0] > Date.now();
}
const fails = new Map(); // ip -> {n, until}
function limited(ip) { const f = fails.get(ip); return f && f.until > Date.now(); }
function fail(ip) { const f = fails.get(ip) || { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(ip, f); }

function send(res, code, obj, extra = {}) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); }
function readJSON(rel) { try { return JSON.parse(fs.readFileSync(path.join(KB, rel), 'utf8')); } catch (e) { return null; } }
function readText(rel) { try { return fs.readFileSync(path.join(KB, rel), 'utf8'); } catch (e) { return null; } }
function body(req) { return new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) { no(new Error('too big')); req.destroy(); } }); req.on('end', () => ok(b)); }); }
function dates(dir) { try { return fs.readdirSync(path.join(KB, dir)).filter(d => DATE_RE.test(d)).sort(); } catch { return []; } }
function logs(agent, limit = 200) {
  const t = readText('logs/company.log.jsonl') || ''; const out = [];
  for (const l of t.split('\n')) { if (!l.trim()) continue; try { const e = JSON.parse(l); if (!agent || e.agent_id === agent) out.push(e); } catch { out.push({ level: 'error', message: '无法解析的日志行', invalid: true }); } }
  return out.slice(-limit).reverse();
}
function clientIp(req) { return (REMOTE && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress; }
let SYNC = null; // 远程模式下初始化
function appendLog(e) { if (SYNC) SYNC.hostLog({ ts: nowSH(), level: 'info', ...e }); fs.mkdirSync(path.join(KB, 'logs'), { recursive: true }); fs.appendFileSync(path.join(KB, 'logs', 'company.log.jsonl'), JSON.stringify({ ts: nowSH(), level: 'info', ...e }) + '\n'); }
function listDir(rel, re) { try { return fs.readdirSync(path.join(KB, rel)).filter(f => re.test(f)).sort(); } catch { return []; } }
function agentReports(a) { return dates('reports').filter(d => fs.existsSync(path.join(KB, 'reports', d, a + '.md'))).reverse().map(d => ({ date: d, path: `reports/${d}/${a}.md`, markdown: readText(`reports/${d}/${a}.md`) })); }
function artifacts(a) { return listDir('agents/' + a, /\.(md|json)$/).map(f => ({ name: f, path: `agents/${a}/${f}` })); }
// 状态只从真实文件推导：运行中 = agents.json 标为 active/running，或 2 小时内有非示例日志；待确认 = 有待批准任务或待拍板事项
function agentStatus(ag, allLogs, allTasks, todo) {
  const id = ag.id, recent = allLogs.find(e => e.agent_id === id && !e.example && Date.parse(e.ts) > Date.now() - 2 * 3600e3);
  const pending = allTasks.some(t => t.agent === id && t.requires_approval && ['queued', 'awaiting_approval'].includes(t.status)) || ((todo && todo.items) || []).some(t => t.owner_agent === id && t.needs_ceo_decision && !['done', 'closed'].includes(t.status) && !t.example);
  if (['active', 'running'].includes(ag.status) || recent) return { key: 'running', label: '运行中', why: recent ? '2 小时内有日志' : 'agents.json 状态为 ' + ag.status };
  if (pending) return { key: 'pending', label: '待确认', why: '有等你批准/拍板的事项' };
  return { key: 'idle', label: '待命', why: 'agents.json 状态为 ' + (ag.status || '未知') + '，近 2 小时无真实日志' };
}
// 每个 agent 的真实活动摘要（示例日志不算）
function agentMeta(allLogs, allTasks) { const out = {};
  for (const a of AGENTS) { const real = allLogs.filter(e => e.agent_id === a && !e.example), rep = dates('reports').filter(d => fs.existsSync(path.join(KB, 'reports', d, a + '.md'))).pop() || null;
    const repFile = rep ? path.join(KB, 'reports', rep, a + '.md') : null, my = allTasks.filter(t => t.agent === a);
    out[a] = { last_log_ts: real[0] ? real[0].ts : null, last_report: rep ? { date: rep, path: `reports/${rep}/${a}.md`, mtime: new Date(fs.statSync(repFile).mtimeMs + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00', example: /示例|example:\s*true/.test(readText(`reports/${rep}/${a}.md`) || '') } : null,
      tasks: { queued: my.filter(t => t.status === 'queued').length, in_progress: my.filter(t => t.status === 'in_progress').length, done: my.filter(t => t.status === 'done').length, approved: my.filter(t => t.status === 'approved').length } }; }
  return out; }
function kbStats() { return { playbooks: listDir('playbooks', /\.md$/).length, report_days: dates('reports').length, metrics_days: dates('metrics').length, agent_files: AGENTS.reduce((n, a) => n + listDir('agents/' + a, /\.(md|json)$/).length, 0) }; }
function accounts() { return readJSON('accounts.json') || { schema_version: '1.0', accounts: [] }; }
function inboxDir(a) { return path.join(KB, 'inbox', a); }
function tasks(agent) {
  const out = [];
  for (const a of agent ? [agent] : AGENTS) { let fsx = []; try { fsx = fs.readdirSync(inboxDir(a)); } catch {}
    for (const f of fsx) { if (!f.endsWith('.json') || !TASK_RE.test(f.slice(0, -5))) continue; try { out.push(JSON.parse(fs.readFileSync(path.join(inboxDir(a), f), 'utf8'))); } catch {} } }
  return out.sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)));
}
function playbooks(agent) {
  let fsx = []; try { fsx = fs.readdirSync(path.join(KB, 'playbooks')); } catch {}
  return fsx.filter(f => f.endsWith('.md') && (f === agent + '.md' || f.startsWith(agent + '-'))).map(f => ({ name: f, markdown: readText('playbooks/' + f) }));
}

async function api(req, res, url) {
  const p = url.pathname, ip = clientIp(req);
  if (p === '/api/login' && req.method === 'POST') {
    if (limited(ip)) return send(res, 429, { error: '尝试次数过多，请 15 分钟后再试' });
    let pw = ''; try { pw = JSON.parse(await body(req)).password || ''; } catch {}
    if (!pwEq(pw)) { fail(ip); return send(res, 401, { error: '密码错误' }); }
    fails.delete(ip);
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${makeSession()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL / 1000}${secure}` });
  }
  if (p === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  if (!authed(req)) return send(res, 401, { error: 'unauthorized' });
  if (req.method === 'POST' && req.headers['content-type'] !== 'application/json') return send(res, 415, { error: 'json only' });

  if (p === '/api/overview' && req.method === 'GET') {
    const md = dates('metrics'), latest = md[md.length - 1] || null, rd = dates('reports');
    const sysDate = [...rd].reverse().find(d => fs.existsSync(path.join(KB, 'reports', d, 'system.md'))) || null;
    const allLogs = logs(null, 5000), allTasks = tasks(), agentsF = readJSON('agents.json'), todoF = readJSON('todo.json');
    const statuses = {}; for (const ag of (agentsF && agentsF.agents) || []) statuses[ag.id] = agentStatus(ag, allLogs, allTasks, todoF);
    const metrics = {}; if (latest) for (const a of AGENTS) metrics[a] = readJSON(`metrics/${latest}/${a}.json`);
    return send(res, 200, { now: nowSH(), metrics_date: latest, agents: readJSON('agents.json'), todo: readJSON('todo.json'), metrics, metrics_is_today: latest === nowSH().slice(0, 10), logs: allLogs.slice(0, 50), tasks: allTasks, statuses, agent_meta: agentMeta(allLogs, allTasks), kb_stats: kbStats(), today: nowSH().slice(0, 10),
      system_report: sysDate ? { date: sysDate, path: `reports/${sysDate}/system.md`, markdown: readText(`reports/${sysDate}/system.md`) } : null, accounts: accounts().accounts });
  }
  let m = p.match(/^\/api\/agent\/([a-z-]+)$/);
  if (m && req.method === 'GET') {
    const a = m[1]; if (!AGENTS.includes(a)) return send(res, 404, { error: 'unknown agent' });
    const md = dates('metrics'), rd = dates('reports'); let d = url.searchParams.get('date');
    if (d && (!DATE_RE.test(d) || !md.includes(d))) return send(res, 400, { error: 'bad date' });
    d = d || md[md.length - 1] || null; const rdate = d && rd.includes(d) ? d : rd[rd.length - 1] || null;
    const ag = (readJSON('agents.json') || { agents: [] }).agents.find(x => x.id === a) || null;
    const allLogs = logs(null, 5000);
    return send(res, 200, { now: nowSH(), agent: ag, status: ag ? agentStatus(ag, allLogs, tasks(), readJSON('todo.json')) : null, date_is_fallback: !url.searchParams.get('date') && d !== nowSH().slice(0, 10),
      reports: agentReports(a), artifacts: artifacts(a), accounts: accounts().accounts.filter(x => x.owner_agent === a), agents_file_example: !!(readJSON('agents.json') || {}).example, metrics_dates: md, date: d,
      metrics: d ? readJSON(`metrics/${d}/${a}.json`) : null, report_date: rdate, report: rdate ? readText(`reports/${rdate}/${a}.md`) : null,
      logs: allLogs.filter(e => e.agent_id === a).slice(0, 1000), playbooks: playbooks(a), tasks: tasks(a) });
  }
  if (p === '/api/tasks' && req.method === 'GET') return send(res, 200, { now: nowSH(), agents: AGENTS, tasks: tasks() });
  if (p === '/api/tasks' && req.method === 'POST') {
    let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    const text = String(b.text || '').trim(), pr = b.priority;
    if (!AGENTS.includes(b.agent)) return send(res, 400, { error: 'bad agent' });
    if (!text || text.length > 4000) return send(res, 400, { error: 'text required (<=4000)' });
    if (!['P0', 'P1', 'P2'].includes(pr)) return send(res, 400, { error: 'bad priority' });
    const ts = nowSH(); let id = 'Q-' + ts.slice(0, 10).replace(/-/g, '') + '-' + ts.slice(11, 19).replace(/:/g, '');
    const dir = inboxDir(b.agent); fs.mkdirSync(dir, { recursive: true });
    let n = 1, base = id; while (fs.existsSync(path.join(dir, id + '.json'))) id = `${base}-${++n}`;
    const t = { id, agent: b.agent, text, priority: pr, requires_approval: !!b.requires_approval, created_at: ts, created_by: 'human', status: 'queued' }; if (REMOTE) t.host_rev = 1;
    fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(t, null, 2), { flag: 'wx' });
    appendLog({ agent_id: 'human', event: 'todo_created', message: `派任务给 ${b.agent}（${id}）：${text.slice(0, 80)}`, refs: [`inbox/${b.agent}/${id}.json`] });
    return send(res, 201, t);
  }
  m = p.match(/^\/api\/tasks\/([a-z-]+)\/([A-Za-z0-9-]+)\/(approve|reject)$/);
  if (m && req.method === 'POST') {
    const [, a, id, act] = m; if (!AGENTS.includes(a) || !TASK_RE.test(id)) return send(res, 400, { error: 'bad path' });
    const f = path.join(inboxDir(a), id + '.json'); let t; try { t = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return send(res, 404, { error: 'not found' }); }
    if (!t.requires_approval || !['queued', 'awaiting_approval'].includes(t.status)) return send(res, 409, { error: 'not pending approval' });
    t.status = act === 'approve' ? 'approved' : 'rejected'; t.decided_at = nowSH(); t.decided_by = 'human'; if (REMOTE) t.host_rev = Math.max(t.host_rev || 0, t.delivered_rev || 0) + 1;
    fs.writeFileSync(f + '.tmp', JSON.stringify(t, null, 2)); fs.renameSync(f + '.tmp', f);
    appendLog({ agent_id: 'human', event: 'todo_updated', message: `${act === 'approve' ? '批准' : '驳回'}任务 ${id}（${a}）`, refs: [`inbox/${a}/${id}.json`] });
    return send(res, 200, t);
  }
  if (p === '/api/kbfile' && req.method === 'GET') {
    const rel = url.searchParams.get('path') || '';
    if (!KBFILE_RE.test(rel) || rel.includes('..')) return send(res, 400, { error: 'path not allowed' });
    const t = readText(rel); if (t === null) return send(res, 404, { error: 'not found' });
    return send(res, 200, { path: rel, text: t.slice(0, 500000) });
  }
  if (p === '/api/shopify/summary' && req.method === 'GET') return send(res, 200, await shopify.summary({ force: url.searchParams.get('refresh') === '1' }));
  if (p === '/api/accounts' && req.method === 'GET') return send(res, 200, { now: nowSH(), platforms: PLATFORMS, ...accounts() });
  m = p.match(/^\/api\/accounts\/([a-z-]+)$/);
  if (m && req.method === 'POST') {
    const pf = m[1]; if (!PLATFORMS.includes(pf)) return send(res, 404, { error: 'unknown platform' });
    let b; try { b = JSON.parse(await body(req)); } catch { return send(res, 400, { error: 'bad json' }); }
    const allowed = ['handle', 'profile_url', 'status', 'notes'], extra = Object.keys(b).filter(k => !allowed.includes(k));
    if (extra.length) return send(res, 400, { error: '不允许的字段：' + extra.join(',') });
    if ('status' in b && !['connected', 'pending', 'not_connected'].includes(b.status)) return send(res, 400, { error: 'bad status' });
    if ('profile_url' in b && b.profile_url !== '') { let u; try { u = new URL(String(b.profile_url)); } catch { return send(res, 400, { error: '链接无效' }); } if (!['http:', 'https:'].includes(u.protocol)) return send(res, 400, { error: '只允许 http/https 链接' }); }
    for (const k of ['handle', 'notes', 'profile_url']) if (k in b && (typeof b[k] !== 'string' || b[k].length > (k === 'notes' ? 1000 : 300))) return send(res, 400, { error: k + ' 太长或类型错误' });
    if (/(password|passwd|token|secret|密码)\s*[:=：]/i.test(String(b.notes || '') + String(b.handle || ''))) return send(res, 400, { error: '这里不能存密码或令牌' });
    const all = accounts(); let acc = all.accounts.find(x => x.platform === pf);
    if (!acc) { acc = { platform: pf, label: pf, owner_agent: null, status: 'not_connected', handle: '', profile_url: '', notes: '', last_checked: null }; all.accounts.push(acc); }
    const changed = allowed.filter(k => k in b && b[k] !== acc[k]); for (const k of changed) acc[k] = b[k];
    acc.last_checked = nowSH(); all.updated_at = acc.last_checked;
    const f = path.join(KB, 'accounts.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(all, null, 2) + '\n'); fs.renameSync(f + '.tmp', f);
    if (SYNC) SYNC.accountChange(acc);
    appendLog({ agent_id: 'human', event: 'kb_update', message: `更新账号连接 ${pf}：${changed.join(', ') || '仅刷新检查时间'}`, refs: ['accounts.json'] });
    return send(res, 200, acc);
  }
  return send(res, 404, { error: 'not found' });
}

if (REMOTE) SYNC = makeSync({ KB, TOKEN: process.env.SYNC_TOKEN || '', AGENTS, TASK_RE, nowSH });
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:");
  let url; try { url = new URL(req.url, 'http://x'); } catch { return send(res, 400, { error: 'bad url' }); }
  if (url.pathname === '/healthz') return send(res, 200, { ok: true, mode: REMOTE ? 'remote' : 'local', snapshot: SYNC ? SYNC.snapshotInfo() : null });
  if (req.url.includes('..') || req.url.includes('%2e') || req.url.includes('%2E') || req.url.includes('\\')) return send(res, 400, { error: 'bad path' });
  try {
    if (url.pathname.startsWith('/api/sync/')) return SYNC ? await SYNC.handle(req, res, url) : send(res, 404, { error: 'not found' });
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    const f = STATIC[url.pathname]; if (!f || req.method !== 'GET') return send(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)], 'Cache-Control': 'no-cache' }); res.end(fs.readFileSync(path.join(PUB, f)));
  } catch (e) { console.error(e); send(res, 500, { error: 'server error' }); }
}).listen(PORT, HOST, () => console.log(`LOVMS dashboard on http://${HOST}:${PORT}  KB=${KB}`));
