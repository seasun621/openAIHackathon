import './style.css';
import RAPIER from '@dimforge/rapier3d-compat';
import { Game } from './game/Game';
import { CONFIG } from './game/config';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('App root was not found.');
const appRoot = root;

root.innerHTML = `
  <div class="hud" aria-live="polite">
    <header class="hud-top">
      <div class="brand">
        <span>MECHANICS LAB</span>
        <strong>SWING / BLAST CORE</strong>
      </div>
      <div class="metrics">
        <div><span>VELOCITY</span><strong id="speedValue">0 km/h</strong></div>
        <div><span>ROPE</span><strong id="ropeValue">ANCHOR // SEARCH</strong></div>
        <div><span>BOMBS</span><strong id="bombValue">00</strong></div>
      </div>
    </header>

    <div id="reticle" class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div id="feedback" class="feedback">CORE READY</div>

    <footer class="hud-bottom">
      <span><kbd>WASD</kbd> MOVE</span>
      <span><kbd>SPACE</kbd> JUMP</span>
      <span class="cyan"><kbd>LMB</kbd> SWING</span>
      <span class="pink"><kbd>RMB</kbd> DETONATE</span>
      <span><kbd>R</kbd> RESET</span>
    </footer>
  </div>

  <section id="startOverlay" class="overlay">
    <div class="panel">
      <span class="eyebrow">REUSABLE WEB 3D FOUNDATION</span>
      <h1>SWING<br><em>BLAST</em></h1>
      <p>
        게임 규칙과 콘텐츠를 제거하고 스윙 물리, 절차형 3D 렌더링,
        좌우 장비 입력과 폭탄 폭발만 남긴 기술 샌드박스입니다.
      </p>
      <div class="principles">
        <span>FIXED 60 Hz PHYSICS</span>
        <span>INSTANCED CITY</span>
        <span>ASSISTED ANCHOR</span>
        <span>OCCLUDED HITSCAN</span>
      </div>
      <button id="startButton" type="button">샌드박스 시작</button>
      <small>ESC를 누르면 마우스가 해제됩니다.</small>
    </div>
  </section>
`;

async function boot(): Promise<void> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: CONFIG.gravity, z: 0 });
  new Game(appRoot, world);
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = `<section class="overlay"><div class="panel"><span class="eyebrow">BOOT ERROR</span><h1>초기화 실패</h1><p>${message}</p></div></section>`;
  console.error(error);
});
