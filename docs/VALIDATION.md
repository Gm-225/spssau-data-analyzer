# 验证日志

创建日期：2026-07-12

## 门槛

- 功能：HTTP 提交、执行、持久化、查询完整闭环。
- 数据/API：固定 v1 契约；错误有稳定 code；SQLite 可读回。
- UI：配置 API 地址后能完成分析；空状态和错误使用现有 Toast 展示。
- 质量：Python 单元/集成测试与 TypeScript/Vite 构建全部通过。
- 安全：默认仅本机监听；可选 API Key；不记录请求原始行数据。

## 证据

| 日期 | 门槛 | 命令/检查 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 2026-07-12 | baseline | `npm run build` | failed | `src/main.tsx`: `ImportMeta.env` 类型缺失，待修复 |
| 2026-07-12 | API tests | `python -m unittest discover -s services/analysis_api/tests -v` | passed | 8/8；含认证、幂等、持久化、错误契约、危险方法隔离 |
| 2026-07-12 | quality | `npm test` | passed | 后端 8/8 + TypeScript/Vite 生产构建 |
| 2026-07-12 | n8n artifact | `python -m json.tool n8n/analysis-api-mvp.json` | passed | 工作流 JSON 语法有效；尚未在真实 n8n 实例导入 |
| 2026-07-12 | HTTP smoke | `python scripts/smoke_analysis_api.py` | passed | 创建完成任务并返回持久化 job ID |
| 2026-07-12 | health | `GET /health` | passed | 返回 serviceVersion 0.1.0、apiVersion v1 |
| 2026-07-12 | safety | 非本机监听且未设置 `ANALYSIS_API_KEY` | passed | 服务拒绝启动；认证接口测试同时覆盖 401 |
| 2026-07-12 | AI one-click UI | `npm run build` | passed | AI 需求框、自动分组、综合报告和模板 Word 导出通过类型检查与生产构建 |
| 2026-07-14 | scientific accuracy | `npm run test:scientific` | passed | 独立复核 α、KMO、OLS；5000 次 Bootstrap 重跑一致；DOCX/PDF 可解析，PDF 8 页 |
| 2026-07-14 | Electron E2E | `npm run test:e2e` | passed | 真实上传 100×26 XLSX → 自动识别 X/Y/M/W → 一键分析 → 结果页 → DOCX/PDF；控制台零错误 |
| 2026-07-14 | UI layout | 1440×900 Electron 截图与 DOM 宽度检查 | passed | documentWidth 1411 ≤ viewportWidth 1426；长题目截断且不侵入相邻区域 |
| 2026-07-14 | report visual QA | PDFium 渲染并逐页检查 8/8 页 | passed | A4 黑白学术版式、编号章节、三线表、跨页重复表头、模型图/调节图，无裁切或重叠 |
| 2026-07-14 | desktop shortcut | WScript Shell 属性检查 | passed | 目标、参数、工作目录与图标均存在，指向项目 Electron 可执行文件 |
| 2026-07-20 | V2 generic flow | `npm run test:v2` | passed | 180 行 synthetic SAT/VAL/LOY；基础信息、缺失、频数、描述、信度、EFA、相关、多元回归、动态文字；R²=0.5573698825；JSON/DOCX/PDF 均生成 |
| 2026-07-20 | fixed scientific regression | `npm run test:scientific` | passed | 固定五构念 α/KMO/OLS/Bootstrap 复核通过；完整 PDF 11 页、限定 PDF 4 页；历史 outputs 哈希不变 |
| 2026-07-20 | API regression | `npm run test:api` | passed | 8/8；认证、幂等、持久化、错误契约保持正常 |
| 2026-07-20 | frontend build | `npm run build` | passed | TypeScript/Vite；1788 modules transformed |
| 2026-07-20 | Electron V2 regression | `npm run test:e2e` | passed | 自动方案写入任务目录；固定完整模型、限定信度、通用 PP+PV→AA 回归、无效需求均通过；DOCX/PDF 完整，consoleErrors 为空 |
| 2026-07-20 | Word/PDF visual QA | bundled `render_docx.py` + Poppler `pdftoppm` | passed | 最终通用样例 DOCX 6 页、PDF 4 页；逐页 100% 检查无裁切、重叠、缺字或表格溢出；移除相关与回归之间多余硬分页 |
| 2026-07-31 | P0 full regression | `npm test` | passed | API 8/8；固定科学、V2、P0 safety 9/9、TypeScript/Vite 全部通过；最终科学证据 `scientific-20260731-231406`，P0 证据 `safety-20260731-231427` |
| 2026-07-31 | P0 Electron E2E | `npm run test:e2e` | passed | `electron-2026-07-31T15-10-10-316Z`；方案锁、手动 CFA 阻断、完整/限定/通用回归、失败关闭、内容级产物门、manifest/磁盘集合与哈希均通过 |
| 2026-07-31 | interrupted recovery | E2E 启动前 synthetic UUID fixtures | passed | 新版 ephemeral running 任务恢复为 `INTERRUPTED`，删除 input/staging/8 类未完成产物；同版缺 marker 与旧版有 marker sentinel 均逐字节不变 |
| 2026-07-31 | provenance/privacy | E2E manifest 重算与目录核对 | passed | 2.1.0、输入/方案 SHA-256、实际范围、Bootstrap 次数、全部保留产物哈希与相对路径可重算；原始输入默认删除、案例记忆默认关闭 |
| 2026-07-31 | AMOS regression | `npm run test:amos` | passed | `automated-20260731-231543`；8 个 synthetic 用例通过，固定种子复现、数据敏感性、错误态和 AMOS-only 均通过；未捆绑 IBM 二进制 |
| 2026-07-31 | historical protection | 文件数/字节数/时间戳与固定 outputs 聚合哈希 | passed | `outputs` 3 文件/910012 B，聚合 SHA-256 `C8C0...82EFF`；`data/reports` 30 文件/6223047 B，最新时间仍为 2026-07-14；未清理历史输入或报告 |
| 2026-07-31 | independent read-only review | P0 code/evidence review | passed | 结论“无阻断 P0”；未修改文件 |

## 未运行检查

- 检查：打包后的 Electron 安装包人工点击验证。
- 原因：首版先验证 API 和 Web 构建主线，尚未生成安装包。
- 替代证据：TypeScript/Vite 构建和 HTTP 集成测试。
- 检查：在用户真实 n8n 实例中导入并发布工作流。
- 原因：当前环境没有连接到用户的 n8n 实例。
- 替代证据：工作流 JSON 语法校验和分析 API HTTP 冒烟测试均通过。
