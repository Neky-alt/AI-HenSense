"""
统一 API 返回格式（03 §18）。

成功：{"success": true,  "data": {...}, "error": null}
失败：{"success": false, "data": null,  "error": {"code": "...", "message": "..."}}

Web 和 App 按同一套格式解析，所有接口必须使用这两个函数构造返回值。
"""

from typing import Any


def success(data: Any = None) -> dict:
    return {"success": True, "data": data, "error": None}


def failure(code: str, message: str) -> dict:
    return {"success": False, "data": None, "error": {"code": code, "message": message}}
