export interface Exercise {
  name: string;
  sets: number;
  reps: string;
  hint: string;
  isLegExercise?: boolean;
}

export interface WorkoutDay {
  id: string;
  tag: string;
  title: string;
  muscles: string;
  exercises: Exercise[];
}

export const trainingPlan: WorkoutDay[] = [
  {
    id: 'push-a',
    tag: 'Tag 1',
    title: 'Push A',
    muscles: 'Brust · Schulter · Trizeps · Quads',
    exercises: [
      { name: 'Kniebeugen', sets: 4, reps: '6–8', hint: 'Quad-dominant · schwer, tief gehen', isLegExercise: true },
      { name: 'Bankdrücken (Flachbank)', sets: 4, reps: '6–8', hint: 'Hauptübung Brust · maximale Last' },
      { name: 'Schrägbankdrücken (Hantel)', sets: 3, reps: '8–10', hint: 'Obere Brust · andere Faser als Flachbank' },
      { name: 'Schulterdrücken (Hantel)', sets: 4, reps: '8–10', hint: 'Sitzend oder stehend' },
      { name: 'Seitheben (Hantel)', sets: 3, reps: '12–15', hint: 'Sauber, kein Schwung, volle Kontrolle' },
      { name: 'Trizeps Pushdown (Kabel)', sets: 3, reps: '10–12', hint: 'Ellbogen fixiert, Unterarm isoliert' },
    ],
  },
  {
    id: 'pull-a',
    tag: 'Tag 2',
    title: 'Pull A',
    muscles: 'Rücken · Bizeps · hintere Schulter · Hamstrings · Waden',
    exercises: [
      { name: 'Rumänisches Kreuzheben', sets: 4, reps: '8–10', hint: 'Hamstring-dominant · langsam runter, Rücken gerade', isLegExercise: true },
      { name: 'Klimmzüge', sets: 4, reps: 'Max', hint: 'Bei >10 Wdh Gewichtsgürtel · breiter Griff' },
      { name: 'Langhantelrudern', sets: 4, reps: '6–8', hint: 'Hauptübung Rücken · schwer' },
      { name: 'Kabelrudern', sets: 3, reps: '10–12', hint: 'Schulterblätter zusammenziehen am Ende' },
      { name: 'Reverse Fly (Kabel)', sets: 3, reps: '12–15', hint: 'Hintere Schulter · oft vernachlässigt' },
      { name: 'Bizeps Curl (Hantel)', sets: 3, reps: '10–12', hint: 'Supination am Ende der Bewegung' },
      { name: 'Wadenheben', sets: 4, reps: '15–20', hint: 'Volle Amplitude · oben kurz halten', isLegExercise: true },
    ],
  },
  {
    id: 'push-b',
    tag: 'Tag 3',
    title: 'Push B',
    muscles: 'Brust · Schulter · Trizeps · Quads · Gesäß',
    exercises: [
      { name: 'Hip Thrust (Langhantel)', sets: 4, reps: '8–10', hint: 'Glute-dominant · oben Becken kippen, Spannung halten', isLegExercise: true },
      { name: 'Beinpresse', sets: 3, reps: '10–12', hint: 'Quad-dominant · Füße schulterbreit mittig', isLegExercise: true },
      { name: 'Dips (Brust)', sets: 4, reps: '8–12', hint: 'Hauptübung Push B · leicht vorne lehnen für Brust' },
      { name: 'Schulterdrücken (Maschine)', sets: 3, reps: '10–12', hint: 'Variation zu Hantel · sicherer für schwere Last' },
      { name: 'Seitheben (Kabel)', sets: 3, reps: '15', hint: 'Konstante Spannung besser als Hantel' },
      { name: 'Overhead Trizeps Extension', sets: 3, reps: '10–12', hint: 'Langer Trizepskopf · EZ-Stange oder Hantel' },
    ],
  },
  {
    id: 'pull-b',
    tag: 'Tag 4',
    title: 'Pull B',
    muscles: 'Rücken · Bizeps · hintere Schulter · Hamstrings · Waden',
    exercises: [
      { name: 'Beinbeuger (Maschine)', sets: 4, reps: '12–15', hint: 'Hamstrings isoliert · langsam die exzentrische Phase', isLegExercise: true },
      { name: 'Latzug (Untergriff)', sets: 4, reps: '8–10', hint: 'Enger Griff · andere Reize als Klimmzüge' },
      { name: 'Einarmiges Hantelrudern', sets: 4, reps: '8–10', hint: 'Volle Streckung und Kontraktion · Rücken nicht rotieren' },
      { name: 'Gesichtszüge (Kabel)', sets: 3, reps: '15', hint: 'Hintere Schulter und Rotatorenmanschette · Prävention' },
      { name: 'Hammer Curl', sets: 3, reps: '10–12', hint: 'Brachialis · macht Arme optisch breiter' },
      { name: 'Wadenheben', sets: 4, reps: '15–20', hint: 'Zweites Mal die Woche · volle Amplitude', isLegExercise: true },
    ],
  },
];

export const weekSchedule = [
  { day: 'Mo', workoutId: 'push-a' },
  { day: 'Di', workoutId: 'pull-a' },
  { day: 'Mi', workoutId: null },
  { day: 'Do', workoutId: 'push-b' },
  { day: 'Fr', workoutId: 'pull-b' },
  { day: 'Sa', workoutId: null },
  { day: 'So', workoutId: null },
];
