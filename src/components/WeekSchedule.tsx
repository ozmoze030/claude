import { weekSchedule, trainingPlan } from '../data/trainingPlan';

interface Props {
  activeWorkoutId: string | null;
  onSelectWorkout: (id: string) => void;
  hasActive: (id: string) => boolean;
}

export function WeekSchedule({ activeWorkoutId, onSelectWorkout, hasActive }: Props) {
  const today = new Date().getDay();
  const dayIndex = today === 0 ? 6 : today - 1;

  return (
    <div className="grid grid-cols-7 gap-1 mb-6">
      {weekSchedule.map((entry, i) => {
        const workout = entry.workoutId
          ? trainingPlan.find(w => w.id === entry.workoutId)
          : null;
        const isToday = i === dayIndex;
        const isActive = entry.workoutId === activeWorkoutId;
        const active = entry.workoutId ? hasActive(entry.workoutId) : false;

        return (
          <div
            key={entry.day}
            onClick={() => workout && onSelectWorkout(workout.id)}
            className={[
              'rounded-lg p-2 text-center transition-all',
              workout ? 'cursor-pointer' : 'opacity-30',
              isActive ? 'bg-white text-black' : 'bg-zinc-800',
              isToday && !isActive ? 'ring-1 ring-white/40' : '',
              workout && !isActive ? 'hover:bg-zinc-700' : '',
            ].join(' ')}
          >
            <div className={`text-xs mb-1 ${isToday ? 'font-bold' : 'text-zinc-400'}`}>
              {entry.day}
            </div>
            <div className={`text-xs font-semibold leading-tight ${isActive ? 'text-black' : ''}`}>
              {workout ? (
                <>
                  {workout.title.split(' ')[0]}
                  <br />
                  {workout.title.split(' ')[1]}
                </>
              ) : '–'}
            </div>
            {active && !isActive && (
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 mx-auto mt-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}
