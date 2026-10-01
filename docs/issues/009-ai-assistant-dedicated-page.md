# Issue 009 — AI 分析助手独立页面

Status: verified  
Owner: Codex  
Task: T-20260717-12

## 用户任务

用户上传数据后，在独立的 AI 分析页面描述需求、检查自动识别结果并点击“一键分析”。手动方法选择放在单独页面，长变量名不会被 AI 助手区域挤压或遮挡。

## 根因

原 `AnalysisPage` 在一行内放置两个固定 224px 侧栏和 AI 助手卡片。Electron 最小宽度为 900px，扣除侧栏后右区空间不足；长说明、固定按钮宽度和缺少 `min-w-0/overflow-hidden` 共同造成横向溢出与裁切。

## 实现边界

- `analysis` 页面语义保持为默认数据分析入口，改为独立 AI 助手页。
- 新增 `manual` 页面承载旧手动分析工作台。
- 不修改科学计算、报告模板、运行时或客户数据。
- 保留现有 packaged E2E 的关键可访问文本。

## 验收门槛

- AI 页无方法栏/变量栏，需求框、自动识别、模型分配和一键分析完整可用。
- 手动页变量名在栏内截断且保留 `title` 全文提示。
- 900×600、1280×860、1440×900 的 `documentElement.scrollWidth <= innerWidth + 1`。
- 上传 → AI 分析、结果 → 数据分析回流不增加步骤。
- Web build 与 Issue 008 的 NSIS/Portable 完整矩阵通过。

## 重放

```powershell
npm run build
npm run verify:installable
```

## 实现结果

- `analysis` 路由改为独立 `AiAssistantPage`，仅展示需求输入、自动识别、模型分配和“一键分析”。
- 新增 `manual` 路由与“手动分析”导航，原分析方法、变量列表和变量分配能力保留。
- 手动页变量列增加宽度约束、`min-w-0`、溢出隐藏、ellipsis 与 `title` 全文提示；长题目不再侵入右侧内容。
- 修复连续成功/失败提示的定时器竞争，错误提示不会被上一条成功提示提前清除。

## 验证证据

- Web build、API 8/8、源码 E2E 均通过。
- 源码 UI 证据：`data\validation\T-20260717-08-synthetic\electron-2026-07-17T12-30-34-775Z`；900px 视口无横向溢出，长变量名 `clientWidth=156`、`scrollWidth=368`、`textOverflow=ellipsis`。
- 最终 packaged 证据：`D:\Desktop\Codex-Projects\AIAV\T10\r8-20260717-123106-p28908`；NSIS 与 Portable 主流程、限定范围和错误态全部通过。
- 最小窗口截图：`nsis-e2e\screenshots\00-ai-assistant-900x600.png`、`nsis-e2e\screenshots\00-manual-analysis-900x600.png`，未见助手遮挡、长标题越界或横向滚动。
- 历史 `outputs` 前后逐字节一致；仅使用 synthetic 数据。
