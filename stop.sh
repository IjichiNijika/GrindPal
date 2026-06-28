#!/bin/bash
# 牛马助手 · 快速停止
# 用法: bash stop.sh
set -e

echo "=== 牛马助手 停止 ==="

# 杀 Python 进程（先 SIGTERM 再 SIGKILL）
pids=$(ps aux | grep "python.*main.py" | grep -v grep | awk '{print $2}')
if [ -n "$pids" ]; then
    echo "$pids" | while read pid; do
        kill $pid 2>/dev/null
    done
    sleep 2
    # 仍未退出的进程强制终止
    remaining=$(ps aux | grep "python.*main.py" | grep -v grep | awk '{print $2}')
    if [ -n "$remaining" ]; then
        echo "$remaining" | while read pid; do kill -9 $pid 2>/dev/null; done
    fi
    echo "已终止进程"
else
    echo "没有运行中的进程"
fi

# 释放端口
PORT=${PORT:-8000}
if fuser ${PORT}/tcp &>/dev/null; then
    fuser -k ${PORT}/tcp 2>/dev/null
    echo "端口 ${PORT} 已释放"
fi

echo "完成"
