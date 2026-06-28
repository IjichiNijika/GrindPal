#!/bin/bash
# 牛马助手 · 快速启动
# 用法: bash start.sh
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo "=== 牛马助手 启动 ==="

# 查端口 — 用 SIGTERM 优雅关闭，给 SQLite 时间写回 WAL
if fuser 8000/tcp &>/dev/null; then
    echo "端口 8000 已被占用，正在释放…"
    fuser -k -TERM 8000/tcp 2>/dev/null
    sleep 2
    # 若仍未释放再强制
    if fuser 8000/tcp &>/dev/null; then
        fuser -k 8000/tcp 2>/dev/null
        sleep 1
    fi
fi

# 自选 Python
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo "找不到 Python，请确认已安装"
    exit 1
fi

# 清缓存
rm -rf "$BACKEND_DIR/__pycache__"

# 启动
cd "$BACKEND_DIR"
nohup $PYTHON main.py > /dev/null 2>&1 &
PID=$!
sleep 2

# 验证
if curl -sf http://localhost:${PORT:-8000}/api/v1/health > /dev/null 2>&1; then
    echo "启动成功 ✓  http://localhost:${PORT:-8000}  PID: $PID"
else
    echo "启动失败，请查看 $BACKEND_DIR/logs/app.log"
    exit 1
fi
