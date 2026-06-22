@echo off
REM view.bat - render a NAPLPS .nap file using the bundled 1993 TURSHOW viewer
REM            under DOSBox-X, on Windows.
REM
REM Usage:   view.bat path\to\file.nap
REM
REM DOSBox-X is NOT bundled. Install it once (winget install dosbox-x, or grab it
REM from https://dosbox-x.com) and make sure dosbox-x.exe is on your PATH.

setlocal
set "HERE=%~dp0"
set "NAP=%~1"

if "%NAP%"=="" (
  echo Usage: %~nx0 path\to\file.nap
  exit /b 1
)
if not exist "%NAP%" (
  echo File not found: %NAP%
  exit /b 1
)
if not exist "%HERE%TURSHOW.EXE" (
  echo TURSHOW.EXE not found in %HERE% - it should ship with this folder.
  exit /b 1
)
where dosbox-x >nul 2>nul
if errorlevel 1 (
  echo dosbox-x not found on PATH. Install it: winget install dosbox-x
  echo or download from https://dosbox-x.com
  exit /b 1
)

REM Stage the viewer + a short-named copy of the .nap in a clean temp dir (DOS 8.3).
set "WORK=%TEMP%\turshow_%RANDOM%"
mkdir "%WORK%"
copy /Y "%HERE%TURSHOW.EXE" "%WORK%\TURSHOW.EXE" >nul
copy /Y "%NAP%" "%WORK%\VIEW.NAP" >nul

echo Rendering %~nx1 in TURSHOW (close the DOSBox-X window to exit)...
dosbox-x -fastlaunch -c "mount c %WORK%" -c "c:" -c "TURSHOW VIEW.NAP -vga"

rmdir /S /Q "%WORK%"
endlocal
