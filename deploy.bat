@echo off
REM PlayerQI v2.0 Windows Deployment Script

echo 🚀 Deploying PlayerQI v2.0 - Hyper-Speed Cognitive Engine

REM 1. Apply database schema extensions
echo 📦 Applying database schema...
cd server\supabase
REM Uncomment and configure your database connection:
REM psql %DATABASE_URL% -f schema_v2.sql

REM 2. Install dependencies
echo 📥 Installing dependencies...
cd ..\..
npm install

REM 3. Build frontend (if needed)
if exist "client" (
  echo 🔨 Building frontend...
  cd client
  npm install
  npm run build
  cd ..
)

REM 4. Start server
echo 🎮 Starting PlayerQI v2.0 server...
node server/index.js

echo ✅ Deployment complete!
echo 🎮 PlayerQI v2.0 is now running with Hyper-Speed Cognitive Engine
pause