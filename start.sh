#!/bin/bash
set -e

echo "=== Starting BTC Trading System ==="

# Build the frontend if not already built
if [ ! -d "frontend/.next" ]; then
  echo "[WEB] Building Next.js frontend..."
  cd frontend && npm install && npm run build && cd ..
fi

# Set up environment variables for cross-process communication
export TRADES_CSV_PATH="$(pwd)/backend/trades_journal.csv"
export LOGS_FILE_PATH="$([ -d /tmp ] && echo /tmp/bot.log || echo /var/tmp/bot.log)"

# Clear previous log file
> "${LOGS_FILE_PATH}"

# Start the Python trading bot — pipe stdout+stderr to log file AND terminal
echo "[BOT] Starting Python trading bot..."
python -u main.py 2>&1 | tee -a "${LOGS_FILE_PATH}" &
BOT_PID=$!
echo "[BOT] Running with PID $BOT_PID"

# Start the Next.js dashboard
echo "[WEB] Starting Next.js dashboard on port 5000..."
cd frontend && npm start

# If Next.js exits, also kill the bot
kill $BOT_PID 2>/dev/null || true
