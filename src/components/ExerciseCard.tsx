import { useState } from 'react';
import type { Exercise } from '../data/trainingPlan';
import type { ExerciseLog, SetEntry } from '../hooks/useWorkoutLog';
import { SetRow } from './SetRow';

interface Props {
  exercise: Exercise;
  log: ExerciseLog | undefined;
  lastLog: ExerciseLog | undefined;
  onSetChange: (setIndex: number, field: keyof SetEntry, value: string | boolean) => void;
  sessionActive: boolean;
}

export function ExerciseCard({ exercise, log, lastLog, onSetChange, sessionActive }: Props) {
  const [expanded, setExpanded] = useState(true);

  const sets = log?.sets ?? [];
  const doneSets = sets.filter(s => s.done).length;
  const allDone = doneSets === exercise.sets && doneSets > 0;

  return (
    <div
      className={[
        'rounded-xl border transition-all',
        exercise.isLegExercise ? 'border-zinc-600' : 'border-zinc-700/50',
        allDone ? 'border-green-700/50' : '',
      ].join(' ')}
    >
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-start gap-3 p-4 text-left"
      >
        {exercise.isLegExercise && (
          <span className="mt-0.5 w-2 h-2 rounded-sm bg-zinc-400 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{exercise.name}</span>
            {allDone && <span className="text-green-400 text-xs">✓ fertig</span>}
          </div>
          <div className="text-xs text-zinc-500 mt-0.5">
            {exercise.sets}× · {exercise.reps} Wdh
            {sessionActive && doneSets > 0 && !allDone && (
              <span className="ml-2 text-amber-400">{doneSets}/{exercise.sets} Sätze</span>
            )}
          </div>
          <div className="text-xs text-zinc-600 mt-1 leading-snug">{exercise.hint}</div>
        </div>
        <span className="text-zinc-600 text-xs mt-0.5">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && sessionActive && (
        <div className="px-4 pb-4 space-y-2">
          <div
            className="grid gap-2 px-3 mb-1 text-xs text-zinc-600 uppercase tracking-wide"
            style={{ gridTemplateColumns: '24px 1fr 1fr 36px' }}
          >
            <span>#</span>
            <span className="text-center">Gewicht</span>
            <span className="text-center">Wdh</span>
            <span />
          </div>
          {Array.from({ length: exercise.sets }).map((_, i) => (
            <SetRow
              key={i}
              setNumber={i + 1}
              entry={sets[i] ?? { weight: '', reps: '', done: false }}
              lastWeight={lastLog?.sets[i]?.weight}
              lastReps={lastLog?.sets[i]?.reps}
              onChange={(field, value) => onSetChange(i, field, value)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
