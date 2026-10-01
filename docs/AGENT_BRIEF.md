# Agent Brief

Created: 2026-07-12
Idea: 将现有桌面数据分析器升级为可由 n8n 调用、可持久化、可验证并逐步接入 AI 的自动化数据分析服务

## Coordinator Rule

The main Codex thread owns product judgment, integration, and final verification.

## When To Add Agents

Add agents only when the task is parallel, bounded, and has a clear output.

## Candidate Agents

| Role | Use When | Output |
| --- | --- | --- |
| Product Mapper | Main flow or success criteria are fuzzy | Revised spec and risks |
| API Scout | Custom build may be avoidable | API/library options and recommendation |
| Builder | Work can be split by file/module | Patch plus changed paths |
| QA Agent | Main path needs independent verification | Commands, screenshots, failures |
| Reviewer | Risk of regression or bad architecture | Findings with file/line references |

## Delegation Prompt

```text
You are the <role>. Task: <bounded task>.
Context: <minimum needed context>.
Ownership: <files/modules or read-only scope>.
Output: <specific artifact or answer>.
Constraints: You are not alone in the codebase. Do not revert others' edits. Work with existing changes.
```
