/** 1234 → 1k, 1_234_567 → 1.2M; rounds up to M before it would read 1000k. */
export const fmtTokens = (n: number) =>
  n >= 999_500 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
