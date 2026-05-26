import { useState, useCallback } from 'react';

export interface SetEntry {
  weight: string;
  reps: string;
  done: boolean;
}

export interface ExerciseLog {
  sets: SetEntry[];
}

export interface WorkoutSession {
  id: string;
  workoutId: string;
  date: string;
  exercises: Record<string, ExerciseLog>;
  finished: boolean;
}

const STORAGE_KEY = 'workout_sessions';

function loadSessions(): WorkoutSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: WorkoutSession[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function useWorkoutLog() {
  const [sessions, setSessions] = useState<WorkoutSession[]>(loadSessions);

  const startSession = useCallback((workoutId: string): string => {
    const id = `${workoutId}-${Date.now()}`;
    const session: WorkoutSession = {
      id,
      workoutId,
      date: new Date().toISOString(),
      exercises: {},
      finished: false,
    };
    setSessions(prev => {
      const next = [...prev, session];
      saveSessions(next);
      return next;
    });
    return id;
  }, []);

  const updateSet = useCallback((
    sessionId: string,
    exerciseName: string,
    setIndex: number,
    field: keyof SetEntry,
    value: string | boolean,
  ) => {
    setSessions(prev => {
      const next = prev.map(s => {
        if (s.id !== sessionId) return s;
        const exerciseSets = s.exercises[exerciseName]?.sets ?? [];
        const updatedSets = [...exerciseSets];
        if (!updatedSets[setIndex]) {
          updatedSets[setIndex] = { weight: '', reps: '', done: false };
        }
        updatedSets[setIndex] = { ...updatedSets[setIndex], [field]: value };
        return {
          ...s,
          exercises: {
            ...s.exercises,
            [exerciseName]: { sets: updatedSets },
          },
        };
      });
      saveSessions(next);
      return next;
    });
  }, []);

  const finishSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const next = prev.map(s =>
        s.id === sessionId ? { ...s, finished: true } : s,
      );
      saveSessions(next);
      return next;
    });
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== sessionId);
      saveSessions(next);
      return next;
    });
  }, []);

  const getLastSession = useCallback(
    (workoutId: string): WorkoutSession | undefined => {
      return [...sessions]
        .filter(s => s.workoutId === workoutId && s.finished)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    },
    [sessions],
  );

  const getActiveSession = useCallback(
    (workoutId: string): WorkoutSession | undefined => {
      return sessions.find(s => s.workoutId === workoutId && !s.finished);
    },
    [sessions],
  );

  return {
    sessions,
    startSession,
    updateSet,
    finishSession,
    deleteSession,
    getLastSession,
    getActiveSession,
  };
}
