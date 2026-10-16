import type { PiiFinding } from '../../shared/types.ts';

const PATTERNS: { kind: PiiFinding['kind']; re: RegExp; validate?: (s: string) => boolean }[] = [
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'ssn', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'credit-card', re: /\b(?:\d[ -]?){13,16}\b/g, validate: luhn },
  { kind: 'phone', re: /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g },
  { kind: 'ip', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
];

function luhn(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 16) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function findPii(text: string): PiiFinding[] {
  const out: PiiFinding[] = [];
  const seen = new Set<string>();
  let masked = text;
  for (const p of PATTERNS) {
    for (const m of masked.matchAll(p.re)) {
      const value = m[0].trim();
      if (p.validate && !p.validate(value)) continue;
      const key = `${p.kind}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: p.kind, value });
    }
    // Stop later patterns (phone) from re-matching digits already claimed (cards, SSNs).
    masked = masked.replace(p.re, (s) => (p.validate && !p.validate(s) ? s : ' '.repeat(s.length)));
  }
  return out;
}

export function redactPii(text: string, findings: PiiFinding[]): string {
  let out = text;
  for (const f of findings) out = out.split(f.value).join(`[${f.kind.toUpperCase()} REDACTED]`);
  return out;
}
