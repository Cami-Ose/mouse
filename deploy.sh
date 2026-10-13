#!/bin/bash
# Mouse 一键部署脚本
# 用法：bash deploy.sh

set -e

APP_DIR="/opt/mouse"
LOG_FILE="/tmp/mouse.log"
PORT=8086

echo "=== 停止旧进程 ==="
fuser -k "${PORT}/tcp" 2>/dev/null || true

echo "=== 进入项目目录 ==="
cd "$APP_DIR"

echo "=== 拉取最新代码 ==="
git pull

echo "=== 安装/更新依赖 ==="
source venv/bin/activate
pip install -r requirements.txt -q

echo "=== 启动服务 ==="
nohup uvicorn backend.main:app --host 127.0.0.1 --port $PORT --workers 1 > "$LOG_FILE" 2>&1 &

echo "=== 等待启动 ==="
sleep 2
if pgrep -f "uvicorn.*main:app" > /dev/null 2>&1; then
    echo "✅ 启动成功 (PID: $(pgrep -f 'uvicorn.*main:app' | head -1))"
else
    echo "❌ 启动失败，查看日志："
    tail -20 "$LOG_FILE"
fi
