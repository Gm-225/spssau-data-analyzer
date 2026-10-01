# Issue 006 - 合成数据交付主线可复核

type: bug
status: verify
main_flow: yes
owner: Codex / T-20260717-08

## 用户痛点

现有界面看起来已经具备“AI 一键分析”，但关键回归仍绑定桌面旧问卷，报告目录也无法隔离。售前无法安全、可重复地证明“上传数据 → 自然语言需求 → 自动识别变量 → 科学计算 → JSON/DOCX/PDF”的完整交付闭环，也无法证明仅指定章节和无效需求不会生成越界或伪造报告。

## 核心交付主线

使用固定种子、明确标注为 synthetic 的问卷数据，在 Electron 中上传 Excel/CSV，输入完整分析需求，自动识别 PP/AA/PC/PI/PV 及 X/Y/M/W 角色，执行确定性的 Python 科学计算，并把 JSON、DOCX、PDF 写入本次任务专属证据目录。

## 验收门槛

- [x] 功能：合成 Excel 或 CSV 可从上传页进入分析页，完整自然语言需求可一键到达结果页，并生成 JSON/DOCX/PDF。
- [x] 功能：请求“只做信度分析”时，结果与报告仅包含必要的数据质量/变量识别和信度章节，不出现频数、描述、EFA、相关、中介、调节或综合结论章节。
- [x] 数据/科学：固定种子重复运行时 Bootstrap 间接效应一致；独立公式复核 Cronbach's α、KMO 和结果变量 OLS 系数。
- [x] 文档：DOCX 与 PDF 均可解析并逐页渲染；章节、三线表、模型图、调节图、中文字体和页数通过人工视觉检查。
- [x] 错误态：无法识别的自然语言需求或缺少必需题项时返回明确错误，且该失败目录不产生 JSON/DOCX/PDF 伪报告。
- [x] 质量：API 测试、TypeScript/Vite build 通过；完整 test/e2e 仅使用 synthetic 数据，不触达旧问卷。
- [x] 安全：所有运行产物写入 `data/validation/T-20260717-08-synthetic/`；历史 `outputs/` 前后 SHA-256 清单完全一致；测试不写正式 `data/reports/` 或 `data/knowledge/`。
- [x] 可重放：保留一键脚本、机器可读日志、各阶段耗时、产物哈希和历史 outputs 前后哈希对比。

## 验证证据

- 证据根目录：`data/validation/T-20260717-08-synthetic/`。
- 科学重放：`.venv\\Scripts\\python.exe scripts\\verify_sample_analysis.py --evidence-root data\\validation\\T-20260717-08-synthetic\\scientific-main`。
- Electron E2E：设置 `ANALYZER_EVIDENCE_DIR=...\\electron-main-03` 后运行 `npm run test:e2e`。
- 一键回归：`npm run test:delivery`（build → synthetic scientific → synthetic Electron E2E）。
- 结果：`npm test`、`npm run test:e2e`、独立 α/KMO/OLS、5000 次 Bootstrap 重跑、DOCX/PDF 逐页视觉检查均通过。
- 机器摘要：`data/validation/T-20260717-08-synthetic/scientific-main/machine-summary.json`、`data/validation/T-20260717-08-synthetic/electron-main-03/e2e-summary.json`。
- 视觉记录：`data/validation/T-20260717-08-synthetic/scientific-main/rendered/visual-qa.md`。

## 边界

本 issue 只修交付主流程阻断，不做营销页、会员、云端部署、自进化策略或 n8n 扩张；不使用历史客户数据建立基准。

## 已知边界

- 当前是固定 `questionnaire-plan.json` 的 PP/AA/PC/PI/PV 问卷方案自动化，不是任意问卷的通用 AI 变量角色推断。
- 当前源码目录可演示；Electron 安装包配置尚未包含 `.venv`、`services` 与 `examples`，不能把安装包表述为已具备科学报告主流程。
- `documents` 技能自带渲染器在本机 Windows + LibreOffice 26.2 的独立 profile 模式下挂起，本次按技能允许的手动 LibreOffice 转换路径完成逐页视觉验收。
