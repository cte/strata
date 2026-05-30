export const ANSI_TRANSCRIPT = [
  "plain\r\n",
  "\x1b[1;31mred-bold\x1b[0m ",
  "\x1b[38;2;1;2;3mtruecolor\x1b[0m\r\n",
  "\x1b]8;;https://example.com\x07linked\x1b]8;;\x07\r\n",
  "wide:界 emoji:😀 accent:e\u0301",
].join("");

export const SHELL_TRANSCRIPT = [
  "$ printf 'one\\ntwo\\nthree\\n'",
  "\r\none\r\ntwo\r\nthree\r\n",
  "$ for i in 1 2 3 4 5; do echo line-$i; done",
  "\r\nline-1\r\nline-2\r\nline-3\r\nline-4\r\nline-5\r\n$ ",
].join("");

export const FULLSCREEN_TRANSCRIPT = [
  "primary prompt",
  "\x1b[?1049h",
  "\x1b[2J\x1b[H",
  "FULLSCREEN\x1b[2;1Hrow-two",
  "\x1b[?1000h\x1b[?1006h",
  "\x1b[?1049l",
].join("");
