// Dev helper: prints the current TOTP code for a base32 secret or an otpauth:// URI.
// Usage: pnpm totp "otpauth://totp/Ensemble:romel@...?secret=ABC..."   or   pnpm totp ABCDEF...
// If the current code is about to expire, waits for the next one so there's time to type it.
import { setTimeout as sleep } from "node:timers/promises";
import { totp } from "@/lib/totp";

const MIN_REMAINING_S = 20;

async function main(arg: string) {
  const secret = arg.startsWith("otpauth://") ? new URL(arg).searchParams.get("secret")! : arg;
  let remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (remaining < MIN_REMAINING_S) {
    await sleep(remaining * 1000 + 200);
    remaining = 30;
  }
  console.log(`${totp(secret)}  (valid ~${remaining}s)`);
}

const arg = process.argv[2];
if (arg) void main(arg);
