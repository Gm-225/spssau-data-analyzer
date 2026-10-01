# Issue 001 - 可由 n8n 调用的描述统计主线

type: feature
status: done
main_flow: yes
owner: main

## 用户痛点

当前分析只能在桌面页面中由人工操作，外部流程无法提交任务，结果不会持久化，也无法失败重试。

## 请求

实现最薄的端到端主线：HTTP 提交描述统计任务 → 确定性计算 → SQLite 持久化 → 返回/查询结果，并让现有 UI 可配置为调用该 API。

## 验收标准

- [x] `GET /health` 返回服务状态与 API 版本。
- [x] `POST /v1/analysis-jobs` 接收有效描述统计请求并返回完成任务。
- [x] `GET /v1/analysis-jobs/{id}` 可读回持久化结果。
- [x] 无效 JSON、空数据、未知变量、未知方法返回明确错误。
- [x] 相同输入重复计算得到相同统计结果。
- [x] 设置 API 地址后，现有桌面界面通过 API 获取结果。
- [x] 前端构建、后端测试和 HTTP 冒烟测试通过。
- [x] 验证证据记录在 `docs/VALIDATION.md`。

## 验证证据

- 命令：`python -m unittest discover -s services/analysis_api/tests -v`
- 命令：`npm run build`
- 命令：启动服务后运行 `python scripts/smoke_analysis_api.py`
- 观察：8 项测试通过；Vite 生产构建通过；真实 HTTP 冒烟任务完成并返回可查询任务 ID。

## 备注

本 Issue 通过前不扩展 AI 报告、客户系统或全部统计方法。
