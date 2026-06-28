"""
统一日志模块 —— 埋点日志，方便排查问题。

格式：[时间] [级别] [模块] [请求ID] 消息
输出：控制台 + 文件（logs/app.log）
"""

import logging
import os
import sys
from datetime import datetime, timezone, timedelta

# 北京时区
TZ_BEIJING = timezone(timedelta(hours=8))

_loggers: dict[str, logging.Logger] = {}
_initialized = False


def _beijing_time(*args):
    """返回北京时间的时间戳字符串"""
    return datetime.now(TZ_BEIJING).strftime("%Y-%m-%d %H:%M:%S")


def init_logging(level: str = "INFO") -> None:
    """初始化日志系统（应用启动时调用一次）"""
    global _initialized
    if _initialized:
        return

    os.makedirs("logs", exist_ok=True)

    fmt = logging.Formatter(
        "[%(asctime)s] [%(levelname)-5s] [%(name)s] [%(request_id)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # 此处用默认时间；每个 logger 创建时会设置自定义 formatter
    root = logging.getLogger("grindpal")
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # 控制台输出
    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(fmt)
    ch.addFilter(_RequestIdFilter())
    root.addHandler(ch)

    # 文件输出
    fh = logging.FileHandler("logs/app.log", encoding="utf-8")
    fh.setFormatter(fmt)
    fh.addFilter(_RequestIdFilter())
    root.addHandler(fh)

    _initialized = True


class _RequestIdFilter(logging.Filter):
    """注入 request_id 到 LogRecord"""
    def filter(self, record):
        if not hasattr(record, "request_id") or not record.request_id:
            record.request_id = "-"
        return True


def get_logger(name: str) -> logging.Logger:
    """获取指定模块的 logger，自动继承根配置"""
    if name not in _loggers:
        _loggers[name] = logging.getLogger(f"grindpal.{name}")
    return _loggers[name]
