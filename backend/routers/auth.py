"""
牛马助手 — 认证与用户管理路由
"""
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field

from auth import (
    get_current_user,
    handle_register, handle_login, handle_get_me,
    handle_save_preferences, handle_change_password, handle_delete_account,
    RegisterRequest, LoginRequest, PreferencesRequest, ChangePasswordRequest,
)
from backend_i18n import t as _t
from logger import get_logger

logger = get_logger("auth")

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# 从 main 注入的共享依赖
_rate_check = None
_success = None
_error = None


def init(rate_check, success_fn, error_fn):
    global _rate_check, _success, _error
    _rate_check = rate_check
    _success = success_fn
    _error = error_fn


@router.post("/register")
async def auth_register(req: RegisterRequest, request: Request):
    await _rate_check(0, request.client.host)
    data = await handle_register(req, request)
    return _success(data, "register_ok", request)


@router.post("/login")
async def auth_login(req: LoginRequest, request: Request):
    await _rate_check(0, request.client.host)
    data = await handle_login(req, request)
    return _success(data, "login_ok", request)


@router.get("/me")
async def auth_me(user: dict = Depends(get_current_user)):
    data = await handle_get_me(user)
    return _success(data)


@router.put("/preferences")
async def save_preferences(req: PreferencesRequest, request: Request, user: dict = Depends(get_current_user)):
    data = await handle_save_preferences(user, req, request)
    return _success(data, "prefs_saved", request)


@router.put("/password")
async def change_password(req: ChangePasswordRequest, request: Request, user: dict = Depends(get_current_user)):
    data = await handle_change_password(user, req, request)
    return _success(data, "password_changed", request)


@router.delete("/account")
async def delete_account(request: Request, user: dict = Depends(get_current_user)):
    data = await handle_delete_account(user, request)
    return _success(data, "account_deleted", request)


# ---- 密保问题与忘记密码 ----

class SetSecurityRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=200)
    answer: str = Field(..., min_length=2, max_length=200)


@router.put("/security")
async def set_security(req: SetSecurityRequest, request: Request, user: dict = Depends(get_current_user)):
    from database import set_security_question
    try:
        import bcrypt as _bcrypt
        answer_hash = _bcrypt.hashpw(req.answer.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")
        ok = await set_security_question(user["id"], req.question.strip(), answer_hash)
        if not ok:
            return _error(500, _t("security_set_failed", request))
        return _success(None, "security_set", request)
    except Exception as e:
        logger.error(f"set_security 失败: {e}", exc_info=True)
        return _error(500, _t("security_set_failed", request))


@router.post("/forgot-question")
async def forgot_question(request: Request):
    await _rate_check(0, request.client.host)
    try:
        body = await request.json()
    except Exception:
        return _error(400, _t("bad_request", request))
    username = str(body.get("username", "")).strip()
    if not username:
        return _error(400, _t("username_required", request))
    from database import get_security_question
    question = await get_security_question(username)
    if not question:
        return _error(404, _t("no_security_question", request))
    return _success({"question": question})


class ResetPasswordRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)
    answer: str = Field(..., min_length=2, max_length=200)
    new_password: str = Field(..., min_length=8, max_length=64)


class VerifySecurityRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32)
    answer: str = Field(..., min_length=2, max_length=200)


@router.post("/verify-security")
async def verify_security(req: VerifySecurityRequest, request: Request):
    await _rate_check(0, request.client.host)
    from database import verify_security_answer
    ok = await verify_security_answer(req.username, req.answer)
    if not ok:
        return _error(403, _t("security_answer_wrong", request))
    return _success(None, "success")


@router.post("/reset-password")
async def reset_password(req: ResetPasswordRequest, request: Request):
    from auth import hash_password
    await _rate_check(0, request.client.host)
    from database import get_security_question, verify_security_answer, reset_password as db_reset
    question = await get_security_question(req.username)
    if not question:
        return _error(404, _t("no_security_question", request))
    ok = await verify_security_answer(req.username, req.answer)
    if not ok:
        return _error(403, _t("security_answer_wrong", request))
    new_hash = hash_password(req.new_password)
    ok = await db_reset(req.username, new_hash)
    if not ok:
        return _error(500, _t("reset_failed", request))
    return _success(None, "reset_ok", request)
