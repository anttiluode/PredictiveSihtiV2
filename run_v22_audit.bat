@echo off
setlocal
cd /d "%~dp0"
echo Predictive Sihti V2.2 - Causal Self-repair Audit
node --version || (echo Node.js 22+ required. & pause & exit /b 1)
echo.
echo [1/3] Original engine regressions
node tests\test.cjs --bench || goto :fail
echo.
echo [2/3] Same-bank controls and online self-repair
node tests\self_repair.cjs --bench || goto :fail
echo.
echo [3/3] Real headless Edge / Chrome UI audit
node headless_v22_audit.cjs || goto :fail
echo.
echo SEND BACK THIS FILE:
echo %CD%\headless_receipt\predictive_sihti_headless_receipt.zip
pause
exit /b 0
:fail
echo FAILED: See above. The audit may still have left a diagnostic receipt ZIP.
pause
exit /b 1
