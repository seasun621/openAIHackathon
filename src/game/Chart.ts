import { CONFIG } from './config';
import type { ChartNote, LaserChartNote, SwingChartNote, TapChartNote } from './types';

export const CHART_INFO = {
  artist: 'ALEX MORGAN',
  title: 'HEAVY DUBSTEP BASS DROP',
  label: '140 BPM // MUSIC CHART 01',
  clip: '1:36–2:36',
} as const;

const beatDuration = 60 / CONFIG.bpm;
const notes: ChartNote[] = [];
let id = 0;

function atBeat(beat: number): number {
  return CONFIG.beatOffset + beat * beatDuration;
}

function tap(beat: number, lane: number, height = 0): TapChartNote {
  return { id: `tap-${id += 1}`, kind: 'tap', time: atBeat(beat), lane, height };
}

function laser(
  beat: number,
  durationBeats: number,
  lane: number,
  endLane: number,
  wave = 0,
  height = 0,
): LaserChartNote {
  return {
    id: `laser-${id += 1}`,
    kind: 'laser',
    time: atBeat(beat),
    duration: durationBeats * beatDuration,
    lane,
    endLane,
    wave,
    height,
  };
}

function swing(beat: number, durationBeats: number, side: -1 | 1): SwingChartNote {
  return {
    id: `swing-${id += 1}`,
    kind: 'swing',
    time: atBeat(beat),
    duration: durationBeats * beatDuration,
    lane: side * 7.8,
    height: 7.4,
    side,
  };
}

notes.push(
  // 1:36–1:49 / 첫 고강도 구간의 말미: 강한 킥과 스네어를 따라 기본 조준을 다시 익힌다.
  tap(4, -5.8, -2.4),
  tap(6, 0, 4.6),
  tap(8, 5.8, -1.4),
  tap(9, -3.8, 2.5),
  tap(10, 2.6, -4.2),
  laser(12, 3, -6.2, 6.2, 2.1, 0.6),
  tap(18, 6.2, 4.2),
  tap(20, -5.8, -3.8),
  tap(22, 1.2, 4.8),
  laser(24, 3, 5.8, -5.8, -2.4, -1.2),

  // 1:49–1:53 / 거의 무음에 가까운 브레이크: 긴 코너와 웹스윙 하나에 집중한다.
  swing(32, 8, -1),

  // 1:54–1:57 / 브레이크 안에서 갑자기 튀는 다섯 번의 강한 트랜지언트.
  tap(44, -6.3, 3.8),
  tap(45, -2.8, -3.7),
  tap(46, 1.2, 4.9),
  tap(47, 5.8, -2.6),
  tap(48, 0, 1.2),

  // 1:58–2:01 / 다음 상승 전의 지속음을 짧은 osu!-형 드래그로 처리한다.
  laser(52, 3, -5.6, 5.9, 2.8, 1.7),

  // 2:01–2:05 / 빌드업과 코너를 웹스윙으로 묶고 반대 손 동시 노트를 섞는다.
  swing(60, 8, 1),
  tap(62, -3.4, 4.6),
  tap(66, -6.1, -3.5),

  // 2:05–2:09 / 드롭 진입. 실제 검출 강도가 높은 68–75박을 빠른 좌우 상승 패턴으로 쓴다.
  tap(68, 5.8, 3.8),
  tap(69, 2.1, -4.1),
  tap(70, -2.2, 4.8),
  tap(72, -6.3, -2.8),
  tap(73, -1.5, 1.4),
  tap(74, 3.1, 4.7),
  tap(75, 6.2, -3.4),
  laser(76, 3, -6.3, 6.3, 3.1, 0.8),

  // 2:11–2:16 / 곡에서 가장 강한 연속 타격 구간. 한 박 간격을 중심으로 밀도를 최고점까지 올린다.
  tap(82, -5.9, 4.4),
  tap(84, 5.9, -3.7),
  tap(85, 2.5, 1.8),
  tap(86, -2.1, -4.5),
  tap(87, -6.2, 3.2),
  tap(88, 0, 5.2),
  tap(90, 6.1, -2.5),
  tap(91, 2.6, 3.8),
  tap(92, -4.8, -3.6),
  laser(94, 3, 6.1, -6.1, -2.7, 1.5),

  // 2:18–2:22 / 드롭 중반의 반복구: 상하 폭을 넓힌 규칙적인 단발 패턴.
  tap(98, -5.6, 4.9),
  tap(100, 0, -4.6),
  tap(102, 5.7, 3.9),
  tap(104, -3.2, -2.8),
  tap(106, 2.4, 5.1),
  tap(107, 6.2, -3.8),

  // 2:22–2:25 / 두 번째 큰 코너. 웹을 거는 동안 오른손으로 보조 타격을 처리한다.
  swing(108, 6, -1),
  tap(110, 2.8, 4.5),
  tap(112, 6.1, -2.7),

  // 2:25–2:30 / 후반 연타와 짧은 드래그.
  tap(114, -6.1, 3.9),
  tap(115, -2.6, -4.2),
  tap(116, 1.1, 4.8),
  tap(117, 4.4, -2.4),
  tap(118, 6.2, 2.9),
  tap(120, -5.7, -3.8),
  laser(122, 3, -5.9, 5.9, 2.4, 1.1),

  // 2:30–2:33 / 마지막 강한 프레이즈를 웹스윙과 동시 노트로 닫는다.
  swing(126, 6, 1),
  tap(128, -4.7, 4.3),
  tap(130, -0.8, -4.5),
  tap(131, 4.8, 3.4),
);

export const CHART = [...notes].sort((a, b) => a.time - b.time);
