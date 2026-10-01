# Issue 015 - 通用 CFA/SEM 与 SmartPLS 适配层

type: research
status: inbox
main_flow: no
user_pain: V2 模板要求 AMOS 与 SmartPLS，但第三方软件模型、许可和自动化边界不同，当前不能统一为可信无人值守能力。
owner: main

## Acceptance Criteria

- [ ] 明确本机 Amos、独立开源 SEM、SmartPLS 原生文件/导出的三种边界和统一结果契约。
- [ ] 通用 CFA/SEM 先实现模型确认、识别、收敛、拟合度、载荷、CR/AVE 和区分效度错误态。
- [ ] SmartPLS 只有在稳定且许可允许的接口存在时才自动运行；否则提供可复核导入包与原生结果回填流程。
- [ ] 报告记录引擎名、版本、估计器、Bootstrap 设置和数据处理说明。
- [ ] 不输出固定拟合值，不冒充 IBM Amos 或 SmartPLS 原生结果。

## Verification Evidence

- Command/check: pending research and scientific benchmark
- Expected: engine-specific contract and reproducible fixture
- Observed: pending

