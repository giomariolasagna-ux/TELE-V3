@echo off
REM Mock Whisper.cpp for Testing Integration
REM Usage: main.exe -m model -f file ...

echo [MockWhisper] Analyzing Audio file (10s)... >&2
timeout /t 10 >nul
echo scan temp
exit /b 0
