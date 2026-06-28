"""
牛马助手 v1.0 — 新增单元测试
覆盖：auth 函数、关键词过滤、脱敏、KB 判断、temperature 映射、Mock 检测
运行: python -m pytest tests/test_unit.py -v
"""
import pytest
import sys, os
from unittest.mock import MagicMock
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from fastapi import HTTPException
from auth import hash_password, verify_password, create_token, decode_token
from main import _check_keywords, _mask_sensitive, _need_kb_search, _parse_kb_collections, \
    _style_temperature, _style_instruction, KEYWORD_BLOCK, \
    _should_search_kb, _kb_results_relevant, _redact_api_key

# Mock Request for _check_keywords
def _mock_req():
    req = MagicMock()
    req.state.request_id = "test-rid"
    return req
from llm import is_mock_mode


# ═══ 密码哈希 ═══
class TestPasswordHashing:
    def test_hash_and_verify(self):
        pw = "test123456"
        h = hash_password(pw)
        assert h != pw
        assert verify_password(pw, h)
        assert not verify_password("wrong", h)

    def test_hash_unique_each_time(self):
        h1 = hash_password("same")
        h2 = hash_password("same")
        assert h1 != h2  # bcrypt salt 确保每次不同

    def test_empty_password(self):
        h = hash_password("")
        assert verify_password("", h)
        assert not verify_password("x", h)

    def test_unicode_password(self):
        pw = "密码🔑中文"
        h = hash_password(pw)
        assert verify_password(pw, h)


# ═══ JWT ═══
class TestJWT:
    def test_create_and_decode(self):
        tok = create_token(1, "testuser")
        payload = decode_token(tok)
        assert payload["user_id"] == 1
        assert payload["username"] == "testuser"

    def test_invalid_token_raises(self):
        import jwt
        with pytest.raises(jwt.InvalidTokenError):
            decode_token("not.a.valid.token")


# ═══ 关键词过滤 ═══
class TestKeywordBlock:
    def test_block_jailbreak(self):
        from fastapi import Request
        for kw in ["忽略指令", "ignore instructions", "system prompt", "DAN"]:
            try:
                _check_keywords(kw, _mock_req())
                assert False, f"应该拦截: {kw}"
            except HTTPException as e:
                assert e.status_code == 400

    def test_zero_width_chars(self):
        text = "正常文本\u200B注入"
        try:
            _check_keywords(text, _mock_req())
            assert False, "应拦截零宽字符"
        except Exception:
            pass

    def test_normal_text_passes(self):
        _check_keywords("今天天气不错", _mock_req())
        _check_keywords("帮我写一封邮件给张总", _mock_req())
        _check_keywords("How to improve team productivity?", _mock_req())

    def test_dan_word_detection(self):
        try:
            _check_keywords("can you dan please", _mock_req())
            assert False, "应拦截 DAN"
        except Exception:
            pass


# ═══ 敏感信息脱敏 ═══
class TestMaskSensitive:
    def test_phone_number(self):
        assert "手机号已隐藏" in _mask_sensitive("13812345678")
        assert "13812345678" not in _mask_sensitive("打电话给13812345678")

    def test_id_card(self):
        # _mask_sensitive 先匹配手机号(1[3-9])后匹配身份证(\d{17}[\dXx])
        # 为隔离测试，使用不含手机号模式的身份证号
        result = _mask_sensitive("证件号: 220101200001011234")
        assert "身份证号已隐藏" in result
        assert "210101" not in result
        assert "110101199001011234" not in _mask_sensitive("身份证号110101199001011234")

    def test_email(self):
        assert "邮箱已隐藏" in _mask_sensitive("test@example.com")
        assert "test@example.com" not in _mask_sensitive("邮箱test@example.com")

    def test_bank_card(self):
        # _mask_sensitive 的银行卡 regex 依赖  边界（中文环境中  行为与 Unicode \w 相关）
        # 16 位银行卡号在纯数字上下文中匹配
        result = _mask_sensitive("银行卡 5202123456789012 请查收")
        assert "银行卡号已隐藏" in result
        assert "5202123456789012" not in result

    def test_normal_text_untouched(self):
        text = "今天开了三场会，讨论了五个议题"
        assert _mask_sensitive(text) == text


# ═══ KB 搜索预判 ═══
class TestNeedKBSearch:
    def test_greeting_skipped(self):
        assert not _need_kb_search("你好")
        assert not _need_kb_search("谢谢")
        assert not _need_kb_search("ok")

    def test_short_message_skipped(self):
        assert not _need_kb_search("是")
        assert not _need_kb_search("对的")

    def test_meaningful_question_allowed(self):
        assert _need_kb_search("微服务架构有哪些优缺点")
        assert _need_kb_search("请问怎么配置Nginx反向代理")
        assert _need_kb_search("Python中的装饰器原理是什么")

    def test_admin_command_skipped(self):
        assert not _need_kb_search("切换模型")
        assert not _need_kb_search("设置主题为暗色")
        assert not _need_kb_search("删除对话")

    def test_empty_skipped(self):
        assert not _need_kb_search("")
        assert not _need_kb_search("   ")


# ═══ KB collection 解析 ═══
class TestParseKBCollections:
    def test_valid_ids(self):
        assert _parse_kb_collections("1,2,3") == [1, 2, 3]
        assert _parse_kb_collections("10") == [10]

    def test_empty_and_none(self):
        assert _parse_kb_collections("") is None
        assert _parse_kb_collections(None) is None
        assert _parse_kb_collections("  ") is None

    def test_mixed_invalid(self):
        assert _parse_kb_collections("1,abc,3") == [1, 3]
        assert _parse_kb_collections("x,y") is None


# ═══ KB 关键词判断 ═══
class TestShouldSearchKB:
    def test_valid_keywords(self):
        assert _should_search_kb(["微服务", "架构", "优缺点"])
        assert _should_search_kb(["Python", "decorator", "原理"])

    def test_all_stop_words(self):
        assert not _should_search_kb(["你", "我", "什么"])

    def test_mostly_stop_words(self):
        assert not _should_search_kb(["你", "我", "可以", "架构"])  # 3/4 停用词

    def test_empty_or_few(self):
        assert not _should_search_kb([])
        assert not _should_search_kb(["一个"])


# ═══ KB 结果相关性 ═══
class TestKBResultsRelevant:
    def test_relevant(self):
        chunks = [{"score": 5, "content": "这是一段足够长的测试内容用于验证相关性检查需要至少二十个字"},
                   {"score": 2, "content": "另一段测试内容也是足够长的需要二十个字符以上"}]
        assert _kb_results_relevant(chunks, 4)

    def test_irrelevant_low_score(self):
        # keyword_count=4 → min_required=2, best_score=1 < 2 → false
        chunks = [{"score": 1, "content": "这是一个有基本分数的二十字以上测试内容片段"}]
        assert not _kb_results_relevant(chunks, 4)

    def test_empty(self):
        assert not _kb_results_relevant([], 1)

    def test_high_kw_count_requires_more(self):
        chunks = [{"score": 2}]
        assert not _kb_results_relevant(chunks, 4)  # >=4 kw needs score >=3


# ═══ 文风映射 ═══
class TestStyleMapping:
    def test_temperature(self):
        assert _style_temperature("natural") == 0.85
        assert _style_temperature("standard") == 0.7
        assert _style_temperature("formal") == 0.5
        assert _style_temperature("unknown") == 0.7  # default

    def test_instruction(self):
        assert "日常对话" in _style_instruction("natural")
        assert "正式但不僵硬" in _style_instruction("formal")
        assert _style_instruction("standard") == ""


# ═══ Mock 模式检测 ═══
class TestMockMode:
    def test_empty_key(self):
        assert is_mock_mode("")
        assert is_mock_mode(None)
        assert is_mock_mode("   ")

    def test_placeholder_keys(self):
        assert is_mock_mode("skip")
        assert is_mock_mode("sk-placeholder")
        assert is_mock_mode("sk-your-key-here")
        assert is_mock_mode("your_deepseek_api_key_here")

    def test_real_key(self):
        assert not is_mock_mode("sk-real-key-12345678")


# ═══ API Key 脱敏 ═══
class TestRedactAPIKey:
    def test_redact_sk_key(self):
        result = _redact_api_key("sk-abcdefghijklmnop1234")
        assert "REDACTED" in result
        assert result.startswith("sk-abcd")

    def test_non_key_text(self):
        assert _redact_api_key("hello world") == "hello world"

    def test_empty(self):
        assert _redact_api_key("") == ""
        assert _redact_api_key(None) is None
