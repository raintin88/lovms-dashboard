'use strict';
// Shopify Admin GraphQL → 看板摘要。令牌只从环境变量读取，绝不写日志。
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const TZ_OFFSET = 8 * 3600e3; // 统一按 Asia/Shanghai 切日

const ORDERS_Q = `query($q:String!,$after:String){orders(first:250,after:$after,query:$q,sortKey:CREATED_AT,reverse:true){
 pageInfo{hasNextPage endCursor}
 nodes{name createdAt displayFinancialStatus cancelledAt test
  totalPriceSet{shopMoney{amount currencyCode}}
  shippingAddress{firstName city countryCodeV2}
  lineItems(first:20){nodes{title quantity originalTotalSet{shopMoney{amount}}}}}}}`;
const COUNTS_Q = `{active:productsCount(query:"status:active"){count} draft:productsCount(query:"status:draft"){count} all:productsCount{count} shop{name currencyCode ianaTimezone}}`;
const QL_Q = `query($q:String!){shopifyqlQuery(query:$q){parseErrors tableData{columns{name} rows}}}`;

function shDay(ms) { return new Date(ms + TZ_OFFSET).toISOString().slice(0, 10); }
function dayStartMs(day) { return Date.parse(day + 'T00:00:00+08:00'); }

// 纯函数：订单节点 → 摘要（单元测试用）
function summarize(orders, counts, now = Date.now(), sessions = null) {
  const today = shDay(now), t0 = dayStartMs(today);
  const win = { today: t0, d7: t0 - 6 * 864e5, d30: t0 - 29 * 864e5 };
  const valid = orders.filter(o => !o.cancelledAt && !o.test);
  const agg = from => { const os = valid.filter(o => Date.parse(o.createdAt) >= from);
    const sales = os.reduce((s, o) => s + Number(o.totalPriceSet?.shopMoney?.amount || 0), 0);
    return { orders: os.length, sales: +sales.toFixed(2), aov: os.length ? +(sales / os.length).toFixed(2) : null }; };
  const series = []; for (let i = 29; i >= 0; i--) { const d = shDay(t0 - i * 864e5 + 3600e3); series.push({ date: d, sales: 0, orders: 0 }); }
  const idx = Object.fromEntries(series.map((s, i) => [s.date, i]));
  const prod = {};
  for (const o of valid) { const d = shDay(Date.parse(o.createdAt)); if (d in idx) { series[idx[d]].sales += Number(o.totalPriceSet?.shopMoney?.amount || 0); series[idx[d]].orders++; }
    if (Date.parse(o.createdAt) >= win.d30) for (const li of o.lineItems?.nodes || []) { const p = prod[li.title] || (prod[li.title] = { title: li.title, quantity: 0, sales: 0 }); p.quantity += li.quantity || 0; p.sales += Number(li.originalTotalSet?.shopMoney?.amount || 0); } }
  series.forEach(s => s.sales = +s.sales.toFixed(2));
  const currency = orders[0]?.totalPriceSet?.shopMoney?.currencyCode || counts?.shop?.currencyCode || 'USD';
  return {
    currency, timezone: 'Asia/Shanghai', today: agg(win.today), d7: agg(win.d7), d30: agg(win.d30), series_30d: series,
    top_products: Object.values(prod).map(p => ({ ...p, sales: +p.sales.toFixed(2) })).sort((a, b) => b.sales - a.sales).slice(0, 5),
    recent_orders: orders.slice(0, 8).map(o => ({ name: o.name, created_at: o.createdAt, total: Number(o.totalPriceSet?.shopMoney?.amount || 0), currency: o.totalPriceSet?.shopMoney?.currencyCode,
      financial_status: o.displayFinancialStatus, cancelled: !!o.cancelledAt, first_name: o.shippingAddress?.firstName || null, city: o.shippingAddress?.city || null, country: o.shippingAddress?.countryCodeV2 || null })),
    products: counts ? { active: counts.active?.count ?? null, draft: counts.draft?.count ?? null, total: counts.all?.count ?? null } : null,
    shop_name: counts?.shop?.name || null, sessions,
  };
}
function parseSessions(ql) { // ShopifyQL 结果 → {d30, series}；失败返回 null
  try { const t = ql?.tableData; if (!t || (ql.parseErrors && ql.parseErrors.length)) return null;
    const cols = t.columns.map(c => c.name); const rows = typeof t.rows === 'string' ? JSON.parse(t.rows) : t.rows;
    const get = (r, k) => Array.isArray(r) ? r[cols.indexOf(k)] : r[k];
    const series = rows.map(r => ({ date: String(get(r, 'day')).slice(0, 10), sessions: Number(get(r, 'sessions')) || 0 }));
    return { d30: series.reduce((s, x) => s + x.sessions, 0), series };
  } catch { return null; }
}

// ---- 认证：client credentials（Dev Dashboard 应用）或固定 Admin 令牌 ----
let tok = { key: null, token: null, exp: 0 };
const mask = (s, env) => { let t = String(s); for (const v of [env.SHOPIFY_CLIENT_SECRET, env.SHOPIFY_ADMIN_TOKEN, tok.token]) if (v) t = t.split(v).join('***'); return t.replace(/shp[a-z]{2}_[A-Za-z0-9]+/g, '***'); };
async function exchange(shop, env, fetchImpl, now) {
  const r = await fetchImpl(`https://${shop}/admin/oauth/access_token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.SHOPIFY_CLIENT_ID, client_secret: env.SHOPIFY_CLIENT_SECRET }).toString(), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('令牌换取失败 HTTP ' + r.status);
  const j = await r.json(); if (!j.access_token) throw new Error('令牌换取失败：无 access_token');
  tok = { key: shop + '|' + env.SHOPIFY_CLIENT_ID, token: j.access_token, exp: now + Math.max(60, (+j.expires_in || 86400) - 300) * 1000 };
  return tok.token; }
function makeAuth(shop, env, fetchImpl, now) {
  if (env.SHOPIFY_CLIENT_ID && env.SHOPIFY_CLIENT_SECRET) {
    const key = shop + '|' + env.SHOPIFY_CLIENT_ID;
    return { get: async () => (tok.key === key && tok.token && now < tok.exp) ? tok.token : exchange(shop, env, fetchImpl, now), refresh: () => exchange(shop, env, fetchImpl, now), kind: 'client_credentials' }; }
  if (env.SHOPIFY_ADMIN_TOKEN) return { get: async () => env.SHOPIFY_ADMIN_TOKEN, refresh: null, kind: 'admin_token' };
  return null; }
async function gqlA(shop, auth, query, variables, fetchImpl) {
  try { return await gql(shop, await auth.get(), query, variables, fetchImpl); }
  catch (e) { if (e.status === 401 && auth.refresh) return gql(shop, await auth.refresh(), query, variables, fetchImpl); throw e; } }
async function gql(shop, token, query, variables, fetchImpl = fetch) {
  const r = await fetchImpl(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
  const j = await r.json(); if (j.errors && !j.data) throw new Error((j.errors[0] && j.errors[0].message) || 'GraphQL error');
  return j;
}

function mock(now = Date.now()) {
  const t0 = dayStartMs(shDay(now)), orders = [];
  const names = ['Classic Moissanite Solitaire Ring', 'S925 Tennis Bracelet', 'Moissanite Stud Earrings', 'Halo Pendant Necklace'];
  for (let i = 0; i < 24; i++) orders.push({ name: '#示例' + (1024 - i), createdAt: new Date(t0 + 12 * 3600e3 - i * 1.2 * 864e5).toISOString(), displayFinancialStatus: 'PAID', cancelledAt: null, test: false,
    totalPriceSet: { shopMoney: { amount: String(58 + (i * 37) % 120), currencyCode: 'USD' } }, shippingAddress: { firstName: '示例', city: 'Example City', countryCodeV2: 'US' },
    lineItems: { nodes: [{ title: '[示例] ' + names[i % 4], quantity: 1, originalTotalSet: { shopMoney: { amount: String(58 + (i * 37) % 120) } } }] } });
  const s = summarize(orders, { active: { count: 0 }, draft: { count: 0 }, all: { count: 0 }, shop: { name: '示例店铺', currencyCode: 'USD' } }, now, null);
  return { connected: true, example: true, mode: 'mock', fetched_at: new Date(now).toISOString(), ...s, products: { active: null, draft: null, total: null }, notes: ['SHOPIFY_MOCK=1：全部为示例数据，不是真实店铺数据'] };
}

let cache = { at: 0, data: null };
async function summary({ env = process.env, fetchImpl = fetch, now = Date.now(), force = false } = {}) {
  if (env.SHOPIFY_MOCK === '1') return mock(now);
  const shop = env.SHOPIFY_SHOP, auth = shop ? makeAuth(shop, env, fetchImpl, now) : null;
  if (!shop || !auth) return { connected: false, reason: 'not_configured', hint: '服务器未设置 SHOPIFY_SHOP 和（SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET 或 SHOPIFY_ADMIN_TOKEN），见 README「连接 Shopify」' };
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) return { connected: false, reason: 'bad_shop', hint: 'SHOPIFY_SHOP 应形如 qw1wau-ty.myshopify.com' };
  if (!force && cache.data && now - cache.at < 60e3) return { ...cache.data, cached: true };
  try {
    const since = new Date(dayStartMs(shDay(now)) - 29 * 864e5).toISOString();
    const orders = []; let after = null;
    let OQ = ORDERS_Q;
    for (let p = 0; p < 8; p++) { let j; try { j = await gqlA(shop, auth, OQ, { q: `created_at:>='${since}'`, after }, fetchImpl); if (!j.data || !j.data.orders) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'orders unavailable'); }
      catch (e) { if (OQ === ORDERS_Q && e.status !== 401) { OQ = ORDERS_Q.replace(/\s*shippingAddress\{[^}]*\}/, ''); p--; continue; } throw e; } // 受保护客户数据不可读时，去掉收货地址重试
      const c = j.data.orders; orders.push(...c.nodes); if (!c.pageInfo.hasNextPage) break; after = c.pageInfo.endCursor; }
    let counts = null, notes = []; try { counts = (await gqlA(shop, auth, COUNTS_Q, {}, fetchImpl)).data; } catch (e) { notes.push('商品数量读取失败（需 read_products）'); }
    let sessions = null; try { const j = await gqlA(shop, auth, QL_Q, { q: 'FROM sessions SHOW sessions GROUP BY day SINCE -30d UNTIL today' }, fetchImpl); sessions = parseSessions(j.data && j.data.shopifyqlQuery); } catch {}
    if (!sessions) notes.push('访客/会话数不可用（需 read_reports 权限或该 API 版本不支持 ShopifyQL）');
    const data = { connected: true, example: false, mode: 'live', fetched_at: new Date(now).toISOString(), ...summarize(orders, counts, now, sessions), notes };
    cache = { at: now, data }; return data;
  } catch (e) {
    return { connected: false, reason: 'api_error', hint: 'Shopify API 调用失败：' + mask(e.message, env).slice(0, 160) };
  }
}
module.exports = { summary, summarize, parseSessions, mock, _resetCache: () => { cache = { at: 0, data: null }; tok = { key: null, token: null, exp: 0 }; }, API_VERSION };
