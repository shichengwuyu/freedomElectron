@echo off
set ELECTRON_RUN_AS_NODE=
set NODE_OPTIONS=
set GG_STORAGE_ROOT=F:\Freedom-Data
cd /d F:\Freedom\app_recovered
start "Freedom" "F:\Freedom\app_recovered\node_modules\electron\dist\electron.exe" . --disable-gpu --disable-gpu-compositing --no-sandbox
