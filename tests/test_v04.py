import pytest, httpx, uuid, json
BASE = "http://localhost:8000/api/v1"
pytestmark = pytest.mark.asyncio
TEST_USER = "permanent_tester"
TEST_PW = "test123456"

async def _login(c):
    r = await c.post("/auth/login", json={"username": TEST_USER, "password": TEST_PW})
    assert r.status_code == 200, f"Login failed {r.status_code}: {r.text}"
    tok = r.json()["data"]["token"]
    c.headers.update({"Authorization": f"Bearer {tok}", "X-Api-Key": "skip", "X-Model": "deepseek-v4-flash"})
    return c

class TestHealth:
    async def test_ok(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            r = await c.get("/health")
            assert r.status_code == 200

class TestAuth:
    async def test_login(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            r = await c.post("/auth/login", json={"username": TEST_USER, "password": TEST_PW})
            assert r.status_code == 200
    async def test_unauthorized(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            for ep in ["/todos", "/templates", "/kb/collections"]:
                assert (await c.get(ep)).status_code == 401

class TestModules:
    async def test_summarize(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            await _login(c)
            r = await c.post("/summarize", json={"text": "天气真好", "length": "short"})
            assert r.status_code == 200
            data = r.json()["data"]
            assert len(data.get("text") or data.get("result") or "") > 0

class TestTemplates:
    async def test_crud(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            await _login(c)
            r = await c.post("/templates", json={"name":"T","modules":["summarize"],"system_prompt":"x","output_style":"bullet"})
            assert r.status_code == 200
            tid = r.json()["data"]["id"]
            assert (await c.delete(f"/templates/{tid}")).status_code == 200

class TestKB:
    async def test_collection(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            await _login(c)
            r = await c.post("/kb/collections", json={"name":"KB"})
            assert r.status_code == 200
            await c.delete(f"/kb/collections/{r.json()['data']['id']}")

class TestExport:
    async def test_docx(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            await _login(c)
            r = await c.post("/export-docx", json={"content":"# Test","title":"x"})
            assert r.status_code == 200
            assert len(await r.aread()) > 100

class TestSecurity:
    async def test_sql(self):
        async with httpx.AsyncClient(base_url=BASE) as c:
            r = await c.post("/auth/login", json={"username":"' OR '1'='1","password":"x"})
            assert r.status_code in (401, 422)
