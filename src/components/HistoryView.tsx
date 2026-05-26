import type { WorkoutSession } from '../hooks/useWorkoutLog';
import { trainingPlan } from '../data/trainingPlan';

interface Props {
  sessions: WorkoutSession[];
  onDelete: (id: string) => void;
  onSelectSession: (workoutId: string) => void;
}

export function HistoryView({ sessions, onDelete, onSelectSession }: Props) {
  const finished = [...sessions]
    .filter(s => s.finished)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', {
      weekday: 'short',
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  };

  const totalVolume = (session: WorkoutSession): number => {
    return Object.values(session.exercises).reduce((total, ex) => {
      return total + ex.sets.reduce((s, set) => {
        const w = parseFloat(set.weight) || 0;
        const r = parseFloat(set.reps) || 0;
        return s + w * r;
      }, 0);
    }, 0);
  };

  if (finished.length === 0) {
    return (
      <div className="text-center py-16 text-zinc-600">
        <div className="text-4xl mb-3">📋</div>
        <div>Noch keine abgeschlossenen Trainings</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {finished.map(session => {
        const workout = trainingPlan.find(w => w.id === session.workoutId);
        if (!workout) return null;
        const vol = totalVolume(session);
        const exerciseCount = Object.keys(session.exercises).length;
        const setCount = Object.values(session.exercises).reduce(
          (n, ex) => n + ex.sets.filter(s => s.done).length, 0,
        );

        return (
          <div
            key={session.id}
            className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/30"
          >
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => onSelectSession(session.workoutId)}
                className="text-left flex-1"
              >
                <div className="font-semibold">{workout.title}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{formatDate(session.date)}</div>
              </button>
              <button
                onClick={() => {
                  if (confirm('Training löschen?')) onDelete(session.id);
                }}
                className="text-zinc-600 hover:text-red-400 text-sm p-1"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="bg-zinc-700/40 rounded-lg px-3 py-2 text-center">
                <div className="text-sm font-semibold">{exerciseCount}</div>
                <div className="text-xs text-zinc-500">Übungen</div>
              </div>
              <div className="bg-zinc-700/40 rounded-lg px-3 py-2 text-center">
                <div className="text-sm font-semibold">{setCount}</div>
                <div className="text-xs text-zinc-500">Sätze</div>
              </div>
              <div className="bg-zinc-700/40 rounded-lg px-3 py-2 text-center">
                <div className="text-sm font-semibold">
                  {vol > 0 ? `${Math.round(vol / 1000 * 10) / 10}t` : '—'}
                </div>
                <div className="text-xs text-zinc-500">Volumen</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
