import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, ClipboardList, CheckCircle2, Circle, Clock, AlertCircle, Loader2 } from 'lucide-react';
import { api, formatDate } from '../../lib/api';
import { toast } from 'sonner';

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'blocked';

const STATUS_CONFIG: Record<TaskStatus, { icon: React.ElementType; color: string; label: string }> = {
  not_started: { icon: Circle, color: 'text-slate-400', label: 'Not Started' },
  in_progress:  { icon: Clock, color: 'text-blue-500', label: 'In Progress' },
  completed:    { icon: CheckCircle2, color: 'text-green-500', label: 'Completed' },
  blocked:      { icon: AlertCircle, color: 'text-red-500', label: 'Blocked' },
};

const STATUS_CYCLE: TaskStatus[] = ['not_started', 'in_progress', 'completed', 'blocked'];

function AddTaskModal({ jobId, onClose, onAdded }: { jobId: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api.post('/tasks', {
        job_id: jobId, name,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      });
      toast.success('Task created');
      onAdded();
      onClose();
    } catch {
      toast.error('Failed to create task');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">New Task</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Task Name *</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} autoFocus required placeholder="e.g. Foundation pour" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Start Date</label>
              <input className="input" type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="label">End Date</label>
              <input className="input" type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TasksPage() {
  const { id: jobId } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState<TaskStatus | ''>('');

  const { data: jobData } = useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.get(`/jobs/${jobId}`).then(r => r.data.data),
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['tasks', jobId],
    queryFn: () => api.get(`/tasks?job_id=${jobId}`).then(r => r.data.data),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: TaskStatus }) =>
      api.patch(`/tasks/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks', jobId] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => {
      toast.success('Task deleted');
      qc.invalidateQueries({ queryKey: ['tasks', jobId] });
    },
  });

  const tasks: Record<string, unknown>[] = data?.tasks ?? [];
  const filtered = filter ? tasks.filter(t => t['status'] === filter) : tasks;

  const cycleStatus = (task: Record<string, unknown>) => {
    const cur = task['status'] as TaskStatus;
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length]!;
    updateMutation.mutate({ id: task['id'] as string, status: next });
  };

  const stats = {
    total: tasks.length,
    completed: tasks.filter(t => t['status'] === 'completed').length,
    in_progress: tasks.filter(t => t['status'] === 'in_progress').length,
    blocked: tasks.filter(t => t['status'] === 'blocked').length,
  };

  return (
    <div className="page max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to={`/jobs/${jobId}`} className="btn-ghost btn-sm">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Tasks</h1>
            <p className="text-sm text-slate-500">{jobData?.name}</p>
          </div>
        </div>
        <button onClick={() => setShowAdd(true)} className="btn-primary btn-sm">
          <Plus className="w-4 h-4" /> Add Task
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: stats.total, onClick: () => setFilter(''), active: filter === '' },
          { label: 'In Progress', value: stats.in_progress, onClick: () => setFilter('in_progress'), active: filter === 'in_progress' },
          { label: 'Completed', value: stats.completed, onClick: () => setFilter('completed'), active: filter === 'completed' },
          { label: 'Blocked', value: stats.blocked, onClick: () => setFilter('blocked'), active: filter === 'blocked' },
        ].map(({ label, value, onClick, active }) => (
          <button
            key={label}
            onClick={onClick}
            className={`card p-3 text-left hover:border-brand-300 transition-colors ${active ? 'border-brand-500 ring-1 ring-brand-500' : ''}`}
          >
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
          </button>
        ))}
      </div>

      {/* Progress bar */}
      {stats.total > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full"
              style={{ width: `${(stats.completed / stats.total) * 100}%` }}
            />
          </div>
          <span className="text-sm text-slate-600 font-medium w-16 text-right">
            {Math.round((stats.completed / stats.total) * 100)}% done
          </span>
        </div>
      )}

      {/* Task list */}
      <div className="card divide-y divide-slate-100">
        {isLoading ? (
          <div className="p-8 text-center text-slate-400">Loading tasks...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500 font-medium">No tasks yet</p>
            <p className="text-sm text-slate-400 mt-1">Add tasks to track project progress</p>
            <button onClick={() => setShowAdd(true)} className="btn-primary btn-sm mt-4">
              <Plus className="w-4 h-4" /> Add First Task
            </button>
          </div>
        ) : (
          filtered.map(task => {
            const status = task['status'] as TaskStatus;
            const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG['not_started'];
            const Icon = cfg.icon;
            return (
              <div key={task['id'] as string} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 group">
                <button
                  onClick={() => cycleStatus(task)}
                  className={`flex-shrink-0 transition-opacity hover:opacity-70 ${cfg.color}`}
                  title={`Click to advance status`}
                >
                  <Icon className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${status === 'completed' ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                    {task['name'] as string}
                  </p>
                  {Boolean(task['start_date'] || task['end_date']) && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {task['start_date'] ? formatDate(task['start_date'] as string) : ''}
                      {task['start_date'] && task['end_date'] ? ' → ' : ''}
                      {task['end_date'] ? formatDate(task['end_date'] as string) : ''}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {Number(task['completion_pct']) > 0 && (
                    <span className="text-xs text-slate-500">{String(task['completion_pct'])}%</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    status === 'completed' ? 'bg-green-100 text-green-700' :
                    status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                    status === 'blocked' ? 'bg-red-100 text-red-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {cfg.label}
                  </span>
                  <button
                    onClick={() => deleteMutation.mutate(task['id'] as string)}
                    className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all ml-1"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {showAdd && jobId && (
        <AddTaskModal
          jobId={jobId}
          onClose={() => setShowAdd(false)}
          onAdded={() => refetch()}
        />
      )}
    </div>
  );
}
