from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Any


class AnalysisInputError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class AnalysisRequest:
    method_id: str
    method_name: str
    headers: list[str]
    rows: list[dict[str, Any]]
    variables: dict[str, list[str]]
    source: str | None = None


def parse_request(payload: Any) -> AnalysisRequest:
    if not isinstance(payload, dict):
        raise AnalysisInputError("INVALID_REQUEST", "请求体必须是 JSON 对象")

    method_id = payload.get("methodId") or payload.get("method")
    if method_id != "descriptive":
        raise AnalysisInputError(
            "UNSUPPORTED_METHOD",
            "自动化 API 首版仅开放 descriptive（描述性分析）",
        )

    data = payload.get("data")
    if not isinstance(data, dict):
        raise AnalysisInputError("INVALID_DATA", "data 必须是包含 headers 和 rows 的对象")

    headers = data.get("headers")
    rows = data.get("rows")
    if not isinstance(headers, list) or not all(isinstance(item, str) and item for item in headers):
        raise AnalysisInputError("INVALID_HEADERS", "data.headers 必须是非空字符串数组")
    if len(headers) != len(set(headers)):
        raise AnalysisInputError("DUPLICATE_HEADERS", "data.headers 不能包含重复列名")
    if not isinstance(rows, list) or not rows:
        raise AnalysisInputError("EMPTY_DATA", "data.rows 至少需要一行数据")
    if not all(isinstance(row, dict) for row in rows):
        raise AnalysisInputError("INVALID_ROWS", "data.rows 中的每一行都必须是对象")

    variables = payload.get("variables")
    if not isinstance(variables, dict):
        raise AnalysisInputError("INVALID_VARIABLES", "variables 必须是对象")
    selected = variables.get("analysis-variables")
    if not isinstance(selected, list) or not selected or not all(isinstance(v, str) for v in selected):
        raise AnalysisInputError(
            "MISSING_VARIABLES",
            "variables.analysis-variables 至少需要一个变量",
        )
    unknown = [name for name in selected if name not in headers]
    if unknown:
        raise AnalysisInputError("UNKNOWN_VARIABLE", f"数据中不存在变量: {', '.join(unknown)}")

    source = payload.get("source")
    if source is not None and not isinstance(source, str):
        raise AnalysisInputError("INVALID_SOURCE", "source 必须是字符串")

    return AnalysisRequest(
        method_id="descriptive",
        method_name="描述性分析",
        headers=headers,
        rows=rows,
        variables={"analysis-variables": selected},
        source=source,
    )


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _format(value: float, decimals: int = 3) -> str:
    return f"{value:.{decimals}f}" if math.isfinite(value) else "-"


def run_descriptive(request: AnalysisRequest) -> dict[str, Any]:
    result_rows: list[list[str | int]] = []

    for variable in request.variables["analysis-variables"]:
        values = sorted(
            number
            for row in request.rows
            if (number := _number(row.get(variable))) is not None
        )
        if not values:
            raise AnalysisInputError(
                "NO_NUMERIC_VALUES",
                f'变量 "{variable}" 没有可用于分析的数值',
            )

        count = len(values)
        mean = statistics.fmean(values)
        median = statistics.median(values)
        standard_deviation = statistics.stdev(values) if count >= 2 else math.nan

        if count >= 2 and standard_deviation > 0:
            skewness = sum(((value - mean) / standard_deviation) ** 3 for value in values) / count
            kurtosis = (
                sum(((value - mean) / standard_deviation) ** 4 for value in values) / count - 3
            )
        else:
            skewness = math.nan
            kurtosis = math.nan

        result_rows.append(
            [
                variable,
                count,
                _format(mean),
                _format(standard_deviation),
                _format(values[0]),
                _format(values[-1]),
                _format(median),
                _format(kurtosis),
                _format(skewness),
            ]
        )

    return {
        "methodId": request.method_id,
        "methodName": request.method_name,
        "tables": [
            {
                "title": "描述统计量",
                "type": "table",
                "headers": [
                    "变量",
                    "样本量",
                    "平均值",
                    "标准差",
                    "最小值",
                    "最大值",
                    "中位数",
                    "峰度",
                    "偏度",
                ],
                "rows": result_rows,
            }
        ],
    }


def run_analysis(request: AnalysisRequest) -> dict[str, Any]:
    if request.method_id == "descriptive":
        return run_descriptive(request)
    raise AnalysisInputError("UNSUPPORTED_METHOD", f"暂不支持方法: {request.method_id}")


def summarize_input(request: AnalysisRequest) -> dict[str, Any]:
    return {
        "headers": request.headers,
        "rowCount": len(request.rows),
        "variables": request.variables,
        "source": request.source,
    }

