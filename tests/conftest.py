"""共享 fixtures"""
import pytest
import httpx
import uuid

BASE_URL = "http://localhost:8000/api/v1"


@pytest.fixture(scope="function")
async def client():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=10.0) as c:
        yield c


@pytest.fixture(scope="function")
async def auth_client(client):
    """已注册并登录的客户端"""
    username = f"test_{uuid.uuid4().hex[:8]}"
    r = await client.post("/auth/register", json={
        "username": username, "password": "test123456"
    })
    assert r.status_code == 200, f"注册失败: {r.text}"
    token = r.json()["data"]["token"]
    client.headers.update({
        "Authorization": f"Bearer {token}",
        "X-Api-Key": "skip",
        "X-Model": "deepseek-v4-flash",
    })
    return client, username, token
