@echo off
rem 本地一键唤醒（等价于 GitHub Actions 里跑的那一步）
chcp 65001 >nul
cd /d "%~dp0"
set NODE_EXE=C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-6\node.exe
if not exist "%NODE_EXE%" set NODE_EXE=node
"%NODE_EXE%" scripts\wake.mjs
echo.
echo 退出码：%ERRORLEVEL%
pause
