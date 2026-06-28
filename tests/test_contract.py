"""
牛马助手 v1.0 — 契约/接口测试
验证每个 API 端点的请求/响应格式、状态码、错误码
运行: python -m pytest tests/test_contract.py -v
"""
import pytest
import httpx
import uuid
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

BASE = "http://localhost:8000/api/v1"
pytestmark = pytest.mark.asyncio(loop_scope="function")


async def _reg(client, prefix="ct"):
    u = f"{prefix}_{uuid.uuid4().hex[:6]}"
    r = await client.post("/auth/register", json={"username": u, "password": "test123456"})
    assert r.status_code == 200
    tok = r.json()["data"]["token"]
    client.headers.update({
        "Authorization": f"Bearer {tok}",
        "X-Api-Key": "skip",
        "X-Model": "deepseek-v4-flash",
    })
    return u, tok


def _assert_success(resp):
    """验证标准成功响应格式: {code:200, data:..., message:...}"""
    body = resp.json()
    assert body["code"] == 200, f"Expected code=200, got {body}"
    assert "data" in body
    assert "message" in body


def _assert_error(resp, expected_code):
    """验证标准错误响应格式 — 兼容 FastAPI 原生 {"detail":"..."} 和自定义 {"code":...,"message":...}"""
    assert resp.status_code == expected_code, f"Expected status {expected_code}, got {resp.status_code}"
    body = resp.json()
    # FastAPI 原生 HTTPException 返回 {"detail": "..."}
    if "code" in body:
        assert body["code"] == expected_code, f"Expected code={expected_code}, got {body['code']}"
        assert body["data"] is None
        assert "message" in body
    else:
        assert "detail" in body, f"Expected 'detail' in error response: {body}"


# ═══ 认证端点 ═══
class TestAuthContracts:
    async def test_register_response_format(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            u = f"ctreg_{uuid.uuid4().hex[:6]}"
            r = await c.post("/auth/register",
                            json={"username": u, "password": "test123456"})
            _assert_success(r)
            data = r.json()["data"]
            assert "token" in data
            assert "user_id" in data
            assert "username" in data

    async def test_login_response_format(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            u = f"ctlog_{uuid.uuid4().hex[:6]}"
            await c.post("/auth/register",
                        json={"username": u, "password": "test123456"})
            r = await c.post("/auth/login",
                            json={"username": u, "password": "test123456"})
            _assert_success(r)
            data = r.json()["data"]
            assert "token" in data
            assert "username" in data

    async def test_login_wrong_password_401(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            u = f"ctbad_{uuid.uuid4().hex[:6]}"
            await c.post("/auth/register",
                        json={"username": u, "password": "test123456"})
            r = await c.post("/auth/login",
                            json={"username": u, "password": "wrong"})
            _assert_error(r, 401)

    async def test_me_requires_auth_401(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            r = await c.get("/auth/me")
            _assert_error(r, 401)

    async def test_register_duplicate_409(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            u = f"ctdup_{uuid.uuid4().hex[:6]}"
            await c.post("/auth/register",
                        json={"username": u, "password": "test123456"})
            r = await c.post("/auth/register",
                            json={"username": u, "password": "test123456"})
            _assert_error(r, 409)

    async def test_register_short_password_422(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            r = await c.post("/auth/register",
                            json={"username": "u1", "password": "12"})
            assert r.status_code == 422


# ═══ 功能端点契约 ═══
class TestFeatureContracts:
    async def test_summarize_success(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c)
            r = await c.post("/summarize",
                            json={"text": "今天天气很好", "length": "short"})
            _assert_success(r)
            assert "result" in r.json()["data"]

    async def test_write_email_missing_fields_422(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c)
            r = await c.post("/write-email", json={})
            assert r.status_code == 422

    async def test_features_require_auth(self):
        endpoints = [
            ("POST", "/summarize", {"text": "x", "length": "short"}),
            ("POST", "/write-email", {"recipient": "x", "subject_keywords": "x"}),
            ("POST", "/meeting-minutes", {"transcript": "x"}),
            ("POST", "/polish-report", {"draft": "x"}),
            ("POST", "/report-ese", {"rant": "x"}),
        ]
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            for method, path, body in endpoints:
                r = await c.post(path, json=body)
                assert r.status_code == 401, f"{method} {path} 应该返回 401，实际 {r.status_code}"


# ═══ 聊天端点契约 ═══
class TestChatContracts:
    async def test_conversation_create_response_format(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c)
            r = await c.post("/chat/conversations", json={"title": "契约测试"})
            _assert_success(r)
            assert "id" in r.json()["data"]

    async def test_conversation_not_found_404(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c)
            r = await c.get("/chat/conversations/99999")
            _assert_error(r, 404)

    async def test_chat_messages_requires_auth(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            r = await c.get("/chat/conversations/1/messages")
            assert r.status_code == 401

    async def test_chat_completions_missing_fields_422(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c)
            r = await c.post("/chat/completions", json={})
            assert r.status_code == 422


# ═══ 偏好与 API Key 端点 ═══
class TestPreferencesContracts:
    async def test_save_and_get_api_key(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c, "api_key_ct")
            # 保存加密 key
            r = await c.put("/preferences/api-key",
                           json={"encrypted_key": "test_enc_abc123"})
            _assert_success(r)

            # 读取
            r = await c.get("/preferences/api-key")
            _assert_success(r)
            assert r.json()["data"]["encrypted_key"] == "test_enc_abc123"

    async def test_save_api_key_empty_400(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c, "api_key_empty")
            r = await c.put("/preferences/api-key",
                           json={"encrypted_key": ""})
            _assert_error(r, 400)


# ═══ 导出端点 ═══
class TestExportContracts:
    async def test_export_docx(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=15.0) as c:
            await _reg(c, "export_ct")
            r = await c.post("/export-docx", json={
                "content": "# Hello\n\nWorld",
                "title": "test-export"
            })
            assert r.status_code == 200
            # 应该是 docx 二进制
            assert "application/" in r.headers.get("content-type", "")


# ═══ 健康检查（公开端点） ═══
class TestHealthContract:
    async def test_health_no_auth(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            r = await c.get("/health")
            _assert_success(r)
            assert r.json()["data"]["status"] == "ok"
            assert "version" in r.json()["data"]


# ═══ 模板端点 ═══
class TestTemplateContracts:
    async def test_template_crud(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c, "tpl_ct")
            # 创建
            r = await c.post("/templates", json={
                "name": "测试模板",
                "modules": ["summarize"],
                "system_prompt": "测试"
            })
            _assert_success(r)
            tid = r.json()["data"]["id"]

            # 列表
            r = await c.get("/templates")
            _assert_success(r)

            # 更新
            r = await c.put(f"/templates/{tid}", json={"name": "已更新"})
            _assert_success(r)

            # 删除
            r = await c.delete(f"/templates/{tid}")
            _assert_success(r)

    async def test_template_name_required_400(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10.0) as c:
            await _reg(c, "tpl_bad")
            r = await c.post("/templates", json={"name": ""})
            _assert_error(r, 400)
