#!/usr/bin/env node
/**
 * Claude Code UserPromptSubmit hook: appends every prompt to ai_logs/YYYY-MM-DD.txt.
 * Reads the hook payload JSON from stdin ({ session_id, cwd, prompt, ... }).
 * Never blocks a prompt: always exits 0; problems go to stderr.
 */
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const STDIN_TIMEOUT_MS = 5000;

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    const done = () => {
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(done, STDIN_TIMEOUT_MS);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

const pad = (n) => String(n).padStart(2, '0');

/** Local time with numeric offset, e.g. 2026-09-10T16:57:02-05:00 */
function localStamp(d) {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;

  const payload = JSON.parse(raw);
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) return;

  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const dir = join(root, 'ai_logs');
  mkdirSync(dir, { recursive: true });

  const stamp = localStamp(new Date());
  const file = join(dir, `${stamp.slice(0, 10)}.txt`);
  const session = String(payload.session_id || 'unknown').slice(0, 8);

  appendFileSync(file, `=== ${stamp} | session ${session} ===\n${prompt}\n\n`, 'utf8');
}

main()
  .catch((err) => {
    process.stderr.write(`[log-prompt] ${err && err.message ? err.message : err}\n`);
  })
  .finally(() => process.exit(0));
