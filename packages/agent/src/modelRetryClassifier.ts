const TERMINAL_RATE_LIMIT_ERROR_PATTERN =
  /monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i;

export function isTerminalRateLimitMessage(message: string): boolean {
  return TERMINAL_RATE_LIMIT_ERROR_PATTERN.test(message);
}
