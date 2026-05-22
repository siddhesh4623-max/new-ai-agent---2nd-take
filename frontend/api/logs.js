import fs from "fs";
import path from "path";
import os from "os";

// Cross-platform log file path:
// - Unix: /tmp/bot.log
// - Windows: %TEMP%/bot.log
const LOG_FILE = process.platform === "win32"
  ? path.join(os.tmpdir(), "bot.log")
  : "/tmp/bot.log";

const MAX_LINES = 200;

export default function handler(req, res) {
  const since = parseInt(req.query.since ?? "0");
  try {
    if (!fs.existsSync(LOG_FILE)) {
      res.json({ logs: [], total: 0, since: 0 });
      return;
    }
    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim().length > 0);
    const total = allLines.length;
    const newLines = allLines.slice(Math.max(0, since));
    const trimmed = newLines.slice(-MAX_LINES);
    res.json({ logs: trimmed, total, since: Math.max(0, total - trimmed.length) });
  } catch {
    res.json({ logs: [], total: 0, since: 0 });
  }
}
