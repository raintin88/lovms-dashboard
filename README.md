# LOVMS 智能营销中心看板 v2

纯 Node 20，无第三方依赖。读 `../knowledge/`；写入仅限：`knowledge/inbox/<agent>/`（任务）、`knowledge/accounts.json`（账号连接）、`knowledge/logs/company.log.jsonl`（追加人类操作日志）。

## 本地运行
```
DASH_PASSWORD='…' DASH_SECRET="$(openssl rand -hex 32)" node server.js      # http://127.0.0.1:8787
# 可选：PORT= HOST= KB_DIR=  SHOPIFY_SHOP= SHOPIFY_ADMIN_TOKEN= SHOPIFY_API_VERSION=(默认 2025-10)  SHOPIFY_MOCK=1
node --test test/        # 11 个测试，不连真实 Shopify
```
缺 DASH_PASSWORD / DASH_SECRET(≥16) 拒绝启动。HTTPS 反代需带 `X-Forwarded-Proto: https`（cookie 加 Secure）。本地测试密码只在 `.local-test-password`（已 gitignore）。

## 页面
总览 · AI 员工团队 · 员工详情（概览/工作日志/成果/计划与手册/任务）· Shopify 实时数据 · 账号连接 · 任务与审批。
员工状态只从文件推导：运行中 = agents.json `status` 为 active/running 或 2 小时内有非示例日志；待确认 = 有待批准任务 / 待拍板事项（非示例）；否则待命。

## API（除 login 外都需登录）
- `POST /api/login` / `POST /api/logout`
- `GET /api/overview` — agents、statuses、todo、最新 metrics、system 日报、日志、任务、accounts
- `GET /api/agent/<id>` — status、日志(≤1000)、全部日报、playbooks、`agents/<id>/` 产出文件、任务、负责账号、`date_is_fallback`
- `GET /api/kbfile?path=` — 只读白名单：`reports/<日期>/`、`playbooks/`、`agents/<id>/`、`metrics/<日期>/` 下的 .md/.json
- `GET /api/shopify/summary[?refresh=1]` — 60 秒缓存
- `GET /api/accounts`、`POST /api/accounts/<platform>` `{handle,profile_url,status,notes}`（只许这些字段；URL 仅 http/https；拒绝含 password/token 的文本；写日志）
- `GET/POST /api/tasks`、`POST /api/tasks/<agent>/<id>/approve|reject`（新任务 id 前缀 `Q-`，旧 `T-` 照常读取；派任务与审批都写日志）

## 连接 Shopify（实时数据）
需要的权限（Admin API scopes）：`read_orders`、`read_products`、`read_reports`（访客会话，ShopifyQL；没有也能用，只是访客显示「—」）。**不需要** `read_customers`。
订单只读取收货地址的名字（first name）、城市、国家，不读邮箱/电话。
1. Shopify 后台 → 设置 → 应用和销售渠道 → 开发应用（首次需点「允许自定义应用开发」）。
2. 创建应用，名称如 `LOVMS Dashboard`。
3. 配置 Admin API 权限：勾选上面 3 项 → 保存。
4. 安装应用 → 在「API 凭据」里显示 Admin API 访问令牌（`shpat_…`，只显示一次）。
5. 把令牌放进部署平台的环境变量 `SHOPIFY_ADMIN_TOKEN`，`SHOPIFY_SHOP=qw1wau-ty.myshopify.com`。不要发到聊天里、不要写进 knowledge。
6. 如订单里地址为空：自定义应用读取受保护客户数据可能需在应用设置中申请「受保护的客户数据」访问（Level 1 即可，不选邮箱/电话/地址明细以外字段）。
注：2026 年 1 月起 Shopify 新建自定义应用改走 Dev Dashboard，若后台没有「开发应用」入口，请在 Dev Dashboard 建应用并用 client credentials 取令牌——上线前需实测确认。
未配置/出错时页面显示「Shopify 未连接」，绝不编数据；`SHOPIFY_MOCK=1` 返回带「示例数据」标记的假数据，仅用于看 UI。

## 远程模式（Render）与 box 同步
- 服务器：`REMOTE_MODE=1`，数据目录 `KB_DIR`（免费版 `/tmp/kb`，重启即清空，box 会自动补推）。`GET /healthz` 无需登录。
- 同步接口只认 `Authorization: Bearer $SYNC_TOKEN`（与登录 cookie 分开；失败 10 次锁 15 分钟；每 IP 每分钟 ≤120 次；请求体 ≤25MB，单文件 ≤5MB；只允许白名单路径，见 `lib/sync.js` 的 `FILE_RE`）：
  - `POST /api/sync/push` `{mode:'replace', hash, files:{相对路径: 文本}}`
  - `GET /api/sync/inbox` → 网页新建/审批的任务、账号修改、网页产生的日志行
  - `POST /api/sync/ack` `{tasks:[{agent,id,rev}], accounts_changes:[cid], logs:[sid]}`
  - `POST /api/sync/status` `{tasks:[…]}`（box 回推任务状态）
- box 端：`sync/box-sync.js`（每 60 秒），配置 `run/sync.env`（`REMOTE_URL=`、`SYNC_TOKEN=`，chmod 600，已 gitignore），启动 `run/start-sync.sh`，日志 `run/sync.log`。
