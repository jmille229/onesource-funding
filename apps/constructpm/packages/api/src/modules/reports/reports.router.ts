import { Router } from 'express';
import { readPool, createRlsClient } from '../../lib/db.js';
import { parsePagination } from '../../lib/pagination.js';
import { asyncHandler } from '../../middleware/index.js';

export const reportsRouter = Router();

// GET /api/reports/dashboard — company-wide snapshot
reportsRouter.get('/dashboard', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [jobs, invoices, bills, time] = await Promise.all([
    db.query(`SELECT status,COUNT(*) count,COALESCE(SUM(contract_amount),0) total_value FROM jobs WHERE deleted_at IS NULL GROUP BY status`),
    db.query(`SELECT status,COUNT(*) count,COALESCE(SUM(total),0) total,COALESCE(SUM(balance_due),0) balance_due FROM invoices WHERE deleted_at IS NULL GROUP BY status`),
    db.query(`SELECT status,COUNT(*) count,COALESCE(SUM(total),0) total FROM vendor_bills WHERE deleted_at IS NULL GROUP BY status`),
    db.query(`SELECT COALESCE(SUM(hours),0) hours,COALESCE(SUM(overtime_hours),0) ot_hours FROM time_entries WHERE work_date >= NOW()-INTERVAL '30 days'`),
  ]);
  res.json({
    data: {
      jobs: jobs.rows,
      invoices: invoices.rows,
      bills: bills.rows,
      time_last_30d: time.rows[0],
    },
  });
}));

// GET /api/reports/job-cost/:jobId
reportsRouter.get('/job-cost/:jobId', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(
    `SELECT bg.name group_name,bi.name item_name,bi.cost_type,bi.cost_code,
       bi.ext_cost budgeted,COALESCE(d.committed_amount,0) committed,COALESCE(d.actual_amount,0) actual,
       bi.ext_cost-COALESCE(d.actual_amount,0) cost_to_complete,
       CASE WHEN bi.ext_cost>0 THEN ROUND((COALESCE(d.actual_amount,0)/bi.ext_cost*100)::numeric,1) ELSE 0 END depletion_pct
     FROM budget_items bi LEFT JOIN budget_groups bg ON bg.id=bi.budget_group_id LEFT JOIN budget_item_depletion_summary d ON d.budget_item_id=bi.id
     WHERE bi.job_id=$1 AND bi.deleted_at IS NULL ORDER BY bg.sort_order,bi.sort_order`,
    [req.params['jobId']]
  );
  res.json({ data: r.rows });
}));

// GET /api/reports/financials — used by ReportsPage KPIs
reportsRouter.get('/financials', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const [jobs, invoices] = await Promise.all([
    db.query(`SELECT COALESCE(SUM(contract_amount) FILTER (WHERE status NOT IN ('cancelled')),0) total_contract_value FROM jobs WHERE deleted_at IS NULL`),
    db.query(`SELECT COALESCE(SUM(total),0) total_invoiced, COALESCE(SUM(balance_due) FILTER (WHERE status NOT IN ('paid','void')),0) outstanding_ar FROM invoices WHERE deleted_at IS NULL`),
  ]);
  res.json({ data: {
    total_contract_value: parseFloat(jobs.rows[0]?.['total_contract_value'] as string ?? '0'),
    total_invoiced: parseFloat(invoices.rows[0]?.['total_invoiced'] as string ?? '0'),
    outstanding_ar: parseFloat(invoices.rows[0]?.['outstanding_ar'] as string ?? '0'),
  }});
}));

// GET /api/reports/ar-aging
reportsRouter.get('/ar-aging', asyncHandler(async (req, res) => {
  const db = createRlsClient(readPool, req.auth.companyId);
  const r = await db.query(
    `SELECT c.name customer,i.invoice_number,i.issue_date,i.due_date,i.total,i.balance_due,
       CASE
         WHEN i.balance_due<=0 THEN 'paid'
         WHEN i.due_date>=CURRENT_DATE THEN 'current'
         WHEN CURRENT_DATE-i.due_date<=30 THEN '1-30'
         WHEN CURRENT_DATE-i.due_date<=60 THEN '31-60'
         WHEN CURRENT_DATE-i.due_date<=90 THEN '61-90'
         ELSE '90+'
       END aging_bucket
     FROM invoices i JOIN contacts c ON c.id=i.customer_id
     WHERE i.deleted_at IS NULL AND i.status NOT IN ('void','draft')
     ORDER BY i.due_date ASC
     LIMIT $1`,
    [parsePagination(req.query, { defaultPerPage: 1000, maxPerPage: 2000 }).limit]
  );
  res.json({ data: r.rows });
}));
