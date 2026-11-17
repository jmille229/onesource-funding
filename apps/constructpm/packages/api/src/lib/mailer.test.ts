import { describe, it, expect } from 'vitest';
import { smtpTls, describeMailError } from './mailer.js';

describe('smtpTls', () => {
  it('587 always upgrades with STARTTLS, whatever SMTP_SECURE says', () => {
    expect(smtpTls(587, true)).toEqual({ secure: false, requireTLS: true });
    expect(smtpTls(587, false)).toEqual({ secure: false, requireTLS: true });
  });
  it('465 is encrypted from the start', () => {
    expect(smtpTls(465, false)).toEqual({ secure: true, requireTLS: false });
  });
  it('the alternative ports sending services offer behave like their standard twins', () => {
    expect(smtpTls(2465, false)).toEqual({ secure: true, requireTLS: false });
    expect(smtpTls(2587, true)).toEqual({ secure: false, requireTLS: true });
    expect(smtpTls(2525, false)).toEqual({ secure: false, requireTLS: true });
  });
  it('other ports follow SMTP_SECURE', () => {
    expect(smtpTls(1025, false)).toEqual({ secure: false, requireTLS: false });
    expect(smtpTls(2526, true)).toEqual({ secure: true, requireTLS: false });
  });
});

describe('describeMailError', () => {
  const d = (e: Parameters<typeof describeMailError>[0]) => describeMailError(e, 'smtp.gmail.com', 587);
  it('a blocked port says so and points at the fix', () => {
    expect(d({ code: 'ETIMEDOUT', message: 'Connection timeout' })).toMatch(/No answer from smtp.gmail.com on port 587.*DigitalOcean/);
    expect(d({ code: 'ECONNECTION', message: 'Connection timeout' })).toMatch(/No answer/);
  });
  it('a refused or unknown host', () => {
    expect(d({ code: 'ESOCKET', message: 'connect ECONNREFUSED 1.2.3.4:587' })).toMatch(/refused the connection/);
    expect(d({ code: 'EDNS', message: 'getaddrinfo ENOTFOUND smtp.gmial.com' })).toMatch(/Couldn't find/);
  });
  it('a wrong password quotes the server, not the password', () => {
    const m = d({ code: 'EAUTH', response: '535-5.7.8 Username and Password not accepted', responseCode: 535 });
    expect(m).toMatch(/rejected the username or password.*535-5.7.8/);
  });
  it('a refused sender', () => {
    expect(d({ code: 'EENVELOPE', response: '553 5.7.1 Sender address rejected' })).toMatch(/EMAIL_FROM/);
  });
});
