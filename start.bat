@echo off
taskkill /F /IM node.exe >nul 2>&1
node server.js
