import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { uuidParam } from '../../lib/query-params.js';
import { buildUpdateSet } from '../../lib/sql.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const dailyLogsRouter = Router();

const schema = z.object({
  job_id: z.string().uuid(),
  log_date: z.string(),
  weather: z.string().optional().nullable(),
  temperature_high: z.number().optional().nullable(),
  temperature_low: z.number().optional().nullable(),
  summary: z.string().min(1),
  delays: z.string().optional().nullable(),
  visitors: z.string().optional().nullable(),
});

dailyLogsRouter.get('/', asyncHandler(async (req, res) => {
  const { from, to } = req.query as Record<string, string>;
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  if (!job_id) { res.status(422).json({ error: 'validation_error', message: 'job_id required' }); return; }
  const db = createRlsClient(readPool, req.auth.companyId);
  const params: unknown[] = [job_id];
  const conds = ['dl.job_id=$1'];
  if (from) { params.push(from); conds.push(`dl.log_date>=$${params.length}`); }
  if (to) { params.push(to); conds.push(`dl.log_date<=$${params.length}`); }
  params.push(parsePagination(req.query).limit);
  const r = await db.query(`SELECT dl.*,u.first_name||' '||u.last_name created_by_name FROM daily_logs dl LEFT JOIN users u ON u.id=dl.created_by WHERE ${conds.join(' AND ')} ORDER BY dl.log_date DESC LIMIT $${params.length}`, params);
  res.json({ data: r.rows });
}));

dailyLogsRouter.get('/:id', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(`SELECT dl.*,u.first_name||' '||u.last_name created_by_name FROM daily_logs dl LEFT JOIN users u ON u.id=dl.created_by WHERE dl.id=$1`, [req.params['id']]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Log not found' }); return; }
  res.json({ data: r.rows[0] });
}));

dailyLogsRouter.post('/', requireRole('owner','admin','project_manager','field_crew'), validate(schema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof schema>;
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(
    `INSERT INTO daily_logs (company_id,job_id,log_date,weather,temperature_high,temperature_low,summary,delays,visitors,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (company_id,job_id,log_date) DO UPDATE SET weather=EXCLUDED.weather,temperature_high=EXCLUDED.temperature_high,temperature_low=EXCLUDED.temperature_low,summary=EXCLUDED.summary,delays=EXCLUDED.delays,visitors=EXCLUDED.visitors,updated_at=NOW()
     RETURNING *`,
    [req.auth.companyId, body.job_id, body.log_date, body.weather ?? null, body.temperature_high ?? null, body.temperature_low ?? null, body.summary, body.delays ?? null, body.visitors ?? null, req.auth.userId]
  );
  res.status(201).json({ data: r.rows[0] });
}));

// job_id and log_date are deliberately not patchable — they form the natural key
// used by the POST upsert's ON CONFLICT target.
const PATCHABLE_DAILY_LOG_COLUMNS = [
  'weather', 'temperature_high', 'temperature_low', 'summary', 'delays', 'visitors',
] as const;

dailyLogsRouter.patch('/:id', requireRole('owner','admin','project_manager','field_crew'), validate(schema.partial()), asyncHandler(async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const { clause, values } = buildUpdateSet(body, PATCHABLE_DAILY_LOG_COLUMNS);
  if (!clause) { res.status(422).json({ error: 'validation_error', message: 'Nothing to update' }); return; }
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE daily_logs SET ${clause}, updated_at=NOW() WHERE id=$1 RETURNING *`, [req.params['id'], ...values]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Log not found' }); return; }
  res.json({ data: r.rows[0] });
}));
