import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient } from '../../lib/db.js';
import { asyncHandler, requireRole, validate } from '../../middleware/index.js';

export const settingsRouter = Router();

// Valid roles that can be assigned — owner cannot be assigned via API
const ASSIGNABLE_ROLES = ['admin', 'project_manager', 'field_crew', 'accountant', 'viewer'] as const;
type AssignableRole = typeof ASSIGNABLE_ROLES[number];

// GET /api/settings/company
settingsRouter.get(
  '/company',
  asyncHandler(async (req, res) => {
    const r = await readPool.query(
      `SELECT id, name, slug, logo_url, address_line1, city, state_code, zip, phone,
              website, license_number, subscription_tier, subscription_status, settings
       FROM companies WHERE id = $1`,
      [req.auth.companyId]
    );
    res.json({ data: r.rows[0] });
  })
);

// PATCH /api/settings/company
settingsRouter.patch(
  '/company',
  requireRole('owner', 'admin'),
  validate(
    z.object({
      name: z.string().min(1).max(100).optional(),
      address_line1: z.string().max(200).optional(),
      city: z.string().max(100).optional(),
      state_code: z.string().length(2).optional(),
      zip: z.string().max(10).optional(),
      phone: z.string().max(20).optional(),
      website: z.string().url().max(200).optional().or(z.literal('')),
      license_number: z.string().max(50).optional(),
      settings: z.record(z.unknown()).optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { settings, ...fields } = req.body as Record<string, unknown>;
    const db = createRlsClient(writePool, req.auth.companyId);

    const allowed = ['name', 'address_line1', 'city', 'state_code', 'zip', 'phone', 'website', 'license_number'];
    const keys = Object.keys(fields).filter(k => allowed.includes(k));
    const updates: string[] = [];
    const params: unknown[] = [req.auth.companyId];

    for (const k of keys) {
      params.push(fields[k]);
      updates.push(`${k} = $${params.length}`);
    }
    if (settings) {
      params.push(JSON.stringify(settings));
      updates.push(`settings = settings || $${params.length}::jsonb`);
    }
    if (!updates.length) {
      res.status(422).json({ error: 'validation_error', message: 'Nothing to update' });
      return;
    }

    const r = await db.query(
      `UPDATE companies SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING
       id, name, slug, address_line1, city, state_code, zip, phone, website, license_number, settings`,
      params
    );
    res.json({ data: r.rows[0] });
  })
);

// GET /api/settings/users
settingsRouter.get(
  '/users',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const db = createRlsClient(readPool, req.auth.companyId);
    const r = await db.query(
      `SELECT id, email, first_name, last_name, role, job_title, is_active, last_login_at
       FROM users
       WHERE company_id = $1 AND deleted_at IS NULL
       ORDER BY first_name, last_name`,
      [req.auth.companyId]
    );
    res.json({ data: r.rows });
  })
);

// PATCH /api/settings/users/:id/role
settingsRouter.patch(
  '/users/:id/role',
  requireRole('owner', 'admin'),
  validate(z.object({ role: z.enum(ASSIGNABLE_ROLES) })),
  asyncHandler(async (req, res) => {
    const { role } = req.body as { role: AssignableRole };

    // SECURITY: Only owners can assign the admin role
    if (role === 'admin' && req.auth.role !== 'owner') {
      res.status(403).json({ error: 'forbidden', message: 'Only owners can assign the admin role' });
      return;
    }

    // SECURITY: Cannot modify your own role
    if (req.params['id'] === req.auth.userId) {
      res.status(422).json({ error: 'validation_error', message: 'Cannot change your own role' });
      return;
    }

    const db = createRlsClient(writePool, req.auth.companyId);
    const r = await db.query(
      `UPDATE users
       SET role = $2, updated_at = NOW()
       WHERE id = $1 AND company_id = $3 AND deleted_at IS NULL
       RETURNING id, email, first_name, last_name, role`,
      [req.params['id'], role, req.auth.companyId]
    );
    if (!r.rows[0]) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }
    res.json({ data: r.rows[0] });
  })
);

// PATCH /api/settings/users/:id/deactivate
settingsRouter.patch(
  '/users/:id/deactivate',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    if (req.params['id'] === req.auth.userId) {
      res.status(422).json({ error: 'validation_error', message: 'Cannot deactivate your own account' });
      return;
    }
    const db = createRlsClient(writePool, req.auth.companyId);
    const r = await db.query(
      `UPDATE users SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND company_id = $2
       RETURNING id, email, is_active`,
      [req.params['id'], req.auth.companyId]
    );
    if (!r.rows[0]) {
      res.status(404).json({ error: 'not_found', message: 'User not found' });
      return;
    }
    res.json({ data: r.rows[0] });
  })
);
