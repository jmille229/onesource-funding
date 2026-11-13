/**
 * Every call the operator console makes has a route behind it.
 *
 * A refactor once removed POST /admin/invoices/import while the console kept
 * calling it; types and tests all passed and the Import tab simply broke. This
 * reads the console's adminApi calls and the admin routers' route paths from
 * source and fails if any call has nowhere to go.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const webAdmin = join(here, '../../../../web/src/pages/admin');

/** Route paths declared on the admin routers, e.g. "POST /invoices/:id/close". */
function apiRoutes(): { method: string; pattern: RegExp; path: string }[] {
  const out: { method: string; pattern: RegExp; path: string }[] = [];
  for (const f of ['admin.router.ts', 'applications.admin.ts', 'clients.admin.ts']) {
    const src = readFileSync(join(here, f), 'utf8');
    // router.get('/x', …) on one line, or router.post(\n  '/x', …) over two.
    for (const m of src.matchAll(/\b\w+Router\.(get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
      const path = m[2]!;
      out.push({
        method: m[1]!.toUpperCase(), path,
        pattern: new RegExp(`^${path.replace(/:[A-Za-z]+/g, '[^/]+')}$`),
      });
    }
  }
  return out;
}

/** Calls made by the console: adminApi.post(`/invoices/${id}/close`, …) → POST /invoices/X/close. */
function consoleCalls(): { method: string; path: string; file: string }[] {
  const out: { method: string; path: string; file: string }[] = [];
  for (const f of readdirSync(webAdmin).filter((n) => n.endsWith('.tsx') || n.endsWith('.ts'))) {
    const src = readFileSync(join(webAdmin, f), 'utf8');
    for (const m of src.matchAll(/adminApi\.(get|post|patch|put|delete)\(\s*([`'])([^`']+)\2/g)) {
      let raw = m[3]!;
      // An optional suffix glued to a segment — `/invoices${q ? `?x=…` : ''}` —
      // is a query string, not part of the path.
      raw = raw.replace(/([^/])\$\{.*$/, '$1');
      // An action name chosen at runtime (`/applications/${id}/${path}`)
      // can't be checked statically.
      if (/\/\$\{(path|action|kind)\}$/.test(raw)) continue;
      const path = raw.replace(/\$\{[^}]+\}/g, 'x').replace(/\?.*$/, '');
      if (!path.startsWith('/')) continue;
      out.push({ method: m[1]!.toUpperCase(), path, file: f });
    }
  }
  return out;
}

describe('operator console ↔ admin API', () => {
  const routes = apiRoutes();
  const calls = consoleCalls();

  it('finds the routes and the calls (the scan itself works)', () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(calls.length).toBeGreaterThan(30);
    expect(routes.some((r) => r.method === 'POST' && r.path === '/invoices/import')).toBe(true);
  });

  it('has a route for every call the console makes', () => {
    const missing = calls.filter((c) =>
      !routes.some((r) => r.method === c.method && r.pattern.test(c.path)));
    expect(missing.map((c) => `${c.method} ${c.path} (${c.file})`)).toEqual([]);
  });
});
