import { NextResponse } from "next/server";
import fs from "fs";

const LOG_FILE = "/tmp/bot.log";
const MAX_LINES = 200;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const since = parseInt(searchParams.get("since") || "0");

  try {
    if (!fs.existsSync(LOG_FILE)) {
      return NextResponse.json({ logs: [], total: 0, since: 0 });
    }

    const content = fs.readFileSync(LOG_FILE, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim().length > 0);
    const total = allLines.length;

    // Return only new lines since last fetch (by line index)
    const newLines = allLines.slice(Math.max(0, since));
    const trimmed = newLines.slice(-MAX_LINES);

    return NextResponse.json({
      logs: trimmed,
      total,
      since: Math.max(0, total - trimmed.length),
    });
  } catch {
    return NextResponse.json({ logs: [], total: 0, since: 0 });
  }
}
