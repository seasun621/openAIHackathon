import './style.css';
import { CHART_INFO } from './game/Chart';
import { Game } from './game/Game';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('게임 화면을 만들 위치를 찾지 못했습니다.');

root.innerHTML = `
  <div class="hud" aria-live="polite">
    <header class="hud-top">
      <div class="brand">
        <span>${CHART_INFO.label}</span>
        <strong>SWING<span>//</span>BEAT</strong>
      </div>
      <div class="metrics">
        <div><span>SCORE</span><strong id="scoreValue">0000000</strong></div>
        <div><span>ACCURACY</span><strong id="accuracyValue">100.0%</strong></div>
        <div><span>TIME</span><strong id="timerValue">1:00</strong></div>
      </div>
    </header>

    <div class="progress-track"><i id="progressFill"></i></div>
    <div id="comboValue" class="combo">0x</div>
    <div class="focus-lines" aria-hidden="true"></div>
    <div id="timingCue" class="timing-cue" aria-hidden="true"><i></i><span id="timingCueLabel">FIRE</span></div>
    <div id="reticle" class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div id="feedback" class="feedback"><strong>STANDBY</strong><span>AIM WITH MOUSE</span></div>
    <div id="impactFlash" class="impact-flash" aria-hidden="true"></div>

    <aside class="note-legend" aria-label="노트 종류">
      <span><i class="tap-dot"></i>RIGHT // TAP</span>
      <span><i class="laser-dot"></i>RIGHT // DRAG SLIDER</span>
      <span><i class="swing-dot"></i>LEFT // HOLD & RELEASE</span>
    </aside>

    <footer class="hud-bottom">
      <span class="cyan"><kbd>LMB</kbd> WEB SWING</span>
      <span class="pink"><kbd>RMB</kbd> SHOOT / DRAG</span>
      <span><kbd>MOUSE</kbd> AIM</span>
      <span><kbd>R</kbd> RESTART</span>
    </footer>
  </div>

  <section id="startOverlay" class="overlay">
    <div class="panel">
      <span id="overlayEyebrow" class="eyebrow">FIRST PLAYABLE PROTOTYPE</span>
      <h1 id="overlayTitle">SWING<br><em>//BEAT</em></h1>
      <p id="overlayCopy">
        ${CHART_INFO.artist}의 ${CHART_INFO.title} ${CHART_INFO.clip} 구간에 맞춰 도시를 질주합니다.
        붉은 노트는 오른쪽 총, 분홍 슬라이더는 마우스 드래그, 청록 앵커는 왼쪽 웹으로 처리하세요.
      </p>
      <div class="principles">
        <span>3D APPROACH NOTES</span>
        <span>OSU-LIKE DRAG SLIDERS</span>
        <span>WEB LONG NOTES</span>
        <span>60 SEC MUSIC CHART</span>
      </div>
      <div id="resultSummary" class="result-summary hidden"></div>
      <button id="startButton" type="button">프로토타입 시작</button>
      <small>실제 140 BPM 음원과 채보가 함께 재생됩니다 · ESC로 마우스 잠금 해제</small>
    </div>
  </section>
`;

try {
  new Game(root);
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `<section class="overlay"><div class="panel"><span class="eyebrow">BOOT ERROR</span><h1>시작<br><em>실패</em></h1><p>${message}</p></div></section>`;
  console.error(error);
}
