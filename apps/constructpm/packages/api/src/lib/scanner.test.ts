import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import { Readable } from 'stream';
import { clamdScan } from './scanner.js';

/**
 * A stand-in clamd: parses the INSTREAM framing exactly as clamd does and
 * answers FOUND for the EICAR test string, OK otherwise.
 */
let server: net.Server;
let port = 0;
let lastBytes = 0;

beforeAll(async () => {
  server = net.createServer((sock) => {
    let buf = Buffer.alloc(0);
    let header = false;
    let body = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!header) {
        const nul = buf.indexOf(0);
        if (nul < 0) return;
        if (buf.subarray(0, nul).toString() !== 'zINSTREAM') { sock.end('UNKNOWN COMMAND\0'); return; }
        header = true;
        buf = buf.subarray(nul + 1);
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0);
        if (len === 0) {
          lastBytes = body.length;
          sock.end(body.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'))
            ? 'stream: Eicar-Test-Signature FOUND\0' : 'stream: OK\0');
          return;
        }
        if (buf.length < 4 + len) return;
        body = Buffer.concat([body, buf.subarray(4, 4 + len)]);
        buf = buf.subarray(4 + len);
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as net.AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

describe('clamdScan', () => {
  it('reports a clean file', async () => {
    expect(await clamdScan(Readable.from([Buffer.from('%PDF-1.7 hello')]), '127.0.0.1', port))
      .toEqual({ infected: false, signature: null });
  });

  it('reports the EICAR test file as infected, with its signature', async () => {
    expect(await clamdScan(Readable.from([Buffer.from(EICAR)]), '127.0.0.1', port))
      .toEqual({ infected: true, signature: 'Eicar-Test-Signature' });
  });

  it('streams large files in chunks without losing bytes', async () => {
    const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
    expect(await clamdScan(Readable.from([big]), '127.0.0.1', port)).toEqual({ infected: false, signature: null });
    expect(lastBytes).toBe(big.length);
  });

  it('fails (rather than calling a file clean) when the scanner is unreachable', async () => {
    await expect(clamdScan(Readable.from([Buffer.from('x')]), '127.0.0.1', 1)).rejects.toThrow();
  });
});
