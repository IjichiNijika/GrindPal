#!/bin/bash
# 牛马助手 · 僵尸进程清理
# 用法: bash cleanup_zombies.sh
# 
# 注意：收割僵尸进程需要父进程调用 waitpid()。
# 发送 SIGCHLD 仅提示父进程去收割，不一定有效。
# 如果僵尸持续存在，请检查父进程是否异常。

echo "=== 僵尸进程清理 ==="
# 找所有僵尸进程的父进程
zombie_ppids=$(ps -A -ostat,ppid | grep -e '^[Zz]' | awk '{print $2}' | sort -u)

if [ -z "$zombie_ppids" ]; then
    echo "未发现僵尸进程 ✓"
    exit 0
fi
echo "发现 $(echo "$zombie_ppids" | wc -l) 个僵尸父进程"
remaining_count=$(echo "$zombie_ppids" | wc -l)
for ppid in $zombie_ppids; do
    # 先尝试 SIGCHLD（如果父进程有 handler 则立即收割）
    echo "→ 向父进程 [$ppid] ($(ps -p $ppid -o comm= 2>/dev/null || echo '?')) 发送 SIGCHLD..."
    kill -CHLD $ppid 2>/dev/null && echo "  ✓ 已发送"
done
sleep 2
remaining=$(ps aux | grep -c defunct)
echo "清理后剩余僵尸: $remaining"
if [ "$remaining" -gt 0 ]; then
    echo "⚠ 仍有 $remaining 个僵尸进程。"
    echo "  可用以下方法解决："
    echo "  1. 重启父进程（推荐）"
    echo "  2. 或使用: sudo pkill -9 -P $(echo $zombie_ppids | head -1)"
    echo "  3. 或用: kill -9 $(ps -A -ostat,ppid | grep -e '^[Zz]' | awk '{print $2}')"
    echo "     ⚠ 警告：上述强力方法可能影响服务的正常运行，请谨慎使用。"
fi
echo "=== 完成 ==="
