"""
认证模块 - JWT 账号体系

安全要点：
- bcrypt 密码哈希（不可逆）
- JWT 签名 + 过期验证（24h）
- 所有 SQL 使用参数化查询（database.py 已保证）
- API Key 不在此模块处理，由前端 Header 直接传给 llm
"""

import os
import jwt
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException, Request

from database import create_user, get_user_by_username, get_user_by_id, \
    check_login_locked, record_login_failed, record_login_success
from logger import get_logger
from backend_i18n import t as _t

logger = get_logger("auth")

JWT_SECRET = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 24

# 启动时安全校验：无 JWT_SECRET 或为占位值则自动生成并写入 .env 持久化
_PLACEHOLDER_SECRETS = {"grindpal-dev-secret-change-in-production", "change-me-to-a-random-secret", ""}
_ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

if JWT_SECRET in _PLACEHOLDER_SECRETS:
    import secrets as _secrets
    from logger import get_logger as _get_logger_init
    _log_init = _get_logger_init("auth")
    if JWT_SECRET == "grindpal-dev-secret-change-in-production" or JWT_SECRET == "change-me-to-a-random-secret":
        _log_init.warning("JWT_SECRET 为占位值，已自动生成随机密钥替换。")
    else:
        _log_init.warning("未设置 JWT_SECRET 环境变量，已自动生成随机密钥。")
    JWT_SECRET = _secrets.token_hex(32)
    # 尝试写入 .env 文件持久化，避免重启后全部 token 失效
    try:
        _env_content = ""
        _written = False
        if os.path.exists(_ENV_PATH):
            with open(_ENV_PATH, "r", encoding="utf-8") as _f:
                _env_content = _f.read()
        if "JWT_SECRET=" in _env_content:
            _env_content = os.linesep.join([
                line if not line.startswith("JWT_SECRET=") else f"JWT_SECRET={JWT_SECRET}"
                for line in _env_content.splitlines()
            ])
        else:
            if _env_content and not _env_content.endswith("\n"):
                _env_content += "\n"
            _env_content += f"JWT_SECRET={JWT_SECRET}\n"
        with open(_ENV_PATH, "w", encoding="utf-8") as _f:
            _f.write(_env_content)
        _log_init.info("JWT_SECRET 已写入 .env 持久化。")
    except Exception as _e:
        _log_init.warning(f"无法写入 JWT_SECRET 到 .env: {_e}。重启后所有旧 token 将失效。")


# ---- 密码工具 ----

def hash_password(password: str) -> str:
    """bcrypt 哈希密码"""
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    """验证密码"""
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


# ---- JWT 工具 ----

def create_token(user_id: int, username: str) -> str:
    """签发 JWT"""
    payload = {
        "user_id": user_id,
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """解码验证 JWT，无效则抛异常"""
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


# ---- FastAPI 依赖注入 ----

async def get_current_user(request: Request) -> dict:
    """从 Authorization Header 提取当前用户；无效 token 返回 401"""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail=_t("please_login", request))
    token = auth_header[7:]
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail=_t("login_expired", request))
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail=_t("invalid_token", request))
    user = await get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail=_t("user_not_found", request))
    return user


# ---- 认证路由的请求模型 ----
# (放在这里避免循环导入，也可以单独放 models.py)

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)
    password: str = Field(..., min_length=8, max_length=64)


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class PreferencesRequest(BaseModel):
    preferences: dict = Field(default_factory=dict)

class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., min_length=4, max_length=64)
    new_password: str = Field(..., min_length=8, max_length=64)


# ---- 路由处理器（供 main.py 调用） ----

async def handle_register(req: RegisterRequest, request: Request = None):
    """注册新用户"""
    existing = await get_user_by_username(req.username)
    if existing:
        raise HTTPException(status_code=409, detail=_t("username_taken", request))
    pw_hash = hash_password(req.password)
    user_id = await create_user(req.username, pw_hash)
    if user_id is None:
        raise HTTPException(status_code=500, detail=_t("register_failed", request))
    token = create_token(user_id, req.username)
    logger.info(f"用户注册成功 username={req.username}", extra={"request_id": "-"})
    return {
        "user_id": user_id,
        "username": req.username,
        "token": token,
        "has_security": False,
        "security_question": "",
    }


async def handle_login(req: LoginRequest, request: Request = None):
    """用户登录（含失败锁定）"""
    # 先检查锁定状态
    lock = await check_login_locked(req.username)
    if lock:
        raise HTTPException(
            status_code=423,
            detail=_t("account_locked", request).format(n=lock["remaining_minutes"]),
        )
    user = await get_user_by_username(req.username)
    if not user or not verify_password(req.password, user["password_hash"]):
        # 记录失败
        fail_info = await record_login_failed(req.username)
        remaining = 5 - fail_info["attempts"]
        if fail_info["locked_until"]:
            detail = _t("account_locked", request).format(n=15)
            raise HTTPException(status_code=423, detail=detail)
        if remaining > 0:
            detail = f"{_t('bad_credentials', request)} ({_t('attempts_left', request).format(n=remaining)})"
        else:
            detail = _t("bad_credentials", request)
        raise HTTPException(status_code=401, detail=detail)
    # 登录成功，清零计数
    await record_login_success(req.username)
    token = create_token(user["id"], user["username"])
    logger.info(f"用户登录成功 username={req.username}", extra={"request_id": "-"})
    return {
        "user_id": user["id"],
        "username": user["username"],
        "token": token,
        "preferences": user.get("preferences", "{}"),
        "has_security": bool(user.get("security_question", "")),
        "security_question": user.get("security_question", ""),
    }


async def handle_get_me(user: dict):
    """获取当前用户信息"""
    return {
        "user_id": user["id"],
        "username": user["username"],
        "preferences": user.get("preferences", "{}"),
        "created_at": user.get("created_at", ""),
        "has_security": bool(user.get("security_question", "")),
        "security_question": user.get("security_question", ""),
    }


async def handle_save_preferences(user: dict, req: PreferencesRequest, request: Request = None):
    """保存用户偏好（不存 API Key）"""
    import json
    prefs = req.preferences
    # 强制清除 API Key 字段，防止前端误存
    prefs.pop("api_key", None)
    prefs.pop("apikey", None)
    from database import update_user_preferences
    ok = await update_user_preferences(user["id"], json.dumps(prefs, ensure_ascii=False))
    if not ok:
        raise HTTPException(status_code=500, detail=_t("save_failed", request))
    return {"preferences": prefs}


async def handle_change_password(user: dict, req: ChangePasswordRequest, request: Request = None):
    """修改密码（需验证旧密码）"""
    if not verify_password(req.old_password, user["password_hash"]):
        raise HTTPException(status_code=403, detail=_t("old_password_wrong", request))
    if req.old_password == req.new_password:
        raise HTTPException(status_code=400, detail=_t("password_same", request))
    new_hash = hash_password(req.new_password)
    from database import update_user_password
    ok = await update_user_password(user["id"], new_hash)
    if not ok:
        raise HTTPException(status_code=500, detail=_t("password_change_failed", request))
    logger.info(f"用户密码已修改 username={user['username']}", extra={"request_id": "-"})
    return {"message": _t("password_changed", request)}


async def handle_delete_account(user: dict, request: Request = None):
    """注销账号（删除用户及关联数据）"""
    from database import delete_user
    ok = await delete_user(user["id"])
    if not ok:
        raise HTTPException(status_code=500, detail=_t("delete_failed", request))
    logger.info(f"用户已注销 username={user['username']}", extra={"request_id": "-"})
    return {"message": _t("account_deleted", request)}
