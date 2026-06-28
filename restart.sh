#!/bin/bash
# 牛马助手 · 软重启脚本
# 用法: bash restart.sh
# 功能: 优雅杀进程 → 清缓存 → 启动服务 → 验证

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"

echo "=== 牛马助手 软重启 ==="

# 1. 优雅关闭现有进程（先 SIGTERM，给 SQLite 时间 checkpoint WAL）
echo "[1/4] 关闭现有进程…"
pids=$(ps aux | grep "python.*main\.py" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "      发送 SIGTERM → $pids"
    echo "$pids" | while read pid; do kill $pid 2>/dev/null; done
    # 等待最多 5 秒让进程优雅退出 + SQLite WAL checkpoint
    for i in $(seq 1 10); do
        remaining=$(ps aux | grep "python.*main\.py" | grep -v grep | awk '{print $2}')
        [ -z "$remaining" ] && break
        sleep 0.5
    done
    # 仍未退出的强制终止
    remaining=$(ps aux | grep "python.*main\.py" | grep -v grep | awk '{print $2}')
    if [ -n "$remaining" ]; then
        echo "      强制终止残留进程 → $remaining"
        echo "$remaining" | while read pid; do kill -9 $pid 2>/dev/null; done
        sleep 1
    fi
    echo "      所有 Python 进程已清除"
else
    echo "      没有运行中的进程"
fi

# ⚠️ 不再删除 WAL 文件！SQLite 会在启动时自动恢复/合并 WAL
# 之前 rm -f smarttext.db-wal 是数据丢失的根源

# 2. 清 Python 缓存
echo "[2/4] 清缓存…"
rm -rf "$BACKEND_DIR/__pycache__"

# 3. 启动服务
echo "[3/4] 启动服务…"
cd "$BACKEND_DIR"
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    PYTHON=python
else
    echo "      错误: 找不到 Python，请确认已安装并加入 PATH"
    exit 1
fi
nohup $PYTHON main.py > /dev/null 2>&1 &
SERVER_PID=$!
sleep 3

# 4. 验证健康检查
echo "[4/4] 验证…"
if curl -sf http://localhost:8000/api/v1/health > /dev/null 2>&1; then
    echo "      服务启动成功 ✓  http://localhost:8000"
    echo "      PID: $SERVER_PID"
else
    echo "      启动失败 ✗  请检查日志"
    exit 1
fi
echo "=== 完成 ==="
