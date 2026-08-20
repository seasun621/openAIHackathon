export type JudgementLabel = 'PERFECT' | 'GREAT' | 'GOOD' | 'BAD' | 'MISS';
export type NoteKind = 'tap' | 'laser' | 'swing';
export type NoteCueStage = 'prepare' | 'ready' | 'release-prepare' | 'release-ready';

export interface BaseChartNote {
  id: string;
  kind: NoteKind;
  time: number;
  lane: number;
  height: number;
}

export interface TapChartNote extends BaseChartNote {
  kind: 'tap';
}

export interface LaserChartNote extends BaseChartNote {
  kind: 'laser';
  duration: number;
  endLane: number;
  wave: number;
}

export interface SwingChartNote extends BaseChartNote {
  kind: 'swing';
  duration: number;
  side: -1 | 1;
}

export type ChartNote = TapChartNote | LaserChartNote | SwingChartNote;

export interface JudgementEvent {
  label: JudgementLabel;
  points: number;
  timingDelta: number;
  kind: NoteKind;
}

export interface NoteCueEvent {
  kind: NoteKind;
  stage: NoteCueStage;
  pan: number;
}

export interface FrameBasis {
  position: import('three').Vector3;
  tangent: import('three').Vector3;
  right: import('three').Vector3;
}
