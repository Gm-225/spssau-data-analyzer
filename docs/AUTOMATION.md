# 自动化分析 MVP 使用说明

## 1. 启动分析 API

默认仅监听本机，数据库保存在 `data/analysis.db`：

```powershell
npm run api
```

检查服务：

```powershell
Invoke-RestMethod http://127.0.0.1:8765/health
```

提交示例任务：

```powershell
$body = Get-Content -Raw -Encoding UTF8 .\examples\descriptive-request.json
Invoke-RestMethod `
  -Method Post `
  -Uri http://127.0.0.1:8765/v1/analysis-jobs `
  -ContentType 'application/json' `
  -Headers @{ 'Idempotency-Key' = 'example-order-001' } `
  -Body $body
```

响应中的 `id` 是可追踪任务 ID。之后可调用：

```text
GET /v1/analysis-jobs/{id}
```

## 2. 让现有界面调用 API

在项目根目录创建本地环境文件 `.env.local`：

```text
VITE_ANALYSIS_API_URL=http://127.0.0.1:8765
```

然后启动 API 和前端：

```powershell
npm run api
npm run dev
```

描述性分析会通过 API 执行并持久化；其他方法暂时保留本地人工模式，不会误进入无人值守流程。

## 3. n8n 连接

可将 `n8n/analysis-api-mvp.json` 导入 n8n。工作流接收 Webhook 请求，将请求体转交分析 API，再把结果返回调用方。

自托管 n8n 建议设置：

```text
ANALYSIS_API_URL=http://host.docker.internal:8765
ANALYSIS_API_KEY=请生成一个高强度随机值
```

当 n8n 运行在 Docker 中，需要让 API 可从容器访问：

```powershell
$env:ANALYSIS_API_HOST='0.0.0.0'
$env:ANALYSIS_API_KEY='与 n8n 中相同的高强度随机值'
npm run api
```

服务对非本机地址监听时会强制要求 API Key。生产部署还应增加 HTTPS、反向代理、来源限制和独立的密钥管理。

## 4. 当前 API 契约

- `GET /health`：健康检查，不需要密钥。
- `POST /v1/analysis-jobs`：创建并执行任务。
- `GET /v1/analysis-jobs/{id}`：查询持久化任务。
- `Idempotency-Key`：建议由订单号或上游请求 ID 生成；n8n 重试时复用同一个值。
- `Authorization: Bearer <key>`：设置 `ANALYSIS_API_KEY` 后必须提供。
- 当前自动化白名单：`descriptive`。

API 只持久化列名、行数、变量映射和分析结果，不把原始数据行写入 SQLite。

## 5. 验证

```powershell
npm test
```

服务运行期间还可以执行：

```powershell
python scripts/smoke_analysis_api.py
```

