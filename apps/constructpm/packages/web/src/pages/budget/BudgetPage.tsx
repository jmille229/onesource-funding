import { useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, Trash2, Save, Loader2, BarChart3 } from 'lucide-react';
import { api, formatCurrency, formatPct } from '../../lib/api';
import { toast } from 'sonner';

type CostType = 'material' | 'labor' | 'subcontractor' | 'equipment' | 'overhead' | 'other';

interface BudgetItem {
  id?: string;
  budget_group_id?: string | null;
  name: string;
  cost_type: CostType;
  cost_code?: string;
  unit?: string;
  quantity: number;
  unit_cost: number;
  markup_pct: number;
  ext_cost?: string;
  ext_price?: string;
  committed?: string;
  actual?: string;
  depletion_pct?: string;
  _destroy?: boolean;
  _key: string; // local-only key for React
}

const COST_TYPE_COLORS: Record<CostType, string> = {
  material: 'bg-blue-100 text-blue-700',
  labor: 'bg-green-100 text-green-700',
  subcontractor: 'bg-purple-100 text-purple-700',
  equipment: 'bg-orange-100 text-orange-700',
  overhead: 'bg-slate-100 text-slate-600',
  other: 'bg-slate-100 text-slate-600',
};

let _keyCounter = 0;
const newKey = () => `new-${++_keyCounter}`;

export function BudgetPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['budget', jobId],
    queryFn: () => api.get(`/budget/${jobId}`).then(r => r.data.data),
  });

  const { data: jobData } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/jobs/${jobId}`).then(r => r.data.data),
  });

  const [items, setItems] = useState<BudgetItem[] | null>(null);
  const [dirty, setDirty] = useState(false);

  // Initialize local state from server data once
  const serverItems: BudgetItem[] = (data?.budget_items ?? []).map((i: Record<string, unknown>) => ({
    ...i,
    quantity: Number(i['quantity']),
    unit_cost: Number(i['unit_cost']),
    markup_pct: Number(i['markup_pct']),
    _key: i['id'] as string,
  }));

  const localItems = items ?? serverItems;

  const saveMutation = useMutation({
    mutationFn: (payload: BudgetItem[]) =>
      api.put(`/budget/${jobId}/items`, { items: payload }),
    onSuccess: () => {
      toast.success('Budget saved');
      setItems(null);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['budget', jobId] });
      qc.invalidateQueries({ queryKey: ['job-summary', jobId] });
    },
    onError: () => toast.error('Failed to save budget'),
  });

  const addRow = () => {
    const newItem: BudgetItem = {
      _key: newKey(),
      name: '',
      cost_type: 'material',
      quantity: 1,
      unit_cost: 0,
      markup_pct: data?.budget?.default_markup_pct ?? 15,
    };
    setItems([...localItems, newItem]);
    setDirty(true);
  };

  const updateRow = useCallback((key: string, field: keyof BudgetItem, value: unknown) => {
    setItems(prev => {
      const base = prev ?? serverItems;
      return base.map(item =>
        item._key === key ? { ...item, [field]: value } : item
      );
    });
    setDirty(true);
  }, [serverItems]);

  const removeRow = (key: string) => {
    setItems(prev => {
      const base = prev ?? serverItems;
      return base.map(item =>
        item._key === key ? { ...item, _destroy: true } : item
      );
    });
    setDirty(true);
  };

  const handleSave = () => {
    saveMutation.mutate(localItems.map(({ _key, ...rest }) => rest as BudgetItem));
  };

  const totals = data?.totals;

  // Derived calculations for display
  const calcExt = (item: BudgetItem) => {
    const extCost = item.quantity * item.unit_cost;
    const extPrice = extCost * (1 + item.markup_pct / 100);
    return { extCost, extPrice };
  };

  if (isLoading) return (
    <div className="page max-w-full mx-auto">
      <div className="animate-pulse space-y-3">
        <div className="h-8 bg-slate-200 rounded w-1/4" />
        <div className="h-64 bg-slate-200 rounded" />
      </div>
    </div>
  );

  const visibleItems = localItems.filter(i => !i._destroy);

  return (
    <div className="page max-w-full mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/jobs/${jobId}`} className="btn-ghost btn-sm">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Budget</h1>
            <p className="text-sm text-slate-500">{jobData?.name}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={addRow} className="btn-secondary btn-sm">
            <Plus className="w-4 h-4" /> Add Line
          </button>
          <button
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            className="btn-primary btn-sm"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save
          </button>
        </div>
      </div>

      {/* Totals bar */}
      {totals && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {[
            { label: 'Budget Cost', value: formatCurrency(totals.ext_cost) },
            { label: 'Budget Price', value: formatCurrency(totals.ext_price) },
            { label: 'Gross Profit', value: formatCurrency(totals.gross_profit), sub: `${totals.margin_pct}% margin` },
            { label: 'Committed', value: formatCurrency(totals.committed) },
            { label: 'Actual', value: formatCurrency(totals.actual) },
            { label: 'Depletion', value: `${totals.depletion_pct}%` },
          ].map(({ label, value, sub }) => (
            <div key={label} className="card p-3">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-lg font-bold text-slate-900 mt-0.5">{value}</p>
              {sub && <p className="text-xs text-slate-500">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Budget table */}
      <div className="card overflow-x-auto">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="table-header w-6" />
                <th className="table-header min-w-[200px]">Description</th>
                <th className="table-header w-28">Type</th>
                <th className="table-header w-20">Code</th>
                <th className="table-header w-20">Unit</th>
                <th className="table-header w-20 text-right">Qty</th>
                <th className="table-header w-28 text-right">Unit Cost</th>
                <th className="table-header w-20 text-right">Markup %</th>
                <th className="table-header w-28 text-right">Ext Cost</th>
                <th className="table-header w-28 text-right">Ext Price</th>
                {totals && <th className="table-header w-28 text-right">Actual</th>}
                {totals && <th className="table-header w-20 text-right">Depletion</th>}
                <th className="table-header w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleItems.length === 0 ? (
                <tr>
                  <td colSpan={13} className="px-4 py-12 text-center text-slate-400">
                    <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No budget items yet. Click "Add Line" to start.
                  </td>
                </tr>
              ) : (
                visibleItems.map(item => {
                  const { extCost, extPrice } = calcExt(item);
                  const isNew = !item.id;
                  return (
                    <tr key={item._key} className={`hover:bg-slate-50 ${isNew ? 'bg-blue-50/30' : ''}`}>
                      <td className="px-2" />
                      <td className="px-2 py-1.5">
                        <input
                          className="input text-xs py-1"
                          value={item.name}
                          onChange={e => updateRow(item._key, 'name', e.target.value)}
                          placeholder="Item description"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          className="input text-xs py-1"
                          value={item.cost_type}
                          onChange={e => updateRow(item._key, 'cost_type', e.target.value)}
                        >
                          {(['material','labor','subcontractor','equipment','overhead','other'] as CostType[]).map(t => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input text-xs py-1"
                          value={item.cost_code ?? ''}
                          onChange={e => updateRow(item._key, 'cost_code', e.target.value)}
                          placeholder="03.1"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input text-xs py-1"
                          value={item.unit ?? ''}
                          onChange={e => updateRow(item._key, 'unit', e.target.value)}
                          placeholder="CY"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input text-xs py-1 text-right"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.quantity}
                          onChange={e => updateRow(item._key, 'quantity', parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input text-xs py-1 text-right"
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unit_cost}
                          onChange={e => updateRow(item._key, 'unit_cost', parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          className="input text-xs py-1 text-right"
                          type="number"
                          min="0"
                          step="0.5"
                          value={item.markup_pct}
                          onChange={e => updateRow(item._key, 'markup_pct', parseFloat(e.target.value) || 0)}
                        />
                      </td>
                      <td className="table-cell text-right font-medium">
                        {formatCurrency(extCost)}
                      </td>
                      <td className="table-cell text-right font-medium text-brand-700">
                        {formatCurrency(extPrice)}
                      </td>
                      {totals && (
                        <td className="table-cell text-right">
                          {item.actual ? formatCurrency(item.actual) : '—'}
                        </td>
                      )}
                      {totals && (
                        <td className="table-cell text-right">
                          {item.depletion_pct ? (
                            <span className={parseFloat(item.depletion_pct) > 100 ? 'text-red-600 font-semibold' : ''}>
                              {item.depletion_pct}%
                            </span>
                          ) : '—'}
                        </td>
                      )}
                      <td className="px-2">
                        <button
                          onClick={() => removeRow(item._key)}
                          className="text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {visibleItems.length > 0 && (
              <tfoot className="bg-slate-50 border-t-2 border-slate-300">
                <tr>
                  <td colSpan={8} className="px-4 py-2 text-sm font-semibold text-slate-700">Totals</td>
                  <td className="px-4 py-2 text-right text-sm font-bold">
                    {formatCurrency(visibleItems.reduce((s, i) => s + calcExt(i).extCost, 0))}
                  </td>
                  <td className="px-4 py-2 text-right text-sm font-bold text-brand-700">
                    {formatCurrency(visibleItems.reduce((s, i) => s + calcExt(i).extPrice, 0))}
                  </td>
                  {totals && <td colSpan={3} />}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {dirty && (
        <div className="fixed bottom-4 right-4 flex gap-2 items-center bg-slate-900 text-white rounded-lg px-4 py-2.5 shadow-xl text-sm">
          <span>Unsaved changes</span>
          <button onClick={handleSave} className="btn-primary btn-sm" disabled={saveMutation.isPending}>
            {saveMutation.isPending && <Loader2 className="w-3 h-3 animate-spin" />}
            Save
          </button>
        </div>
      )}
    </div>
  );
}
