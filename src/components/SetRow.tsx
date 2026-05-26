import type { SetEntry } from '../hooks/useWorkoutLog';

interface Props {
  setNumber: number;
  entry: SetEntry;
  lastWeight?: string;
  lastReps?: string;
  onChange: (field: keyof SetEntry, value: string | boolean) => void;
}

export function SetRow({ setNumber, entry, lastWeight, lastReps, onChange }: Props) {
  return (
    <div
      className={[
        'grid gap-2 items-center py-2 px-3 rounded-lg transition-colors',
        entry.done ? 'bg-green-950/50' : 'bg-zinc-800/50',
      ].join(' ')}
      style={{ gridTemplateColumns: '24px 1fr 1fr 36px' }}
    >
      <span className="text-zinc-500 text-sm font-mono">{setNumber}</span>

      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          placeholder={lastWeight || 'kg'}
          value={entry.weight}
          onChange={e => onChange('weight', e.target.value)}
          className="w-full bg-zinc-700 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-white/30 placeholder:text-zinc-600"
        />
        {lastWeight && !entry.weight && (
          <span className="absolute inset-x-0 bottom-full mb-0.5 text-center text-xs text-zinc-600 pointer-events-none">
            {lastWeight} kg
          </span>
        )}
      </div>

      <div className="relative">
        <input
          type="number"
          inputMode="numeric"
          placeholder={lastReps || 'Wdh'}
          value={entry.reps}
          onChange={e => onChange('reps', e.target.value)}
          className="w-full bg-zinc-700 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-white/30 placeholder:text-zinc-600"
        />
        {lastReps && !entry.reps && (
          <span className="absolute inset-x-0 bottom-full mb-0.5 text-center text-xs text-zinc-600 pointer-events-none">
            {lastReps} Wdh
          </span>
        )}
      </div>

      <button
        onClick={() => onChange('done', !entry.done)}
        className={[
          'w-8 h-8 rounded-full flex items-center justify-center text-lg transition-all',
          entry.done
            ? 'bg-green-500 text-white'
            : 'bg-zinc-700 text-zinc-500 hover:bg-zinc-600',
        ].join(' ')}
      >
        {entry.done ? '✓' : '○'}
      </button>
    </div>
  );
}
