'use strict';
// box → 远程看板同步（无依赖）。每 60 秒：拉网页上的任务/账号修改/日志 → 写入本地知识库 → ack → 推快照 → 推任务状态。
// 配置：环境变量或 run/sync.env（KEY=VALUE，chmod 600）：REMOTE_URL、SYNC_TOKEN、KB_DIR(可选)、SYNC_INTERVAL(秒，可选)。绝不打印令牌。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
try { for (const l of fs.readFileSync(path.join(ROOT, 'run', 'sync.env'), 'utf8').split('\n')) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; } } catch {}
const URL0 = (process.env.REMOTE_URL || '').replace(/\/$/, ''), TOKEN = process.env.SYNC_TOKEN, KB = path.resolve(process.env.KB_DIR || path.join(ROOT, '..', 'knowledge'));
const EVERY = (+process.env.SYNC_INTERVAL || 60) * 1000, ONCE = process.argv.includes('--once');
if (!URL0.startsWith('https://') && !/^http:\/\/127\.0\.0\.1/.test(URL0)) { console.error('REMOTE_URL must be https (or http://127.0.0.1 for tests)'); process.exit(1); }
if (!TOKEN) { console.error('SYNC_TOKEN missing'); process.exit(1); }
const { okPath } = require('../lib/sync');
const AGENTS = ['ceo', 'shopify', 'seo-geo', 'facebook', 'tiktok', 'pinterest', 'fulfillment', 'ops-kb'], TASK_RE = /^[TQ]-\d{8}-\d{6}(-\d+)?$/;
const log = (...a) => console.log(new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' '), ...a);
async function call(method, p, body) { const r = await fetch(URL0 + p, { method, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(90e3) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${j.error || ''}`); return j; }
function snapshot() { const files = {}; const walk = d => { let xs = []; try { xs = fs.readdirSync(path.join(KB, d), { withFileTypes: true }); } catch { return; }
  for (const x of xs) { const r = d ? d + '/' + x.name : x.name; if (x.isDirectory()) { if (!x.name.startsWith('.') && ['', 'logs', 'metrics', 'reports', 'playbooks', 'agents', 'schema'].some(t => r === t || r.startsWith(t + '/'))) walk(r); }
    else if (okPath(r)) { const st = fs.statSync(path.join(KB, r)); if (st.size <= 5 * 1024 * 1024) files[r] = fs.readFileSync(path.join(KB, r), 'utf8'); } } };
  walk(''); const hash = crypto.createHash('sha256').update(JSON.stringify(Object.keys(files).sort().map(k => [k, files[k]]))).digest('hex'); return { files, hash }; }
function localTasks() { const out = []; for (const a of AGENTS) { let xs = []; try { xs = fs.readdirSync(path.join(KB, 'inbox', a)); } catch {} for (const f of xs) if (f.endsWith('.json') && TASK_RE.test(f.slice(0, -5))) { try { out.push(JSON.parse(fs.readFileSync(path.join(KB, 'inbox', a, f), 'utf8'))); } catch {} } } return out; }
const writeJ = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2) + '\n'); fs.renameSync(f + '.tmp', f); };
let lastStatusHash = null;
async function cycle() {
  // 1) 拉网页上的变化
  const ib = await call('GET', '/api/sync/inbox'); const ack = { tasks: [], accounts_changes: [], logs: [] };
  for (const t of ib.tasks || []) { if (!AGENTS.includes(t.agent) || !TASK_RE.test(t.id)) continue; const f = path.join(KB, 'inbox', t.agent, t.id + '.json');
    let cur = null; try { cur = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    const clean = { ...t }; delete clean.host_rev; delete clean.delivered_rev; delete clean.delivered_at;
    if (!cur) writeJ(f, { ...clean, delivered_at: undefined, pulled_at: new Date().toISOString() }); else { // 已有：只同步审批结果
      if (['approved', 'rejected'].includes(t.status) && ['queued', 'awaiting_approval'].includes(cur.status)) { cur.status = t.status; cur.decided_at = t.decided_at; cur.decided_by = t.decided_by; writeJ(f, cur); } }
    ack.tasks.push({ agent: t.agent, id: t.id, rev: t.host_rev || 1 }); log('pulled task', t.agent, t.id, t.status); }
  if ((ib.accounts_changes || []).length) { const af = path.join(KB, 'accounts.json'); const all = JSON.parse(fs.readFileSync(af, 'utf8'));
    for (const c of ib.accounts_changes) { let a = all.accounts.find(x => x.platform === c.platform); if (!a) { a = { platform: c.platform, label: c.platform, owner_agent: null }; all.accounts.push(a); }
      for (const k of ['handle', 'profile_url', 'status', 'notes']) if (typeof c.fields[k] === 'string') a[k] = c.fields[k]; a.last_checked = c.at; ack.accounts_changes.push(c.cid); log('applied account change', c.platform); }
    all.updated_at = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19) + '+08:00'; writeJ(af, all); }
  if ((ib.logs || []).length) { fs.appendFileSync(path.join(KB, 'logs', 'company.log.jsonl'), ib.logs.map(x => JSON.stringify(x.line)).join('\n') + '\n'); ack.logs = ib.logs.map(x => x.sid); log('appended', ib.logs.length, 'web log lines'); }
  if (ack.tasks.length || ack.accounts_changes.length || ack.logs.length) await call('POST', '/api/sync/ack', ack);
  // 2) 推快照（远端哈希不同才推；远端重启丢盘也会自动补推）
  const snap = snapshot(), h = await fetch(URL0 + '/healthz', { signal: AbortSignal.timeout(90e3) }).then(r => r.json()).catch(() => ({}));
  if (!h.snapshot || h.snapshot.hash !== snap.hash) { const r = await call('POST', '/api/sync/push', { mode: 'replace', hash: snap.hash, files: snap.files }); log('pushed snapshot', r.written, 'files', r.accounts_skipped ? '(accounts.json skipped: pending web edits)' : ''); }
  // 3) 推任务状态
  const ts = localTasks().map(t => ({ id: t.id, agent: t.agent, status: t.status, result_note: t.result_note, text: t.text, priority: t.priority, requires_approval: t.requires_approval, created_at: t.created_at, created_by: t.created_by }));
  const sh = crypto.createHash('sha256').update(JSON.stringify(ts)).digest('hex'); if (sh !== lastStatusHash || ack.tasks.length) { await call('POST', '/api/sync/status', { tasks: ts }); lastStatusHash = sh; }
}
async function loop() { try { await cycle(); } catch (e) { log('sync error:', String(e.message).replace(TOKEN, '***')); } if (!ONCE) setTimeout(loop, EVERY); }
log('box-sync start →', URL0, 'KB=' + KB, 'every', EVERY / 1000, 's'); loop();
