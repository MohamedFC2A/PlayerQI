#!/bin/bash
# PlayerQI v2.0 Deployment Script

echo "🚀 Deploying PlayerQI v2.0 - Hyper-Speed Cognitive Engine"

# 1. Apply database schema extensions
echo "📦 Applying database schema..."
cd server/supabase
psql $DATABASE_URL -f schema_v2.sql

# 2. Install dependencies
echo "📥 Installing dependencies..."
cd ../..
npm install

# 3. Build frontend (if needed)
if [ -d "client" ]; then
  echo "🔨 Building frontend..."
  cd client
  npm install
  npm run build
  cd ..
fi

# 4. Start server
echo "🎮 Starting PlayerQI v2.0 server..."
node server/index.js

echo "✅ Deployment complete!"
echo "🎮 PlayerQI v2.0 is now running with Hyper-Speed Cognitive Engine"