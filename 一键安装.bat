@echo off
chcp 65001 >nul
title 牛马助手 - 一键安装

echo ════════════════════════════════════
echo   牛马助手 GrindPal v1.0
echo   一键安装工具
echo ════════════════════════════════════
echo.

:: ========================================
:: 1. 检查 Python
:: ========================================
echo [1/4] 检查 Python…
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [失败] 未找到 Python，请先安装 Python 3.10+
    echo        下载地址: https://www.python.org/downloads/
    echo.
    echo  安装时请勾选 "Add Python to PATH"
    pause
    exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do echo   检测到 Python %%v
echo.

:: ========================================
:: 2. 安装核心依赖
:: ========================================
echo [2/4] 安装核心依赖…
pip install -r "%~dp0backend\requirements.txt" -i https://pypi.tuna.tsinghua.edu.cn/simple
if %errorlevel% neq 0 (
    echo [失败] 依赖安装失败，请检查网络连接
    pause
    exit /b 1
)
echo   核心依赖安装成功
echo.

:: ========================================
:: 3. 可选功能安装
:: ========================================
echo [3/4] 可选功能安装
echo   ┌─────────────────────────────────────────────┐
echo   │ 语音转文字：需要 pywhispercpp + 模型文件     │
echo   │   tiny  (77MB)  最快，适合实时               │
echo   │   base  (142MB) 较快，推荐                   │
echo   │   small (466MB) 较准                         │
echo   │   medium(1.5GB) 最准                         │
echo   │ 首次运行会自动下载模型                        │
echo   └─────────────────────────────────────────────┘
echo.
set /p INSTALL_TRANSCRIBE="   是否安装语音转文字功能? (y/n, 默认 n): "
if /i "%INSTALL_TRANSCRIBE%"=="y" (
    echo.
    echo   [..] 正在安装语音转文字依赖…
    pip install pywhispercpp webrtcvad -i https://pypi.tuna.tsinghua.edu.cn/simple
    if %errorlevel% neq 0 (
        echo   [警告] 安装失败，可稍后手动执行:
        echo          pip install pywhispercpp webrtcvad
    ) else (
        echo   [完成] 语音转文字已安装
    )
) else (
    echo   跳过语音转文字
)
echo.

:: ========================================
:: 4. 生成配置文件
:: ========================================
echo [4/4] 生成配置文件…
cd /d "%~dp0backend"
if not exist ".env" (
    echo JWT_SECRET=grindpal-%random%%random% > .env
    echo CORS_ORIGINS=http://localhost:8000 >> .env
    echo   .env 配置文件已生成
) else (
    echo   .env 已存在，跳过
)
echo.

:: ========================================
:: 完成
:: ========================================
echo ════════════════════════════════════
echo   安装完成！
echo ════════════════════════════════════
echo.
echo   使用方法：
echo.
echo   【方式一】双击 dist\牛马助手.exe（绿色版，无需安装 Python）
echo.
echo   【方式二】双击 启动服务.bat（需要 Python，适合开发调试）
echo.
echo   然后浏览器打开: http://localhost:8000
echo.
pause
