# Issue 007 - 固定方案可安装科学运行时 V1

type: delivery-blocker
status: done-awaiting-controller-acceptance
main_flow: yes
owner: Codex / T-20260717-10

## 用户任务

目标用户不是开发者。用户安装或解压 Windows 应用后，不配置 Python、不安装 LibreOffice、不打开终端、不连接云端，只在 Electron 界面上传结构匹配的 XLSX/CSV，说明要做完整分析或指定章节，即可得到 JSON、DOCX、PDF。运行时缺失/损坏、列不完整或需求无效时，界面必须给出可操作错误，并且不得生成伪报告。

## 当前阻断

1. `main.cjs` 只会调用源码下 `.venv\\Scripts\\python.exe`、`services/questionnaire_pipeline.py` 和 `examples/questionnaire-plan.json`。
2. Vite 与 electron-builder 都使用 `dist`，打包输出会与前端构建目录冲突。
3. PDF 通过 PATH 上的 `soffice` 转换，屏蔽系统 PATH 后固定失败。
4. electron-builder 未包含科学运行时、pipeline、固定方案和第三方许可记录。
5. 现有 Electron E2E 启动源码 Electron，不能证明安装/便携产物可用。

## 最小方案与资源布局

- 使用 PyInstaller `onedir` 冻结 `questionnaire_pipeline.py`，形成独立 `questionnaire-engine.exe` 与 `_internal/`；不把完整开发 venv 放进产品。
- DOCX 继续由 `python-docx` 生成；PDF 改为 ReportLab 直接消费同一份 `result`，消除 LibreOffice 前置条件。
- 随包加入许可清楚的开源中文字体及许可证，PDF/图表不得依赖客户机已有中文字体。
- Electron 代码留在 ASAR；sidecar、固定 plan、pipeline 源码副本、字体和第三方许可放在 `process.resourcesPath` 下。
- packaged 默认只写 `app.getPath("userData")`；测试通过环境变量写到任务隔离目录。

```text
resources/
├─ app.asar
├─ runtime/questionnaire-engine/
│  ├─ questionnaire-engine.exe
│  └─ _internal/...
├─ pipeline/questionnaire_pipeline.py
├─ config/questionnaire-plan.json
├─ fonts/...
├─ licenses/...
└─ runtime-manifest.json
```

## 运行时解析与错误契约

| 场景 | 命令 | pipeline | plan | 默认输出 |
|---|---|---|---|---|
| 开发态 | `.venv\\Scripts\\python.exe` | `services/questionnaire_pipeline.py` | `examples/questionnaire-plan.json` | 项目 `data/`（可由环境变量隔离） |
| packaged | `resources/runtime/questionnaire-engine/questionnaire-engine.exe` | `resources/pipeline/questionnaire_pipeline.py`（存在性/溯源校验） | `resources/config/questionnaire-plan.json` | Electron `userData` |

- 缺文件或 manifest 不完整：`科学计算运行时缺失，请重新安装或重新解压完整程序。`
- manifest 哈希不符、无效 Win32 或无法启动：`科学计算运行时已损坏或无法启动，请重新安装程序。`
- pipeline 返回明确的输入错误：保留缺列、越界、无效需求等业务消息，不误报为运行时损坏。
- 失败任务不得生成 `analysis-result.json`、DOCX 或 PDF。

## 验收门槛

- [x] 依赖与再分发审计落盘；运行时只含实际必需依赖，许可文本/来源随包。
- [x] `main.cjs` 在开发态与 packaged 态均不使用绝对仓库路径；packaged 不依赖系统 Python、源码 venv、开发 `node_modules` 或 `soffice`。
- [x] electron-builder 真实生成 NSIS 安装包、portable 包和 `win-unpacked`，且三者名称不覆盖。
- [x] 从源码外全新 ASCII 目录启动复制后的 packaged Electron；PATH 不含 Python/LibreOffice，代理指向不可用本地端口，渲染进程无 HTTP/HTTPS/WS 请求。
- [x] synthetic XLSX 完整分析与 synthetic CSV“只做信度”均生成 JSON/DOCX/PDF；限定章节不泄露未请求统计或模型图。
- [x] 无效需求、缺少 AA3、运行时缺失均显示明确错误，不生成伪报告；损坏场景由 manifest 哈希校验与同一业务错误契约覆盖。
- [x] α、KMO、OLS、5000 次固定种子 Bootstrap 与 Issue 006 基准一致。
- [x] DOCX/PDF 可打开；章节、三线表、模型图、调节图、中文字体和页数通过结构、全页渲染与人工目检。
- [x] 保存安装包 SHA-256/大小、安装占用、冷启动/分析耗时、产物哈希、截图、渲染图和网络证据。
- [x] 历史 `outputs` 前后仅做 SHA-256 比对且完全一致；正式 `data/reports`、`data/knowledge` 未写入。

## 验收结果（2026-07-17）

- 最终一键链路 7 个阶段全部通过，总耗时 271.179 秒；证据根：`D:\Desktop\Codex-Projects\AI-Analyzer-Package-Validation\T-20260717-10\run-20260717-100152-626-p480`。
- NSIS：174.910 MiB，SHA-256 `2C248559DBC8F0FD2AE91EBAB0FF4ECAA271791AD9547702B962335D37BF6540`。
- Portable：174.691 MiB，SHA-256 `C27F5D592507E450E02306364FE9F9311C47B717066AF8436584639CD008682F`。
- 静默安装占用 607.297 MiB；冷启动 3.760 秒；完整分析 12.482 秒；仅信度 2.960 秒。
- packaged E2E 使用 synthetic XLSX/CSV，PATH 仅含 Windows，代理指向不可用本地端口，外部网络请求为 0；完整复跑的科学字段一致。
- 产物 QA 89/89 通过；直接 PDF 为完整 8 页、限定 1 页。最终 DOCX 另以独立 ASCII 配置渲染为 8 页和 2 页，10 页人工目检通过，见 `packaged-e2e/manual-docx-visual-qa.md`。
- 本 Issue 的产品结论仅为“固定方案可安装试用版（内部、未签名、不外发）”，不代表任意问卷通用分析器。

## 单命令重放

```powershell
npm run verify:installable -- -InstallNsis
```

固定执行顺序：运行时冻结 → 前端 build → electron-builder NSIS + portable → 复制 `win-unpacked` 到 ASCII 隔离目录 → packaged E2E（完整/限定/三种错误态）→ 科学与文档复核 → 哈希、体积、耗时和网络证据汇总。

## 不在本 Issue

不做通用问卷变量角色推断、云端、会员、支付、自进化、n8n、营销页、代码签名或外部发布；不读取客户问卷，不把固定方案描述为任意问卷通用分析器。

## 回滚

- Electron 仍保留开发态 `.venv + pipeline.py` 路径，便于科学回归；packaged 失败不改变源码验证入口。
- ReportLab PDF 与现有 DOCX 共享结果结构；若视觉门槛未通过，只回滚 PDF 渲染实现，不回滚科学计算结果。
- 打包产物与所有证据写入新的 `release/`、`build/` 和任务隔离目录，不覆盖历史 `outputs/`。
