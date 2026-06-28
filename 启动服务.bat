@echo off
chcp 65001 >nul
title 牛马助手 - 启动服务

echo ════════════════════════════════════
echo   牛马助手 GrindPal — 服务启动
echo ════════════════════════════════════
echo.

:: 定位到项目根目录
cd /d "%~dp0"

:: 检查 Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未找到 Python，请先安装 Python 3.10+
    echo         下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

:: 安装依赖（如果还没装）
echo [检查] 依赖…
python -c "import fastapi" 2>nul
if %errorlevel% neq 0 (
    echo [..] 首次运行，正在安装依赖…
    pip install -r backend\requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [完成] 依赖安装成功
)

:: 确保 .env 存在
if not exist backend\.env (
    echo [..] 首次运行，正在生成配置文件…
    echo JWT_SECRET=grindpal-%random%%random% > backend\.env
    echo CORS_ORIGINS=http://localhost:8000 >> backend\.env
)

:: 清理缓存
if exist backend\__pycache__ rmdir /s /q backend\__pycache__

:: 启动
echo.
echo [启动] 服务启动中…
echo.
echo   浏览器打开: http://localhost:8000
echo   关闭此窗口即可停止服务
echo.
start http://localhost:8000
cd /d backend
python main.py

pause
