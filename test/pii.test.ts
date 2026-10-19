import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPii, redactPii } from '../server/analyze/pii.ts';

const kinds = (text: string) => findPii(text).map((f) => f.kind).sort();

test('finds emails, phone numbers, SSNs and IP addresses', () => {
  assert.deepEqual(kinds('Mail ana@example.org'), ['email']);
  assert.deepEqual(kinds('Call (919) 555-0142 today'), ['phone']);
  assert.deepEqual(kinds('SSN 123-45-6789'), ['ssn']);
  assert.deepEqual(kinds('Server at 192.168.1.20'), ['ip']);
});

test('card numbers must pass the Luhn check', () => {
  assert.deepEqual(kinds('Card 4111 1111 1111 1111'), ['credit-card']);
  assert.deepEqual(kinds('Order 4111 1111 1111 1112'), []);
});

test('ordinary numbers are not personal data', () => {
  assert.deepEqual(kinds('We planted 1200 bulbs across 20 plots in 2026.'), []);
});

test('redaction removes every finding from the text', () => {
  const text = 'Contact ana@example.org or (919) 555-0142.';
  const out = redactPii(text, findPii(text));
  assert.ok(!out.includes('ana@example.org'));
  assert.ok(!out.includes('555-0142'));
});
