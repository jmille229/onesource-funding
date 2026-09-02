import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const timeTrackingRouter = Router();

const entrySchema = z.object({
  job_id: z.string().uuid(),
  user_id: z.string().uuid().optional(),
  work_date: z.string(),
  hours: z.number().min(0).max(24),
  overtime_hours: z.number().min(0).max(24).default(0),
  description: z.string().optional().nullable(),
  cost_code: z.string().optional().nullable(),
  trade_classification: z.string().optional().nullable(),
  pay_rate: z.number().min(0).default(0),
  budget_item_id: z.string().uuid().optional().nullable(),
  daily_log_id: z.string().uuid().optional().nullable(),
});

timeTrackingRouter.get('/', asyncHandler(async (req, res) => {
  const { job_id, user_id, from, to, approved } = req.query as Record<string, string>;
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds: string[] = [];
  if (job_id) { params.push(job_id); conds.push(`te.job_id=$${params.length}`); }
  if (user_id) { params.push(user_id); conds.push(`te.user_id=$${params.length}`); }
  if (from) { params.push(from); conds.push(`te.work_date>=$${params.length}`); }
  if (to) { params.push(to); conds.push(`te.work_date<=$${params.length}`); }
  if (approved !== undefined) { params.push(approved === 'true'); conds.push(`te.approved=$${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(parsePagination(req.query).limit);
  const r = await db.query(`SELECT te.*,u.first_name||' '||u.last_name user_name FROM time_entries te LEFT JOIN users u ON u.id=te.user_id ${where} ORDER BY te.work_date DESC,te.created_at DESC LIMIT $${params.length}`, params);
  res.json({ data: r.rows });
}));

timeTrackingRouter.post('/', requireRole('owner','admin','project_manager','field_crew'), validate(entrySchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof entrySchema>;
  const userId = body.user_id ?? req.auth.userId;
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`INSERT INTO time_entries (company_id,job_id,user_id,daily_log_id,budget_item_id,work_date,hours,overtime_hours,description,cost_code,trade_classification,pay_rate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [req.auth.companyId, body.job_id, userId, body.daily_log_id ?? null, body.budget_item_id ?? null, body.work_date, body.hours, body.overtime_hours, body.description ?? null, body.cost_code ?? null, body.trade_classification ?? null, body.pay_rate]);
  res.status(201).json({ data: r.rows[0] });
}));

timeTrackingRouter.patch('/:id/approve', requireRole('owner','admin','project_manager'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE time_entries SET approved=true,approved_by=$2,approved_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params['id'], req.auth.userId]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Entry not found' }); return; }
  res.json({ data: r.rows[0] });
}));

timeTrackingRouter.delete('/:id', requireRole('owner','admin','project_manager'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  await db.query(`DELETE FROM time_entries WHERE id=$1 AND approved=false`, [req.params['id']]);
  res.status(204).send();
}));

// ─── Weekly summary ───────────────────────────────────────────────────────────
timeTrackingRouter.get('/summary/weekly', asyncHandler(async (req, res) => {
  const { job_id, week_start } = req.query as Record<string, string>;
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [];
  const conds: string[] = [];
  if (job_id) { params.push(job_id); conds.push(`te.job_id=$${params.length}`); }
  if (week_start) { params.push(week_start); conds.push(`te.work_date>=$${params.length}`); const weekEnd = new Date(week_start); weekEnd.setDate(weekEnd.getDate() + 6); params.push(weekEnd.toISOString().split('T')[0]); conds.push(`te.work_date<=$${params.length}`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await db.query(`SELECT u.first_name||' '||u.last_name name,SUM(te.hours) total_hours,SUM(te.overtime_hours) total_ot,SUM(te.hours*te.pay_rate) total_labor_cost FROM time_entries te JOIN users u ON u.id=te.user_id ${where} GROUP BY u.id,u.first_name,u.last_name ORDER BY name`, params);
  res.json({ data: r.rows });
}));
