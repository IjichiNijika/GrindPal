"""
性能/压力测试
运行: python -m pytest tests/test_perf.py -v
"""
import pytest
import httpx
import asyncio
import time
import uuid

BASE = "http://localhost:8000/api/v1"
pytestmark = pytest.mark.asyncio(loop_scope="function")


async def _register(client):
    u = f"perf_{uuid.uuid4().hex[:6]}"
    r = await client.post("/auth/register", json={"username": u, "password": "test123456"})
    assert r.status_code == 200
    tok = r.json()["data"]["token"]
    client.headers.update({"Authorization": f"Bearer {tok}", "X-Api-Key": "skip", "X-Model": "deepseek-v4-flash"})
    return u


class TestSingleLatency:
    """单接口响应时间基线"""
    async def test_summarize_latency(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
            await _register(c)
            t0 = time.perf_counter()
            r = await c.post("/summarize", json={"text": "测试延迟", "length": "short"})
            t = time.perf_counter() - t0
            assert r.status_code == 200
            assert t < 3.0, f"响应太慢: {t:.2f}s"

    async def test_health_latency(self):
        async with httpx.AsyncClient(base_url=BASE, timeout=5) as c:
            t0 = time.perf_counter()
            r = await c.get("/health")
            t = time.perf_counter() - t0
            assert r.status_code == 200
            assert t < 0.5, f"Health check 太慢: {t:.2f}s"


class TestConcurrency:
    """并发压力测试"""
    @pytest.mark.parametrize("concurrency", [5, 10, 20])
    async def test_concurrent_requests(self, concurrency):
        async def one_request():
            async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
                await _register(c)
                t0 = time.perf_counter()
                r = await c.post("/summarize", json={"text": f"concurrent test", "length": "short"})
                return r.status_code, time.perf_counter() - t0

        tasks = [one_request() for _ in range(concurrency)]
        results = await asyncio.gather(*tasks)
        statuses = [r[0] for r in results]
        times = [r[1] for r in results]

        ok = statuses.count(200)
        errors = len(statuses) - ok
        avg_time = sum(times) / len(times) if times else 0
        max_time = max(times) if times else 0

        print(f"\n并发={concurrency} | 成功={ok} 失败={errors} | 平均={avg_time:.2f}s 最慢={max_time:.2f}s")
        assert errors == 0, f"{errors} 个请求失败"
        assert avg_time < 5.0, f"平均响应太慢: {avg_time:.2f}s"


class TestSustained:
    """持续负载测试"""
    async def test_sustained_30s(self):
        duration = 10  # 秒
        start = time.perf_counter()
        count = [0]
        errors = [0]

        async def worker():
            async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
                while time.perf_counter() - start < duration:
                    try:
                        await _register(c)
                        r = await c.post("/summarize", json={"text": "sustained", "length": "short"})
                        if r.status_code == 200:
                            count[0] += 1
                        else:
                            errors[0] += 1
                    except Exception:
                        errors[0] += 1

        tasks = [worker() for _ in range(3)]
        await asyncio.gather(*tasks)
        elapsed = time.perf_counter() - start
        tps = count[0] / elapsed if elapsed > 0 else 0
        print(f"\n持续{elapsed:.0f}s | 完成={count[0]} | 错误={errors[0]} | TPS={tps:.1f}")
        assert count[0] > 0, "没有成功的请求"
        assert errors[0] < count[0] * 0.3, f"错误率过高: {errors[0]}/{count[0]}"
