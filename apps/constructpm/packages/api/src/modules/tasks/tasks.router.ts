import { Router } from 'express';
import { z } from 'zod';
import { writePool, readPool, createRlsClient } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { uuidParam } from '../../lib/query-params.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

export const tasksRouter = Router();

const taskSchema = z.object({
  job_id: z.string().uuid(),
  task_group_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(300),
  description: z.string().optional().nullable(),
  status: z.enum(['not_started','in_progress','completed','blocked']).default('not_started'),
  start_date: z.string().optional().nullable(),
  end_date: z.string().optional().nullable(),
  duration_days: z.number().int().optional().nullable(),
  completion_pct: z.number().min(0).max(100).default(0),
  budget_item_id: z.string().uuid().optional().nullable(),
  sort_order: z.number().int().optional(),
});

tasksRouter.get('/', asyncHandler(async (req, res) => {
  const job_id = uuidParam(req.query['job_id'], 'job_id');
  if (!job_id) { res.status(422).json({ error: 'validation_error', message: 'job_id required' }); return; }
  const db = createRlsClient(readPool, req.auth.companyId);
  // One job's schedule is rendered whole, so the default is generous; the cap
  // is a safety net against a runaway import, not a page size.
  const { limit } = parsePagination(req.query, { defaultPerPage: 500, maxPerPage: 1000 });
  const [grps, tks] = await Promise.all([
    db.query(`SELECT * FROM task_groups WHERE job_id=$1 AND deleted_at IS NULL ORDER BY sort_order LIMIT $2`, [job_id, limit]),
    db.query(
      `SELECT t.*, COALESCE(json_agg(json_build_object('user_id',ta.user_id,'name',u.first_name||' '||u.last_name)) FILTER (WHERE ta.user_id IS NOT NULL),'[]') AS assignees
       FROM tasks t LEFT JOIN task_assignees ta ON ta.task_id=t.id LEFT JOIN users u ON u.id=ta.user_id
       WHERE t.job_id=$1 AND t.deleted_at IS NULL GROUP BY t.id ORDER BY t.sort_order,t.created_at LIMIT $2`, [job_id, limit]
    ),
  ]);
  res.json({ data: { task_groups: grps.rows, tasks: tks.rows } });
}));

tasksRouter.post('/', requireRole('owner','admin','project_manager'), validate(taskSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof taskSchema>;
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.company_id', req.auth.companyId]);
    const so = await client.query<{ max: string | null }>(`SELECT MAX(sort_order) max FROM tasks WHERE job_id=$1`, [body.job_id]);
    const r = await client.query<{ id: string }>(
      `INSERT INTO tasks (company_id,job_id,task_group_id,name,description,status,start_date,end_date,duration_days,completion_pct,budget_item_id,sort_order,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [req.auth.companyId, body.job_id, body.task_group_id ?? null, body.name, body.description ?? null, body.status, body.start_date ?? null, body.end_date ?? null, body.duration_days ?? null, body.completion_pct, body.budget_item_id ?? null, body.sort_order ?? (parseInt(so.rows[0]?.max ?? '-1') + 1), req.auth.userId]
    );
    await client.query('COMMIT');
    const t = await createRlsClient(readPool, req.auth.companyId).query(`SELECT * FROM tasks WHERE id=$1`, [r.rows[0]!.id]);
    res.status(201).json({ data: t.rows[0] });
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}));

// SECURITY: Explicit allowlist of columns that can be patched — prevents column injection
const PATCHABLE_TASK_COLUMNS = new Set([
  'name', 'description', 'status', 'start_date', 'end_date',
  'duration_days', 'completion_pct', 'sort_order', 'task_group_id', 'budget_item_id',
]);

const patchTaskSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().nullable().optional(),
  status: z.enum(['not_started','in_progress','completed','blocked']).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  duration_days: z.number().int().nullable().optional(),
  completion_pct: z.number().min(0).max(100).optional(),
  sort_order: z.number().int().optional(),
  task_group_id: z.string().uuid().nullable().optional(),
  budget_item_id: z.string().uuid().nullable().optional(),
});

tasksRouter.patch('/:id', requireRole('owner','admin','project_manager','field_crew'), validate(patchTaskSchema), asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof patchTaskSchema>;
  const keys = Object.keys(body).filter(k => PATCHABLE_TASK_COLUMNS.has(k));
  if (!keys.length) { res.status(422).json({ error: 'validation_error', message: 'Nothing to update' }); return; }
  const db = createRlsClient(writePool, req.auth.companyId);
  const params: unknown[] = [req.params['id']];
  const setClauses = keys.map((k, i) => { params.push((body as Record<string, unknown>)[k]); return `${k} = $${i + 2}`; });
  const r = await db.query(
    `UPDATE tasks SET ${setClauses.join(', ')}, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
    params
  );
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Task not found' }); return; }
  res.json({ data: r.rows[0] });
}));

tasksRouter.delete('/:id', requireRole('owner','admin','project_manager'), asyncHandler(async (req, res) => {
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`UPDATE tasks SET deleted_at=NOW() WHERE id=$1 RETURNING id`, [req.params['id']]);
  if (!r.rows[0]) { res.status(404).json({ error: 'not_found', message: 'Task not found' }); return; }
  res.status(204).send();
}));

// POST /api/tasks/groups
tasksRouter.post('/groups', requireRole('owner','admin','project_manager'), asyncHandler(async (req, res) => {
  const { job_id, name, sort_order } = req.body as { job_id: string; name: string; sort_order?: number };
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`INSERT INTO task_groups (company_id,job_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`, [req.auth.companyId, job_id, name, sort_order ?? 0]);
  res.status(201).json({ data: r.rows[0] });
}));
