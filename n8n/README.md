# n8n 工作流

`analysis-api-mvp.json` 是第一版编排模板：

1. Webhook 接收标准分析请求。
2. HTTP Request 调用 `/v1/analysis-jobs`。
3. Respond to Webhook 返回持久化任务。

导入后检查 API 地址和认证配置，再发布工作流。模板使用 n8n 环境变量 `ANALYSIS_API_URL` 和 `ANALYSIS_API_KEY`。如果你的 n8n 环境禁止工作流读取环境变量，请在 HTTP Request 节点中改用 Header Auth 凭据，并手工填写 API 地址。

