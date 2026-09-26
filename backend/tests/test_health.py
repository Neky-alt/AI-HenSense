"""BE-01 验收测试：服务能起来、health 通、返回格式符合 03 §18。"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    resp = client.get("/api/v1/health")
    assert resp.status_code == 200

    body = resp.json()
    assert body["success"] is True
    assert body["error"] is None
    assert body["data"]["status"] == "ok"
    assert body["data"]["database"] == "connected"


def test_health_response_matches_unified_envelope():
    """03 §18：成功返回必须是 success / data / error 三个 key。"""
    body = client.get("/api/v1/health").json()
    assert set(body.keys()) == {"success", "data", "error"}


def test_unknown_route_uses_unified_error_envelope():
    """错误也必须走 03 §18 格式，不能是 FastAPI 默认的 {"detail": ...}。"""
    resp = client.get("/api/v1/this-route-does-not-exist")
    assert resp.status_code == 404

    body = resp.json()
    assert body["success"] is False
    assert body["data"] is None
    assert body["error"]["code"] == "NOT_FOUND"


def test_health_is_under_api_v1_prefix():
    """接口必须挂在 /api/v1 下，根路径不应该有 health。"""
    assert client.get("/health").status_code == 404
