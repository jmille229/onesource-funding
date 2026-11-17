import { describe, it, expect } from 'vitest';
import { smtpTls } from './mailer.js';

describe('smtpTls', () => {
  it('587 always upgrades with STARTTLS, whatever SMTP_SECURE says', () => {
    expect(smtpTls(587, true)).toEqual({ secure: false, requireTLS: true });
    expect(smtpTls(587, false)).toEqual({ secure: false, requireTLS: true });
  });
  it('465 is encrypted from the start', () => {
    expect(smtpTls(465, false)).toEqual({ secure: true, requireTLS: false });
  });
  it('other ports follow SMTP_SECURE', () => {
    expect(smtpTls(1025, false)).toEqual({ secure: false, requireTLS: false });
    expect(smtpTls(2465, true)).toEqual({ secure: true, requireTLS: false });
  });
});
