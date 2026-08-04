import { useQuery } from '@tanstack/react-query';
import { BarChart3, TrendingUp, DollarSign, FolderKanban } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { api, formatCurrency } from '../../lib/api';

export function ReportsPage() {
  const { data: jobsData } = useQuery({
    queryKey: ['jobs-report'],
    queryFn: () => api.get('/jobs?per_page=50&status=active').then(r => r.data),
  });

  const { data: reportData } = useQuery({
    queryKey: ['report-financials'],
    queryFn: () => api.get('/reports/financials').then(r => r.data.data),
  });

  const jobs: Record<string, unknown>[] = jobsData?.data ?? [];
  const fin = reportData;

  const chartData = jobs.map(j => ({
    name: String(j['job_number'] ?? j['name']).slice(0, 12),
    Budget: Number(j['total_budget'] ?? 0),
    Spent: Number(j['total_spent'] ?? 0),
  })).filter(d => d.Budget > 0);

  const statusCounts = jobs.reduce((acc: Record<string, number>, j) => {
    const s = j['status'] as string;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page max-w-7xl mx-auto space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Reports</h1>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Active Jobs', value: statusCounts['active'] ?? 0, icon: FolderKanban, color: 'bg-blue-50 text-blue-600' },
          { label: 'Total Contract Value', value: formatCurrency(fin?.total_contract_value ?? 0), icon: DollarSign, color: 'bg-green-50 text-green-600' },
          { label: 'Total Invoiced', value: formatCurrency(fin?.total_invoiced ?? 0), icon: TrendingUp, color: 'bg-brand-50 text-brand-600' },
          { label: 'Outstanding AR', value: formatCurrency(fin?.outstanding_ar ?? 0), icon: BarChart3, color: 'bg-orange-50 text-orange-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-500">{label}</p>
                <p className="text-xl sm:text-2xl font-bold text-slate-900 mt-1 tabular-nums">{value}</p>
              </div>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Budget vs Actual chart */}
      {chartData.length > 0 && (
        <div className="card p-5">
          <h3 className="font-semibold text-slate-900 mb-4">Budget vs. Actual Cost — Active Jobs</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData} margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}K`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => formatCurrency(v)} />
              <Legend />
              <Bar dataKey="Budget" fill="#e2e8f0" radius={[3, 3, 0, 0]} />
              <Bar dataKey="Spent" fill="#2563eb" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Job status breakdown */}
      <div className="card p-5">
        <h3 className="font-semibold text-slate-900 mb-4">Jobs by Status</h3>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-4">
          {Object.entries(statusCounts).map(([status, count]) => (
            <div key={status} className="text-center">
              <p className="text-2xl sm:text-3xl font-bold text-slate-900 tabular-nums">{count}</p>
              <p className="text-xs text-slate-500 mt-1 capitalize">{status.replace('_', ' ')}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Job cost table */}
      <div className="card">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-900">Active Job Cost Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem]">
            <thead className="bg-slate-50">
              <tr>
                <th className="table-header">Job</th>
                <th className="table-header text-right">Budget Cost</th>
                <th className="table-header text-right">Actual</th>
                <th className="table-header text-right">Variance</th>
                <th className="table-header text-right">Invoiced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {jobs.length === 0 ? (
                <tr><td colSpan={5} className="table-cell text-center text-slate-400 py-8">No active jobs</td></tr>
              ) : (
                jobs.map(j => {
                  const budget = Number(j['total_budget'] ?? 0);
                  const actual = Number(j['total_spent'] ?? 0);
                  const variance = budget - actual;
                  return (
                    <tr key={j['id'] as string} className="hover:bg-slate-50">
                      <td className="table-cell">
                        <div>
                          <p className="font-medium">{j['name'] as string}</p>
                          <p className="text-xs text-slate-500">{j['job_number'] as string}</p>
                        </div>
                      </td>
                      <td className="table-cell text-right">{formatCurrency(budget)}</td>
                      <td className="table-cell text-right">{formatCurrency(actual)}</td>
                      <td className={`table-cell text-right font-medium ${variance < 0 ? 'text-red-600' : 'text-green-600'}`}>
                        {variance < 0 ? '-' : '+'}{formatCurrency(Math.abs(variance))}
                      </td>
                      <td className="table-cell text-right">{formatCurrency(j['invoiced_amount'] as number ?? 0)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
