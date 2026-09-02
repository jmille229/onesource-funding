import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient } from '../../lib/db.js';
import { parsePagination, escapeLike } from '../../lib/pagination.js';
import { buildUpdateSet } from '../../lib/sql.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const contactsRouter = Router();

const schema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['customer','vendor','subcontractor','both']).default('customer'),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  address_line1: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state_code: z.string().length(2).optional().nullable(),
  zip: z.string().optional().nullable(),
  license_number: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// SECURITY: Explicit allowlist for the dynamic PATCH — see lib/sql.ts.
const PATCHABLE_CONTACT_COLUMNS = [
  'name', 'type', 'email', 'phone', 'address_line1', 'city', 'state_code',
  'zip', 'license_number', 'notes', 'certifications',
] as const;

contactsRouter.get('/', asyncHandler(async (req, res) => {
  const { type, search } = req.query as Record<string, string>;
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds = ['deleted_at IS NULL'];
  if (type) { params.push(type); conds.push(`type=$${params.length}`); }
  if (search) { params.push(`%${escapeLike(search)}%`); conds.push(`name ILIKE $${params.length}`); }
  params.push(parsePagination(req.query).limit);
  const r = await db.query(`SELECT * FROM contacts WHERE ${conds.join(' AND ')} ORDER BY name LIMIT $${params.length}`, params);
  res.json({ data: r.rows });
}));

contactsRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(`SELECT * FROM contacts WHERE id=$1 AND deleted_at IS NULL`, [req.params['id']]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Contact not found' }); return; }
  res.json({ data: r.rows[0] });
}));

contactsRouter.post('/', requireRole('owner','admin','project_manager','accountant'), validate(schema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof schema>;
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`INSERT INTO contacts (company_id,name,type,email,phone,address_line1,city,state_code,zip,license_number,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [req.auth.companyId, body.name, body.type, body.email ?? null, body.phone ?? null, body.address_line1 ?? null, body.city ?? null, body.state_code ?? null, body.zip ?? null, body.license_number ?? null, body.notes ?? null]);
  res.status(201).json({ data: r.rows[0] });
}));

contactsRouter.patch('/:id', requireRole('owner','admin','project_manager','accountant'), validate(schema.partial()), asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const { clause, values } = buildUpdateSet(body, PATCHABLE_CONTACT_COLUMNS);
  if (!clause) { res.status(422).json({ error: 'validation_error', message: 'Nothing to update' }); return; }
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE contacts SET ${clause},updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING *`, [req.params['id'], ...values]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Contact not found' }); return; }
  res.json({ data: r.rows[0] });
}));

contactsRouter.delete('/:id', requireRole('owner','admin'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  await db.query(`UPDATE contacts SET deleted_at=NOW() WHERE id=$1`, [req.params['id']]);
  res.status(204).send();
}));
