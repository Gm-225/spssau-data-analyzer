# Issue 016 - P0 安全边界、计划确认与结果追溯

type: risk
status: done
main_flow: yes
user_pain: 手动工作台会运行尚未验证甚至含固定演示值的方法；通用问卷会自动猜量表、反向题和人口学字段；桌面主线长期保留完整输入且报告无法绑定到唯一版本。
owner: Codex / T-20260731-12

## Product Job

操作者上传问卷后，先复核并确认本次分析方案，再由可信科学管线生成报告。产品必须阻断未验证方法、明显错误输入和未确认方案；原始答卷默认不长期保留，同时生成不含原始行的任务追溯清单。

## Acceptance Criteria

### Functional

- [x] 手动工作台清晰区分“可预览”和“尚未进入可信主线”；高风险方法不可执行。
- [x] AI 一键分析展示维度、题项、量表范围、反向题、人口学字段和模型摘要。
- [x] 提示词、数据或方案发生变化后必须重新确认，未确认时“一键分析”不可执行。

### Data and Science

- [x] 通用方案不再从异常观测值自动扩大合法量表范围，默认 1–5 且可人工调整。
- [x] 反向题必须属于对应维度；非数值题项和越界值明确拒绝。
- [x] 相关、主成分结构检查和回归在有效样本不足时明确拒绝，不输出 NaN/Infinity 伪结果。
- [x] 人口学字段默认不进入报告，只有操作者主动选择的字段才进入频数表。

### Privacy and Provenance

- [x] 临时 `input.json` 成功或失败后默认删除；仅 `ANALYZER_RETAIN_INPUT=1` 时保留。
- [x] 案例记忆默认关闭；仅 `ANALYZER_ENABLE_CASE_MEMORY=1` 时写入。
- [x] `job-manifest.json` 至少包含 jobId、状态、应用版本、输入哈希、方案哈希、行列数、原始输入是否保留及产物哈希。
- [x] 历史输入和输出不在本 Issue 中删除。

### Quality and UI

- [x] `npm run test:api`、`npm run test:scientific`、`npm run test:v2`、`npm run test:safety`、`npm run build` 通过。
- [x] Electron E2E 覆盖未确认阻断、确认后运行、受限手动方法、manifest/输入留存、异常退出恢复及历史 sentinel 不变。
- [x] 900×600 与 1280×860 下确认区无横向溢出或按钮遮挡。

### Safety

- [x] 只使用 synthetic 样例；历史 `outputs` 前后哈希一致，正式 `data/reports` 未产生新文件或新时间戳。
- [x] 不安装依赖、不覆盖稳定安装、不发布、不外发。

## Verification Evidence

- `npm test`：2026-07-31 23:14 通过；API 8/8、固定科学基准、V2 通用基准、P0 safety 9/9、TypeScript/Vite 构建全部通过。
- `npm run test:e2e`：通过；证据 `data/validation/T-20260717-08-synthetic/electron-2026-07-31T15-10-10-316Z`。覆盖 900×600、1280×860、1440×900，三种成功主线、越界失败、方案重新锁定、手动 CFA 阻断、内容级产物门、manifest 哈希与磁盘产物集合一致。
- 异常恢复：同一 E2E 预置新版 running/ephemeral UUID 任务，启动后 `INTERRUPTED`、输入/staging/8 类未完成产物均删除；同版缺 marker 与旧版有 marker 两类 sentinel 逐字节不变。
- 科学证据：`data/validation/T-20260717-08-synthetic/scientific-20260731-231406`；P0 边界证据：`data/validation/T-20260731-12-p0-safety/safety-20260731-231427`。
- `npm run test:amos`：通过；证据 `data/validation/T-20260717-14-amos/automated-20260731-231543`，8 个 synthetic 用例通过，未捆绑 IBM 二进制。
- 历史保护：`outputs` 仍为 3 文件/910012 字节，原聚合 SHA-256 `C8C0B92730243890283B0FB9D956BEBABB31592F74B1E7593B9079C5A4B82EFF`；`data/reports` 仍为 30 文件/6223047 字节，最新时间戳仍为 2026-07-14。
- 独立只读复核：结论“无阻断 P0”；复核者未修改文件。

## Non-goals

- 不实现 Issue 013–015 的新统计能力。
- 不迁移工程、不清理历史客户文件、不修改稳定安装目录。
- 不以更多 UI 或营销功能替代科学与隐私门槛。
