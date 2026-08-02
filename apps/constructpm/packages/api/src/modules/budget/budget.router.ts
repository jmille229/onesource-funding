import { Router } from 'express';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { writePool, readPool, createRlsClient, withTransaction } from '../../lib/db.js';
import { asyncHandler, validate, requireRole } from '../../middleware/index.js';

type BudgetTotals = { ext_cost: number; ext_price: number; committed: number; actual: number };

export const budgetRouter = Router();

budgetRouter.get('/:jobId', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [budget, groups, items] = await Promise.all([
    db.query(`SELECT * FROM budgets WHERE job_id=$1 LIMIT 1`, [req.params['jobId']]),
    db.query(`SELECT * FROM budget_groups WHERE job_id=$1 AND deleted_at IS NULL ORDER BY sort_order`, [req.params['jobId']]),
    db.query(
      `SELECT bi.*,
        COALESCE(d.committed_amount,0) committed,
        COALESCE(d.actual_amount,0)    actual,
        COALESCE(d.invoiced_amount,0)  invoiced,
        CASE WHEN bi.ext_cost>0 THEN ROUND(((COALESCE(d.actual_amount,0)+COALESCE(d.committed_amount,0))/bi.ext_cost*100)::numeric,1) ELSE 0 END depletion_pct
       FROM budget_items bi
       LEFT JOIN budget_item_depletion_summary d ON d.budget_item_id=bi.id
       WHERE bi.job_id=$1 AND bi.deleted_at IS NULL ORDER BY bi.sort_order`,
      [req.params['jobId']]
    ),
  ]);
  // Postgres returns numerics as strings; Number() coerces safely from unknown
  // (unary + does not type-check against unknown) and treats a missing column as 0.
  const t = items.rows.reduce<BudgetTotals>((a, i) => ({
    ext_cost:  a.ext_cost  + Number(i['ext_cost']  ?? 0),
    ext_price: a.ext_price + Number(i['ext_price'] ?? 0),
    committed: a.committed + Number(i['committed'] ?? 0),
    actual:    a.actual    + Number(i['actual']    ?? 0),
  }), { ext_cost: 0, ext_price: 0, committed: 0, actual: 0 });
  res.json({ data: { budget: budget.rows[0] ?? null, budget_groups: groups.rows, budget_items: items.rows, totals: { ...t, gross_profit: t.ext_price - t.ext_cost, margin_pct: t.ext_price ? ((t.ext_price - t.ext_cost) / t.ext_price * 100).toFixed(1) : '0.0' } } });
}));

const itemSchema = z.object({
  id: z.string().uuid().optional(),
  budget_group_id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(300),
  cost_type: z.enum(['material','labor','subcontractor','equipment','overhead','other']).default('material'),
  cost_code: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  quantity: z.number().min(0).default(1),
  unit_cost: z.number().min(0).default(0),
  markup_pct: z.number().min(0).default(0),
  sort_order: z.number().int().optional(),
  _destroy: z.boolean().optional(),
});

budgetRouter.put('/:jobId/items', requireRole('owner','admin','project_manager','accountant'), validate(z.object({ items: z.array(itemSchema) })), asyncHandler(async (req, res) => {
  const { items } = req.body as { items: z.infer<typeof itemSchema>[] };
  const jobId = req.params['jobId']!;
  const results = await withTransaction(req.auth.companyId, async (client) => {
    const rows = [];
    for (const item of items) {
      if (item._destroy && item.id) { await client.query(`UPDATE budget_items SET deleted_at=NOW() WHERE id=$1`, [item.id]); continue; }
      const extCost = new Decimal(item.quantity).times(item.unit_cost);
      const unitPrice = new Decimal(item.unit_cost).times(new Decimal(item.markup_pct).div(100).plus(1));
      const extPrice = new Decimal(item.quantity).times(unitPrice);
      if (item.id) {
        const r = await client.query(`UPDATE budget_items SET budget_group_id=$1,name=$2,cost_type=$3,cost_code=$4,unit=$5,quantity=$6,unit_cost=$7,markup_pct=$8,ext_cost=$9,unit_price=$10,ext_price=$11,sort_order=$12,updated_at=NOW() WHERE id=$13 RETURNING *`, [item.budget_group_id ?? null, item.name, item.cost_type, item.cost_code ?? null, item.unit ?? null, item.quantity, item.unit_cost, item.markup_pct, extCost.toFixed(2), unitPrice.toFixed(4), extPrice.toFixed(2), item.sort_order ?? 0, item.id]);
        if (r.rows[0]) rows.push(r.rows[0]);
      } else {
        const bRes = await client.query<{ id: string }>(`SELECT id FROM budgets WHERE job_id=$1 LIMIT 1`, [jobId]);
        const r = await client.query(`INSERT INTO budget_items (company_id,job_id,budget_id,budget_group_id,name,cost_type,cost_code,unit,quantity,unit_cost,markup_pct,ext_cost,unit_price,ext_price,sort_order,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [req.auth.companyId, jobId, bRes.rows[0]!.id, item.budget_group_id ?? null, item.name, item.cost_type, item.cost_code ?? null, item.unit ?? null, item.quantity, item.unit_cost, item.markup_pct, extCost.toFixed(2), unitPrice.toFixed(4), extPrice.toFixed(2), item.sort_order ?? 0, req.auth.userId]);
        if (r.rows[0]) rows.push(r.rows[0]);
      }
    }
    return rows;
  });
  res.json({ data: results });
}));

budgetRouter.post('/:jobId/groups', requireRole('owner','admin','project_manager'), asyncHandler(async (req, res) => {
  const { name, sort_order } = req.body as { name: string; sort_order?: number };
  const db = createRlsClient(writePool, req.auth.companyId);
  const r = await db.query(`INSERT INTO budget_groups (company_id,job_id,name,sort_order) VALUES ($1,$2,$3,$4) RETURNING *`, [req.auth.companyId, req.params['jobId'], name, sort_order ?? 0]);
  res.status(201).json({ data: r.rows[0] });
}));
