@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   GCC 看板数据更新
echo ========================================
echo.

:: 1. 处理数据
echo [1/4] 正在处理数据...
node scripts/process_data.js
if %errorlevel% neq 0 (
    echo.
    echo ❌ 数据处理失败，请检查数据源文件是否存在
    pause
    exit /b 1
)

:: 2. 上传加密数据到 KV
echo.
echo [2/4] 正在上传数据到云端 KV...
npx wrangler kv key put --binding=DASHBOARD_DATA "dashboard_enc" --path="public/data/dashboard.enc"
if %errorlevel% neq 0 (
    echo.
    echo ❌ KV 上传失败，请检查网络和 wrangler 配置
    pause
    exit /b 1
)

:: 3. 部署 Worker（如果 HTML 有更新）
echo.
echo [3/4] 正在部署 Worker...
npx wrangler deploy
if %errorlevel% neq 0 (
    echo.
    echo ❌ Worker 部署失败
    pause
    exit /b 1
)

:: 4. 完成
echo.
echo ========================================
echo ✅ 完成！看板数据已更新，立即生效
echo.
echo    访问地址: https://gcc-dashboard0527.你的子域.workers.dev
echo ========================================
echo.
pause
