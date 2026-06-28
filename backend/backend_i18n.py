"""
后端国际化 — 根据 Accept-Language 请求头返回对应语言的消息
"""
from fastapi import Request

MESSAGES = {
    "zh": {
        # 通用
        "success": "success",
        "internal_error": "服务内部错误，请稍后重试",
        "bad_request": "请求格式错误",
        "rate_limit": "请求过于频繁，请稍后再试",
        "blocked_content": "此内容超出本工具处理范围，请重新输入合规内容。",
        "ai_error": "牛马累瘫了，请稍后重试",
        # 对话
        "conversation_not_found": "对话不存在",
        "message_not_found": "消息不存在",
        "message_deleted": "消息已删除",
        "no_message_to_delete": "没有可删除的消息",
        # 文件
        "file_too_large": "文件过大（{size}MB），最大支持 {max}MB",
        "file_missing": "未收到文件",
        "file_upload_hint": "请使用 multipart/form-data 上传文件",
        "file_parse_failed": "文件解析失败",
        "file_format_unsupported": "不支持的文件格式: {name}，请上传 .txt .md .docx",
        "docx_need_install": "Docx 解析需要安装 python-docx。请在服务器执行: pip install python-docx",
        # 音频
        "audio_no_file": "未收到音频文件",
        "audio_convert_failed": "音频转换失败: …{detail}",
        "transcribe_failed": "转写失败",
        "correct_failed": "纠错失败",
        "correct_no_text": "请提供待纠错的文本",
        "correct_json": "请求格式错误，需要JSON",
        # 认证
        "please_login": "请先登录",
        "login_expired": "登录已过期，请重新登录",
        "invalid_token": "无效的登录凭证",
        "invalid_report_type": "无效的周报类型，可选: research, project, techsurvey, ops",
        "user_not_found": "用户不存在",
        "register_ok": "注册成功",
        "login_ok": "登录成功",
        "register_failed": "注册失败，请重试",
        "username_taken": "用户名已被占用",
        "username_required": "请输入用户名",
        "bad_credentials": "用户名或密码错误",
        "account_locked": "账户已锁定，请 {n} 分钟后重试",
        "attempts_left": "还剩 {n} 次尝试",
        "prefs_saved": "偏好已保存",
        "save_failed": "保存失败",
        "password_changed": "密码修改成功",
        "password_change_failed": "密码修改失败",
        "old_password_wrong": "旧密码错误",
        "password_same": "新密码不能与旧密码相同",
        "account_deleted": "账号已注销",
        "delete_failed": "注销失败",
        "security_set": "密保已设置",
        "security_set_failed": "设置失败",
        "no_security_question": "该用户未设置密保问题",
        "security_not_set": "密保未设置",
        "security_answer_wrong": "密保答案错误",
        "reset_failed": "重置失败",
        "reset_ok": "密码已重置，请登录",
        # 模板
        "template_not_found": "模板不存在",
        "template_not_found_or_denied": "模板不存在或无权修改",
        "template_delete_denied": "模板不存在或无权删除",
        "template_create_failed": "模板创建失败",
        "template_update_failed": "模板更新失败",
        "template_name_required": "模板名称不能为空",
        "template_created": "模板已创建",
        "template_updated": "已更新",
        "template_deleted": "已删除",
        "template_sample_required": "请提供输出样例",
        "template_text_required": "请提供文本内容",
        # 知识库
        "kb_name_required": "名称不能为空",
        "kb_created": "知识库已创建",
        "kb_create_failed": "创建失败",
        "kb_not_found": "知识库不存在",
        "kb_deleted": "已删除",
        "kb_file_missing": "缺少文件或 collection_id",
        "kb_file_too_large": "文件过大（{size}MB），最大支持 200MB",
        "kb_pdf_need_install": "需要 pip install PyPDF2",
        "kb_pdf_too_many": "PDF 页数过多（{pages}页），最多支持 50 页",
        "kb_file_unsupported": "不支持的文件格式: {name}",
        "kb_file_no_text": "文件中没有可提取的文本",
        "doc_uploaded": "文档已上传",
        "doc_not_found": "文档不存在",
        "text_saved": "已保存",
        "text_save_failed": "保存失败",
        "text_empty": "文本内容为空",
        "search_query_required": "请输入查询关键词",
        # 待办
        "todo_content_required": "任务内容不能为空",
        "todo_input_required": "请输入待办内容",
        "todo_created": "已创建",
        "todo_updated": "已更新",
        "todo_deleted": "已删除",
        "todo_not_found": "待办不存在",
        "todo_status_invalid": "状态值无效",
        # 历史/追问
        "record_not_found": "记录不存在",
        "record_not_found_or_denied": "记录不存在或无权删除",
        "record_deleted": "删除成功",
        "record_need_params": "请提供 record_id 和 instruction",
        # AI 功能
        "ai_format_error": "AI 返回格式有误",
        "ai_format_error_mock": "AI 返回格式有误，请确保已配置有效的 API Key（Mock 模式下此功能受限）",
        "api_key_required": "请先在设置中配置 API Key",
        "balance_query_failed": "余额查询失败：{detail}",
        "extract_template_failed": "风格提炼失败，请稍后重试",
        "extract_todos_failed": "待办提取失败，请稍后重试",
        "parse_todo_failed": "待办解析失败，请稍后重试",
        "continue_failed": "对话失败，请稍后重试",
        "search_failed": "检索失败，请稍后重试",
        "generate_failed": "生成失败，请稍后重试",
        "model_load_failed": "模型加载失败，请检查依赖安装",
        # PPT
        "pptx_need_install": "需要 pip install python-pptx",
        "outline_not_found": "大纲记录不存在",
        "outline_not_ppt": "该记录不是PPT大纲",
        "outline_need_params": "请提供 outline_id 或 content",
        "outline_parse_failed": "无法从内容中解析出幻灯片，请确认大纲格式",
        # 语音
        "whisper_need_install": "请执行 pip install openai-whisper 后重试",
    },
    "en": {
        # General
        "success": "success",
        "internal_error": "Internal server error. Please try again later.",
        "bad_request": "Invalid request format",
        "rate_limit": "Too many requests. Please try again later.",
        "blocked_content": "This content is outside the scope of this tool. Please enter compliant content.",
        "ai_error": "AI service unavailable. Please try again shortly.",
        # Conversation
        "conversation_not_found": "Conversation not found",
        "message_not_found": "Message not found",
        "message_deleted": "Message deleted",
        "no_message_to_delete": "No message to delete",
        # File
        "file_too_large": "File too large ({size}MB), maximum {max}MB",
        "file_missing": "No file received",
        "file_upload_hint": "Please use multipart/form-data to upload",
        "file_parse_failed": "File parsing failed",
        "file_format_unsupported": "Unsupported format: {name}. Please upload .txt .md .docx",
        "docx_need_install": "Docx parsing requires python-docx. Run: pip install python-docx",
        # Audio
        "audio_no_file": "No audio file received",
        "audio_convert_failed": "Audio conversion failed: …{detail}",
        "transcribe_failed": "Transcription failed",
        "correct_failed": "Correction failed",
        "correct_no_text": "Please provide text to correct",
        "correct_json": "Invalid request format, JSON required",
        # Auth
        "please_login": "Please log in first",
        "login_expired": "Session expired. Please log in again.",
        "invalid_token": "Invalid credentials",
        "invalid_report_type": "Invalid report type. Options: research, project, techsurvey, ops",
        "user_not_found": "User not found",
        "register_ok": "Registration successful",
        "login_ok": "Login successful",
        "register_failed": "Registration failed. Please try again.",
        "username_taken": "Username is already taken",
        "username_required": "Please enter a username",
        "bad_credentials": "Incorrect username or password",
        "account_locked": "Account locked. Please try again in {n} minute(s).",
        "attempts_left": "{n} attempt(s) remaining",
        "prefs_saved": "Preferences saved",
        "save_failed": "Save failed",
        "password_changed": "Password changed successfully",
        "password_change_failed": "Password change failed",
        "old_password_wrong": "Old password is incorrect",
        "password_same": "New password must differ from old password",
        "account_deleted": "Account deleted",
        "delete_failed": "Account deletion failed",
        "security_set": "Security question set",
        "security_set_failed": "Setup failed",
        "no_security_question": "No security question set for this user",
        "security_not_set": "Security question not set",
        "security_answer_wrong": "Security answer is incorrect",
        "reset_failed": "Reset failed",
        "reset_ok": "Password has been reset. Please log in.",
        # Template
        "template_not_found": "Template not found",
        "template_not_found_or_denied": "Template not found or access denied",
        "template_delete_denied": "Template not found or access denied",
        "template_create_failed": "Template creation failed",
        "template_update_failed": "Template update failed",
        "template_name_required": "Template name is required",
        "template_created": "Template created",
        "template_updated": "Updated",
        "template_deleted": "Deleted",
        "template_sample_required": "Please provide a sample output",
        "template_text_required": "Please provide text content",
        # Knowledge Base
        "kb_name_required": "Name is required",
        "kb_created": "Knowledge base created",
        "kb_create_failed": "Creation failed",
        "kb_not_found": "Knowledge base not found",
        "kb_deleted": "Deleted",
        "kb_file_missing": "Missing file or collection_id",
        "kb_file_too_large": "File too large ({size}MB), maximum 200MB",
        "kb_pdf_need_install": "PyPDF2 required. Run: pip install PyPDF2",
        "kb_pdf_too_many": "PDF has too many pages ({pages}), maximum 50",
        "kb_file_unsupported": "Unsupported file format: {name}",
        "kb_file_no_text": "No extractable text in file",
        "doc_uploaded": "Document uploaded",
        "doc_not_found": "Document not found",
        "text_saved": "Saved",
        "text_save_failed": "Save failed",
        "text_empty": "Text content is empty",
        "search_query_required": "Please enter a search query",
        # Todos
        "todo_content_required": "Task content is required",
        "todo_input_required": "Please enter todo content",
        "todo_created": "Created",
        "todo_updated": "Updated",
        "todo_deleted": "Deleted",
        "todo_not_found": "Todo not found",
        "todo_status_invalid": "Invalid status value",
        # History / Continue
        "record_not_found": "Record not found",
        "record_not_found_or_denied": "Record not found or access denied",
        "record_deleted": "Deleted successfully",
        "record_need_params": "Please provide record_id and instruction",
        # AI Features
        "ai_format_error": "AI returned invalid format",
        "ai_format_error_mock": "AI returned invalid format. Please configure a valid API Key (this feature is limited in Mock mode).",
        "api_key_required": "Please configure an API Key in settings first",
        "balance_query_failed": "Balance query failed: {detail}",
        "extract_template_failed": "Style extraction failed. Please try again later.",
        "extract_todos_failed": "Todo extraction failed. Please try again later.",
        "parse_todo_failed": "Todo parsing failed. Please try again later.",
        "continue_failed": "Conversation failed. Please try again later.",
        "search_failed": "Search failed. Please try again later.",
        "generate_failed": "Generation failed. Please try again later.",
        "model_load_failed": "Model loading failed. Please check dependencies.",
        # PPT
        "pptx_need_install": "python-pptx required. Run: pip install python-pptx",
        "outline_not_found": "Outline record not found",
        "outline_not_ppt": "This record is not a PPT outline",
        "outline_need_params": "Please provide outline_id or content",
        "outline_parse_failed": "Unable to parse slides from content. Please check the outline format.",
        # Voice
        "whisper_need_install": "Please run: pip install openai-whisper",
    }
}


def get_lang(request: Request) -> str:
    """从 Accept-Language 头检测语言，zh→中文，其他→英文"""
    al = request.headers.get("Accept-Language", "")
    return "zh" if al.lower().startswith("zh") else "en"


def t(key: str, request: Request = None, lang: str = None, **kwargs) -> str:
    """获取翻译文本"""
    if lang is None and request is not None:
        lang = get_lang(request)
    lang = lang or "zh"
    msgs = MESSAGES.get(lang, MESSAGES["zh"])
    msg = msgs.get(key, MESSAGES["zh"].get(key, key))
    if kwargs:
        msg = msg.format(**kwargs)
    return msg


def detect_input_lang(text: str) -> str:
    """检测输入文本的主要语言：统计 CJK 字符占比 > 30% → zh，否则 → en"""
    if not text:
        return "zh"
    cjk = sum(1 for c in text if '\u4e00' <= c <= '\u9fff' or '\u3400' <= c <= '\u4dbf')
    total = len(text.replace(' ', '').replace('\n', ''))
    if total == 0:
        return "zh"
    return "zh" if cjk / total > 0.3 else "en"
