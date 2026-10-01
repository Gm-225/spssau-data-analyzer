# 源码与发布谱系

## 当前状态（2026-07-31）

- 权威开发源：`D:\本机软件\Desktop\杂物铺\数据分析\分析器`
- 当前源代码版本：`2.1.0`
- 2.1.0 状态：P0 安全收敛已在本地源码通过全量、Electron 与 AMOS synthetic 验证；它仍只是源码候选，尚未打包、安装或对外发布。
- 已有稳定安装/2.0.1 安装包：保持原样，不由本次任务覆盖。
- `release-amos-v1` 等历史发布证据：只读保留，不代表当前 2.1.0 源码。

## 版本规则

- 应用版本来自 `package.json` 与 `package-lock.json`。
- 每个 2.1.0 科学任务的 `job-manifest.json` 记录 `app.version`、引擎 ID/版本、输入/方案/产物 SHA-256。
- 新安装包必须使用新的隔离输出目录，并在打包、安装态 synthetic E2E 和人工验收均通过后才可标为发布；不得覆盖已有稳定安装来代替验收。
- SPSS 与 SmartPLS 当前仍是人工外部流程，不得在发行说明中描述为产品内自动集成。IBM SPSS Amos 仅在用户本机已授权安装且满足固定 PP4/AA3/PC4/PI5/PV4 契约时运行。

## 2.1.0 本地候选证据

- 全量：`data/validation/T-20260717-08-synthetic/scientific-20260731-231406` 与 `data/validation/T-20260731-12-p0-safety/safety-20260731-231427`。
- Electron：`data/validation/T-20260717-08-synthetic/electron-2026-07-31T15-10-10-316Z`。
- AMOS：`data/validation/T-20260717-14-amos/automated-20260731-231543`。
- 发布边界：以上证据不等于安装态验收；稳定 2.0.1 安装未覆盖，未生成 2.1.0 安装包或便携包。
