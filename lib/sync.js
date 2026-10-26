'use strict';
// 远程模式同步接口：box → host 推送知识库快照；host → box 交付网页上新建/审批的任务与账号修改。
// 只认 Authorization: Bearer <SYNC_TOKEN>，与用户登录 cookie 完全分开。
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const MAX_BODY = 25 * 1024 * 1024, MAX_FILE = 5 * 1024 * 1024, MAX_FILES = 3000;
const NAME = '[^/\\\\\\x00]+';
// 与看板读取范围一致的白名单（inbox/ 不在内：任务走 inbox/ack/status 接口）
const FILE_RE = new RegExp(`^(agents\\.json|todo\\.json|accounts\\.json|decisions\\.md|brand\\.md|offers\\.md|catalog\\.md|agents-index\\.md|logs/company\\.log\\.jsonl|metrics/\\d{4}-\\d{2}-\\d{2}/[a-z-]+\\.json|metrics/\\d{4}-\\d{2}-\\d{2}\\.md|reports/\\d{4}-\\d{2}-\\d{2}/[a-z-]+\\.md|playbooks/${NAME}\\.md|agents/[a-z-]+/${NAME}\\.(md|json)|schema/${NAME}\\.(md|json))$`);
const REPLACE_DIRS = ['metrics', 'reports', 'playbooks', 'agents', 'schema'];
function okPath(rel) { return typeof rel === 'string' && rel.length < 300 && FILE_RE.test(rel) && !rel.split('/').some(s => s === '..' || s === '.' || s.startsWith('.')); }

module.exports = function makeSync({ KB, TOKEN, AGENTS, TASK_RE, nowSH }) {
  const STATE = path.join(KB, '.sync'); fs.mkdirSync(STATE, { recursive: true });
  const stF = n => path.join(STATE, n);
  const readJ = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const writeJ = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 2)); fs.renameSync(f + '.tmp', f); };
  let snapshot = readJ(stF('snapshot.json'), { hash: null, at: null });
  const hits = new Map(), fails = new Map();
  function authOK(req) { const h = req.headers.authorization || '', m = h.match(/^Bearer (.+)$/); if (!TOKEN || !m) return false;
    const a = crypto.createHash('sha256').update(m[1]).digest(), b = crypto.createHash('sha256').update(TOKEN).digest(); return crypto.timingSafeEqual(a, b); }
  function limited(ip) { const now = Date.now(), f = fails.get(ip); if (f && f.until > now) return true;
    const h = hits.get(ip) || { n: 0, t: now }; if (now - h.t > 60e3) { h.n = 0; h.t = now; } h.n++; hits.set(ip, h); return h.n > 120; }
  function fail(ip) { const f = fails.get(ip) || { n: 0, until: 0 }; if (++f.n >= 10) { f.until = Date.now() + 15 * 60e3; f.n = 0; } fails.set(ip, f); }
  function readBody(req) { return new Promise((ok, no) => { const ch = []; let n = 0; let dead = false;
    if (+req.headers['content-length'] > MAX_BODY) { dead = true; return no(Object.assign(new Error('too big'), { code: 413 })); }
    req.on('data', c => { if (dead) return; n += c.length; if (n > MAX_BODY) { dead = true; no(Object.assign(new Error('too big'), { code: 413 })); req.resume(); return; } ch.push(c); });
    req.on('end', () => { if (!dead) ok(Buffer.concat(ch).toString('utf8')); }); req.on('error', no); }); }
  // ---- host 端记录：网页产生的日志与账号修改，等 box 拉走 ----
  function hostLog(line) { fs.appendFileSync(stF('host-log.jsonl'), JSON.stringify({ sid: crypto.randomBytes(6).toString('hex'), line }) + '\n'); }
  function hostLogs() { try { return fs.readFileSync(stF('host-log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch { return []; } }
  function accountChange(acc) { const all = readJ(stF('accounts-changes.json'), []); all.push({ cid: crypto.randomBytes(6).toString('hex'), platform: acc.platform, fields: { handle: acc.handle, profile_url: acc.profile_url, status: acc.status, notes: acc.notes }, at: nowSH() }); writeJ(stF('accounts-changes.json'), all); }
  function taskFiles() { const out = []; for (const a of AGENTS) { let fsx = []; try { fsx = fs.readdirSync(path.join(KB, 'inbox', a)); } catch {}
    for (const f of fsx) if (f.endsWith('.json') && TASK_RE.test(f.slice(0, -5))) { const p = path.join(KB, 'inbox', a, f); try { out.push({ p, t: JSON.parse(fs.readFileSync(p, 'utf8')) }); } catch {} } } return out; }
  const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

  async function handle(req, res, url) {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress, p = url.pathname;
    if (!TOKEN) return send(res, 503, { error: 'sync disabled' });
    if (limited(ip)) return send(res, 429, { error: 'rate limited' });
    if (!authOK(req)) { fail(ip); return send(res, 401, { error: 'unauthorized' }); }
    let b = {}; if (req.method === 'POST') { try { const raw = await readBody(req); b = raw ? JSON.parse(raw) : {}; } catch (e) { return send(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'body too large (25MB)' : 'bad json' }); } }
    if (p === '/api/sync/push' && req.method === 'POST') {
      const files = b.files; if (!files || typeof files !== 'object' || Array.isArray(files)) return send(res, 400, { error: 'files{} required' });
      const ents = Object.entries(files); if (ents.length > MAX_FILES) return send(res, 400, { error: 'too many files' });
      for (const [rel, c] of ents) { if (!okPath(rel)) return send(res, 400, { error: 'path not allowed: ' + String(rel).slice(0, 80) }); if (typeof c !== 'string' || Buffer.byteLength(c) > MAX_FILE) return send(res, 400, { error: 'bad or too large file: ' + rel }); }
      const pendAcc = readJ(stF('accounts-changes.json'), []).length > 0;
      for (const [rel, c] of ents) { if (rel === 'accounts.json' && pendAcc) continue; const f = path.join(KB, rel); if (!f.startsWith(KB + path.sep)) return send(res, 400, { error: 'bad path' });
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', c); fs.renameSync(f + '.tmp', f); }
      if (b.mode === 'replace') { const keep = new Set(ents.map(e => e[0])); // 删除快照里已不存在的白名单文件
        const walk = d => { let xs = []; try { xs = fs.readdirSync(path.join(KB, d), { withFileTypes: true }); } catch {} for (const x of xs) { const r = d + '/' + x.name; if (x.isDirectory()) walk(r); else if (okPath(r) && !keep.has(r)) fs.unlinkSync(path.join(KB, r)); } };
        REPLACE_DIRS.forEach(walk); }
      // 网页上产生、box 还没拉走的日志行补回去，避免被快照覆盖
      const hl = hostLogs(); if (hl.length) fs.appendFileSync(path.join(KB, 'logs', 'company.log.jsonl'), hl.map(x => JSON.stringify(x.line)).join('\n') + '\n');
      snapshot = { hash: typeof b.hash === 'string' ? b.hash.slice(0, 80) : null, at: nowSH(), files: ents.length }; writeJ(stF('snapshot.json'), snapshot);
      return send(res, 200, { ok: true, written: ents.length, accounts_skipped: pendAcc });
    }
    if (p === '/api/sync/inbox' && req.method === 'GET') {
      const tasks = taskFiles().filter(({ t }) => (t.host_rev || 0) > (t.delivered_rev || 0)).map(({ t }) => t);
      return send(res, 200, { tasks, accounts_changes: readJ(stF('accounts-changes.json'), []), logs: hostLogs() });
    }
    if (p === '/api/sync/ack' && req.method === 'POST') {
      let n = 0; const tf = taskFiles();
      for (const a of Array.isArray(b.tasks) ? b.tasks : []) { const hit = tf.find(x => x.t.id === a.id && x.t.agent === a.agent); if (!hit || !Number.isInteger(a.rev)) continue;
        hit.t.delivered_rev = Math.max(hit.t.delivered_rev || 0, a.rev); hit.t.delivered_at = nowSH(); writeJ(hit.p, hit.t); n++; }
      const cids = new Set(Array.isArray(b.accounts_changes) ? b.accounts_changes : []); writeJ(stF('accounts-changes.json'), readJ(stF('accounts-changes.json'), []).filter(c => !cids.has(c.cid)));
      const sids = new Set(Array.isArray(b.logs) ? b.logs : []); const left = hostLogs().filter(x => !sids.has(x.sid));
      fs.writeFileSync(stF('host-log.jsonl'), left.map(x => JSON.stringify(x)).join('\n') + (left.length ? '\n' : ''));
      return send(res, 200, { ok: true, tasks_acked: n });
    }
    if (p === '/api/sync/status' && req.method === 'POST') {
      const ST = ['queued', 'in_progress', 'done', 'approved', 'rejected', 'awaiting_approval', 'cancelled']; let n = 0; const tf = taskFiles();
      for (const s of Array.isArray(b.tasks) ? b.tasks.slice(0, 5000) : []) {
        if (!s || !AGENTS.includes(s.agent) || !TASK_RE.test(String(s.id)) || !ST.includes(s.status)) continue;
        const hit = tf.find(x => x.t.id === s.id && x.t.agent === s.agent);
        if (hit) { if ((hit.t.host_rev || 0) > (hit.t.delivered_rev || 0)) continue; // 网页上的新改动还没交付，先不覆盖
          hit.t.status = s.status; if (typeof s.result_note === 'string') hit.t.result_note = s.result_note.slice(0, 2000); writeJ(hit.p, hit.t); n++; }
        else if (typeof s.text === 'string') { const d = path.join(KB, 'inbox', s.agent); fs.mkdirSync(d, { recursive: true });
          const t = { id: s.id, agent: s.agent, text: s.text.slice(0, 4000), priority: ['P0', 'P1', 'P2'].includes(s.priority) ? s.priority : 'P1', requires_approval: !!s.requires_approval, created_at: String(s.created_at || '').slice(0, 30), created_by: String(s.created_by || 'box').slice(0, 30), status: s.status };
          if (typeof s.result_note === 'string') t.result_note = s.result_note.slice(0, 2000); writeJ(path.join(d, s.id + '.json'), t); n++; } }
      return send(res, 200, { ok: true, updated: n });
    }
    return send(res, 404, { error: 'not found' });
  }
  return { handle, hostLog, accountChange, snapshotInfo: () => ({ hash: snapshot.hash, at: snapshot.at }) };
};
module.exports.FILE_RE = FILE_RE; module.exports.okPath = okPath;
