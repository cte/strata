import { execSync, spawn } from "node:child_process";
import { platform } from "node:os";

/**
 * Cross-platform clipboard write — slim port of pi-mono's `copyToClipboard`.
 *
 * Strategy:
 *   1. Try a platform-native tool (pbcopy / clip / wl-copy / xclip / xsel /
 *      termux-clipboard-set), which writes to the *local* clipboard on a
 *      non-remote session.
 *   2. On SSH/Mosh sessions, *also* emit OSC 52 so the terminal forwards the
 *      copy to the user's actual local clipboard. This is the only path that
 *      works when cortex is running on a remote machine.
 *
 * Throws if no path succeeds.
 */
export async function copyToClipboard(text: string): Promise<void> {
  let copied = false;

  const tool = nativeToolExec(text);
  if (tool) {
    copied = true;
  }

  if (isRemoteSession() || !copied) {
    if (emitOsc52(text)) {
      copied = true;
    }
  }

  if (!copied) {
    throw new Error("No clipboard mechanism available (install xclip/wl-copy or use a terminal that supports OSC 52)");
  }
}

function isRemoteSession(): boolean {
  return Boolean(
    process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.MOSH_CONNECTION,
  );
}

const MAX_OSC52_ENCODED_LENGTH = 100_000;

function emitOsc52(text: string): boolean {
  const encoded = Buffer.from(text).toString("base64");
  if (encoded.length > MAX_OSC52_ENCODED_LENGTH) {
    return false;
  }
  process.stdout.write(`\x1b]52;c;${encoded}\x07`);
  return true;
}

function nativeToolExec(text: string): boolean {
  const options = {
    input: text,
    timeout: 5000,
    stdio: ["pipe", "ignore", "ignore"] as ["pipe", "ignore", "ignore"],
  };
  try {
    const p = platform();
    if (p === "darwin") {
      execSync("pbcopy", options);
      return true;
    }
    if (p === "win32") {
      execSync("clip", options);
      return true;
    }
    if (process.env.TERMUX_VERSION) {
      try {
        execSync("termux-clipboard-set", options);
        return true;
      } catch {
        // fall through
      }
    }
    if (process.env.WAYLAND_DISPLAY) {
      try {
        execSync("which wl-copy", { stdio: "ignore" });
        // wl-copy with execSync sometimes hangs; use spawn so we don't block.
        const proc = spawn("wl-copy", [], { stdio: ["pipe", "ignore", "ignore"] });
        proc.stdin.on("error", () => {
          // wl-copy may exit before we've written everything; ignore EPIPE.
        });
        proc.stdin.write(text);
        proc.stdin.end();
        proc.unref();
        return true;
      } catch {
        // fall through to X11
      }
    }
    if (process.env.DISPLAY) {
      try {
        execSync("xclip -selection clipboard", options);
        return true;
      } catch {
        try {
          execSync("xsel --clipboard --input", options);
          return true;
        } catch {
          // fall through
        }
      }
    }
  } catch {
    // any other unexpected failure — fall through to caller (OSC 52 fallback)
  }
  return false;
}
