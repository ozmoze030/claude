import { useState } from 'react';
import { trainingPlan } from './data/trainingPlan';
import { useWorkoutLog } from './hooks/useWorkoutLog';
import { WeekSchedule } from './components/WeekSchedule';
import { WorkoutView } from './components/WorkoutView';
import { HistoryView } from './components/HistoryView';
import type { SetEntry } from './hooks/useWorkoutLog';

type Tab = 'plan' | 'history';

export default function App() {
  const [tab, setTab] = useState<Tab>('plan');
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string>(trainingPlan[0].id);

  const {
    sessions,
    startSession,
    updateSet,
    finishSession,
    deleteSession,
    getLastSession,
    getActiveSession,
  } = useWorkoutLog();

  const selectedWorkout = trainingPlan.find(w => w.id === selectedWorkoutId)!;
  const activeSession = getActiveSession(selectedWorkoutId);
  const lastSession = getLastSession(selectedWorkoutId);

  const handleSetChange = (
    exerciseName: string,
    setIndex: number,
    field: keyof SetEntry,
    value: string | boolean,
  ) => {
    if (!activeSession) return;
    updateSet(activeSession.id, exerciseName, setIndex, field, value);
  };

  return (
    <div className="max-w-lg mx-auto px-4 pb-24">
      <header className="pt-8 pb-4">
        <h1 className="text-2xl font-black tracking-tight text-white">TRAININGSPLAN</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Push / Pull · 4 Tage Split · Lean & Athletisch
        </p>
      </header>

      <WeekSchedule
        activeWorkoutId={selectedWorkoutId}
        onSelectWorkout={setSelectedWorkoutId}
        hasActive={id => !!getActiveSession(id)}
      />

      <div className="flex gap-1 mb-6 bg-zinc-800/50 p-1 rounded-xl">
        {(['plan', 'history'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={[
              'flex-1 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === t ? 'bg-white text-black' : 'text-zinc-400 hover:text-white',
            ].join(' ')}
          >
            {t === 'plan' ? 'Plan' : 'Verlauf'}
          </button>
        ))}
      </div>

      {tab === 'plan' ? (
        <WorkoutView
          workout={selectedWorkout}
          session={activeSession}
          lastSession={lastSession}
          onStart={() => startSession(selectedWorkoutId)}
          onFinish={() => activeSession && finishSession(activeSession.id)}
          onSetChange={handleSetChange}
        />
      ) : (
        <HistoryView
          sessions={sessions}
          onDelete={deleteSession}
          onSelectSession={id => {
            setSelectedWorkoutId(id);
            setTab('plan');
          }}
        />
      )}

      <nav className="fixed bottom-0 inset-x-0 bg-zinc-900/90 backdrop-blur border-t border-zinc-800">
        <div className="max-w-lg mx-auto grid grid-cols-4 gap-1 px-4 py-2">
          {trainingPlan.map(workout => {
            const hasActive = !!getActiveSession(workout.id);
            const isSelected = workout.id === selectedWorkoutId;
            return (
              <button
                key={workout.id}
                onClick={() => {
                  setSelectedWorkoutId(workout.id);
                  setTab('plan');
                }}
                className={[
                  'rounded-lg py-2 px-1 text-center transition-colors relative',
                  isSelected ? 'bg-white/10' : 'hover:bg-white/5',
                ].join(' ')}
              >
                <div className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-zinc-400'}`}>
                  {workout.title}
                </div>
                <div className="text-xs text-zinc-600 leading-tight">{workout.tag}</div>
                {hasActive && (
                  <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-green-400" />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
