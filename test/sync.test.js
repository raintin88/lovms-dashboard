'use strict';
// 远程模式 + 同步接口测试（本机 127.0.0.1，不连外网）
const { test, before, after } = require('node:test'); const assert = require('node:assert');
const { spawn, execFileSync } = require('child_process'); const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const PW = 'pw-' + Math.random().toString(36).slice(2), TOK = 'tok-' + require('crypto').randomBytes(16).toString('hex'), PORT = 19000 + Math.floor(Math.random() * 900), B = `http://127.0.0.1:${PORT}`;
let host, boxKb, proc, ck = '';
const H = (t = TOK) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
before(async () => { host = fs.mkdtempSync(path.join(os.tmpdir(), 'host-')); boxKb = fs.mkdtempSync(path.join(os.tmpdir(), 'box-')); const src = path.join(__dirname, '..', '..', 'knowledge');
  for (const f of ['agents.json', 'todo.json', 'accounts.json', 'logs', 'metrics', 'reports', 'playbooks', 'agents', 'schema']) fs.cpSync(path.join(src, f), path.join(boxKb, f), { recursive: true });
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, REMOTE_MODE: '1', KB_DIR: host, SYNC_TOKEN: TOK, DASH_PASSWORD: PW, DASH_SECRET: 's'.repeat(32), PORT, SHOPIFY_MOCK: '', SHOPIFY_SHOP: '', SHOPIFY_ADMIN_TOKEN: '' }, stdio: 'pipe' });
  await new Promise(ok => proc.stdout.on('data', ok)); ck = (await fetch(B + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PW }) })).headers.get('set-cookie').split(';')[0]; });
after(() => { proc.kill(); fs.rmSync(host, { recursive: true, force: true }); fs.rmSync(boxKb, { recursive: true, force: true }); });
const runSync = () => execFileSync(process.execPath, [path.join(__dirname, '..', 'sync', 'box-sync.js'), '--once'], { env: { ...process.env, REMOTE_URL: B, SYNC_TOKEN: TOK, KB_DIR: boxKb }, encoding: 'utf8' });

test('healthz 无需登录且不含秘密', async () => { const j = await (await fetch(B + '/healthz')).json(); assert.equal(j.ok, true); assert.equal(j.mode, 'remote'); assert.ok(!JSON.stringify(j).includes(TOK)); });
test('sync 接口需要 Bearer 令牌（cookie 无效、错令牌 401）', async () => {
  assert.equal((await fetch(B + '/api/sync/inbox')).status, 401); assert.equal((await fetch(B + '/api/sync/inbox', { headers: H('wrong') })).status, 401);
  assert.equal((await fetch(B + '/api/sync/inbox', { headers: { cookie: ck } })).status, 401); assert.equal((await fetch(B + '/api/sync/inbox', { headers: H() })).status, 200); });
test('push 拒绝路径穿越与非白名单路径', async () => {
  for (const bad of ['../x.json', 'agents/../../etc/passwd.md', 'inbox/ceo/Q-20260101-000000.json', '.sync/snapshot.json', 'secret.txt', 'playbooks/.hidden.md', '/etc/passwd']) {
    const r = await fetch(B + '/api/sync/push', { method: 'POST', headers: H(), body: JSON.stringify({ files: { [bad]: 'x' } }) }); assert.equal(r.status, 400, bad); }
  assert.ok(!fs.existsSync(path.join(host, 'secret.txt'))); });
test('push 超过 25MB 返回 413', async () => { const big = 'a'.repeat(26 * 1024 * 1024);
  const code = await new Promise(ok => { const rq = http.request(B + '/api/sync/push', { method: 'POST', headers: { ...H(), 'Content-Length': big.length } }, r => { r.resume(); ok(r.statusCode); }); rq.on('error', () => ok('reset')); rq.end(big); });
  assert.ok(code === 413 || code === 'reset', String(code)); });
test('端到端：box 推快照 → 网页派任务/改账号 → box 拉取并 ack → 状态回推', async () => {
  let out = runSync(); assert.match(out, /pushed snapshot/);
  const ov = await (await fetch(B + '/api/overview', { headers: { cookie: ck } })).json(); assert.equal(ov.agents.agents.length, 8); assert.ok(ov.logs.length > 0);
  assert.doesNotMatch(runSync(), /pushed snapshot/); // 无变化不重复推
  const t = await (await fetch(B + '/api/tasks', { method: 'POST', headers: { cookie: ck, 'Content-Type': 'application/json' }, body: JSON.stringify({ agent: 'tiktok', text: '同步测试', priority: 'P2', requires_approval: true }) })).json();
  assert.equal((await fetch(B + '/api/accounts/tiktok', { method: 'POST', headers: { cookie: ck, 'Content-Type': 'application/json' }, body: JSON.stringify({ handle: 'lovms.test', status: 'pending' }) })).status, 200);
  out = runSync(); assert.match(out, /pulled task tiktok/); assert.match(out, /applied account change tiktok/);
  const local = JSON.parse(fs.readFileSync(path.join(boxKb, 'inbox/tiktok', t.id + '.json'))); assert.equal(local.text, '同步测试'); assert.equal(local.host_rev, undefined);
  assert.equal(JSON.parse(fs.readFileSync(path.join(boxKb, 'accounts.json'))).accounts.find(a => a.platform === 'tiktok').handle, 'lovms.test');
  assert.ok(fs.readFileSync(path.join(boxKb, 'logs/company.log.jsonl'), 'utf8').includes(t.id));
  assert.equal((await (await fetch(B + '/api/sync/inbox', { headers: H() })).json()).tasks.length, 0);
  // 网页批准 → box 收到；box 改成 done → 网页显示 done
  await fetch(B + `/api/tasks/tiktok/${t.id}/approve`, { method: 'POST', headers: { cookie: ck, 'Content-Type': 'application/json' }, body: '{}' }); runSync();
  assert.equal(JSON.parse(fs.readFileSync(path.join(boxKb, 'inbox/tiktok', t.id + '.json'))).status, 'approved');
  const f = path.join(boxKb, 'inbox/tiktok', t.id + '.json'), v = JSON.parse(fs.readFileSync(f)); v.status = 'done'; fs.writeFileSync(f, JSON.stringify(v)); runSync();
  const hs = (await (await fetch(B + '/api/tasks', { headers: { cookie: ck } })).json()).tasks.find(x => x.id === t.id); assert.equal(hs.status, 'done');
  // 账号文件以 box 为准：快照回推后 host 与 box 一致
  const ha = await (await fetch(B + '/api/accounts', { headers: { cookie: ck } })).json(); assert.equal(ha.accounts.find(a => a.platform === 'tiktok').handle, 'lovms.test'); });
