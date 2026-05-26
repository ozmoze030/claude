import type { WorkoutDay } from '../data/trainingPlan';
import type { WorkoutSession, SetEntry } from '../hooks/useWorkoutLog';
import { ExerciseCard } from './ExerciseCard';

interface Props {
  workout: WorkoutDay;
  session: WorkoutSession | undefined;
  lastSession: WorkoutSession | undefined;
  onStart: () => void;
  onFinish: () => void;
  onSetChange: (exerciseName: string, setIndex: number, field: keyof SetEntry, value: string | boolean) => void;
}

export function WorkoutView({ workout, session, lastSession, onStart, onFinish, onSetChange }: Props) {
  const allDone = session
    ? workout.exercises.every((ex, _i) => {
        const sets = session.exercises[ex.name]?.sets ?? [];
        return sets.filter(s => s.done).length >= ex.sets;
      })
    : false;

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  return (
    <div>
      <div className="mb-4">
        <div className="text-xs text-zinc-500 uppercase tracking-widest mb-1">{workout.tag}</div>
        <h2 className="text-2xl font-bold">{workout.title}</h2>
        <div className="text-sm text-zinc-500 mt-1">{workout.muscles}</div>
        {lastSession && (
          <div className="text-xs text-zinc-600 mt-1">
            Letztes Training: {formatDate(lastSession.date)}
          </div>
        )}
      </div>

      {!session ? (
        <button
          onClick={onStart}
          className="w-full py-3 rounded-xl bg-white text-black font-semibold text-sm mb-6 hover:bg-zinc-100 active:bg-zinc-200 transition-colors"
        >
          Training starten
        </button>
      ) : (
        <div className="flex items-center justify-between mb-4 bg-zinc-800/50 rounded-xl px-4 py-3">
          <div className="text-sm">
            <span className="text-green-400 font-semibold">● Live</span>
            <span className="text-zinc-500 ml-2 text-xs">
              {new Date(session.date).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <button
            onClick={onFinish}
            className={[
              'px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors',
              allDone
                ? 'bg-green-500 text-white hover:bg-green-400'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600',
            ].join(' ')}
          >
            {allDone ? 'Abschließen ✓' : 'Beenden'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {workout.exercises.map(exercise => (
          <ExerciseCard
            key={exercise.name}
            exercise={exercise}
            log={session?.exercises[exercise.name]}
            lastLog={lastSession?.exercises[exercise.name]}
            onSetChange={(setIndex, field, value) =>
              onSetChange(exercise.name, setIndex, field, value)
            }
            sessionActive={!!session}
          />
        ))}
      </div>

      <div className="mt-6 p-4 bg-zinc-800/30 rounded-xl text-xs text-zinc-600 leading-relaxed">
        <div className="font-semibold text-zinc-500 mb-1">Core</div>
        2–3 Übungen am Ende: Plank · Hanging Leg Raises · Cable Crunches
      </div>
    </div>
  );
}
