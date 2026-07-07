// main.js — 起動・画面遷移(ルータ相当)。
// engine.js(純ロジック)・ui.js(DOM描画)・storage.js(永続化)を束ねる。

import * as engine from './engine.js';
import * as ui from './ui.js';
import * as storage from './storage.js';

let indexData = null;
const episodeCache = new Map();
let lastResult = null; // { episodeId, episode, result, isNewBest }

async function loadIndex() {
  if (indexData) return indexData;
  const res = await fetch('./data/index.json');
  if (!res.ok) throw new Error(`failed to load data/index.json: ${res.status}`);
  indexData = await res.json();
  return indexData;
}

async function loadEpisode(id) {
  if (episodeCache.has(id)) return episodeCache.get(id);
  // SPEC 11.1: finale は index.json のトップレベル `finale` キーに載る(episodes 配列には入らない)。
  const entry = indexData.finale?.id === id
    ? indexData.finale
    : indexData.episodes.find((e) => e.id === id);
  if (!entry) throw new Error(`unknown episode id: ${id}`);
  const res = await fetch(`./data/${entry.file}`);
  if (!res.ok) throw new Error(`failed to load episode "${id}": ${res.status}`);
  const episode = await res.json();
  episodeCache.set(id, episode);
  return episode;
}

function navigate(hash) {
  if (location.hash === hash) {
    // 同じハッシュでは hashchange が発火しないので、明示的にルーティングする。
    route();
  } else {
    location.hash = hash;
  }
}

// ---------------------------------------------------------------------------
// 画面ごとの処理
// ---------------------------------------------------------------------------

function showTitleScreen() {
  ui.renderTitle({
    onStart: () => navigate('#/episodes'),
    onReset: () => {
      storage.resetProgress();
      showTitleScreen();
    },
  });
}

async function showEpisodeSelectScreen() {
  try {
    await loadIndex();
  } catch (e) {
    showErrorScreen('エピソード一覧の読み込みに失敗しました。', () => navigate('#/'));
    return;
  }
  const progress = storage.getAllProgress();

  // SPEC 11.1: フィナーレは全エピソード S 達成まで存在ごと隠す(ロック中のカードも出さない)。
  let finale = null;
  if (indexData.finale) {
    const { unlocked } = storage.getFinaleUnlockStatus(indexData.episodes, progress);
    if (unlocked) {
      finale = {
        entry: indexData.finale,
        cleared: !!progress[indexData.finale.id]?.cleared,
      };
    }
  }

  ui.renderEpisodeSelect({
    index: indexData,
    progress,
    finale,
    onSelect: (id) => navigate(`#/play/${id}`),
    onBack: () => navigate('#/'),
  });
}

async function showPlayScreen(episodeId) {
  try {
    await loadIndex();
    // SPEC 11.1: 解放前のフィナーレは直接 URL でも開けない(存在自体を隠す)。
    if (indexData.finale?.id === episodeId) {
      const { unlocked } = storage.getFinaleUnlockStatus(indexData.episodes, storage.getAllProgress());
      if (!unlocked) {
        navigate('#/episodes');
        return;
      }
    }
    const episode = await loadEpisode(episodeId);
    startEpisode(episode);
  } catch (e) {
    showErrorScreen(`エピソード "${episodeId}" の読み込みに失敗しました。`, () => navigate('#/episodes'));
  }
}

function startEpisode(episode) {
  // SPEC 11.3: finale ではヘッダーのメーターを表示せず、choice後のフィードバックカードも出さない。
  const isFinale = episode.finale === true;
  let state = engine.createInitialState(episode);
  const screen = ui.createPlayScreen(episode, {
    onQuit: () => navigate('#/episodes'),
    finale: isFinale,
  });
  if (!isFinale) screen.updateMeters(state.params);

  function runNode() {
    const node = engine.getNode(episode, state.nodeId);

    if (node.type === 'scene') {
      if (isFinale && node.next === undefined) {
        // SPEC 11.2/11.3: next のない scene は finale の終端。lines 表示後にタイトルドロップへ。
        screen.showLines(node.lines, () => {
          navigate('#/finale/title-drop');
        }, node.image);
        return;
      }
      screen.showLines(node.lines, () => {
        if (node.effects) {
          // SPEC 3.3 拡張A: lines 表示後に effects を適用し、フィードバックカードと同様の
          // 形でパラメータ増減を明示してからタップで先へ進む(アオイのコメントはなし)。
          // finale では scene effects は禁止されるため、このパスは通常エピソードのみ通る。
          const { state: afterEffects, before } = engine.applySceneEffects(state, node);
          screen.updateMeters(afterEffects.params);
          screen.showSceneEffects(before, afterEffects.params, () => {
            state = engine.advance(afterEffects, engine.resolveNext(node.next, afterEffects));
            runNode();
          });
        } else {
          state = engine.advance(state, engine.resolveNext(node.next, state));
          runNode();
        }
      }, node.image);
      return;
    }

    if (node.type === 'choice') {
      screen.showChoice(node, (optionIndex) => {
        const { state: nextState, option, before } = engine.applyChoice(episode, state, optionIndex);
        if (isFinale) {
          // SPEC 11.3: フィードバックカードを出さず、そのまま次ノードへ(演出の間はシナリオ側で作る)。
          state = nextState;
          runNode();
        } else {
          screen.updateMeters(nextState.params);
          screen.showFeedback(option, before, nextState.params, () => {
            state = nextState;
            runNode();
          });
        }
      });
      return;
    }

    if (node.type === 'ending') {
      const variant = engine.resolveEndingVariant(node, state);
      screen.showLines(variant.lines, () => {
        state = engine.advance(state, engine.resolveNext(node.next, state));
        runNode();
      });
      return;
    }

    if (node.type === 'debrief') {
      screen.showDebrief(node, () => finishEpisode(episode, state));
      return;
    }

    throw new Error(`main.js: unknown node type "${node.type}" at "${state.nodeId}"`);
  }

  runNode();
}

function finishEpisode(episode, state) {
  const result = engine.getResult(state);
  const prevBest = storage.getEpisodeProgress(episode.id)?.bestRank;
  const prevIdx = prevBest ? storage.RANK_ORDER.indexOf(prevBest) : -1;
  const newIdx = storage.RANK_ORDER.indexOf(result.rank);
  const isNewBest = newIdx > prevIdx;
  storage.recordResult(episode.id, result.rank);
  lastResult = { episodeId: episode.id, episode, result, isNewBest };
  navigate('#/result');
}

function showResultScreen() {
  if (!lastResult) {
    navigate('#/episodes');
    return;
  }
  const { episode, result, isNewBest, episodeId } = lastResult;
  ui.renderResult({
    episode,
    result,
    isNewBest,
    onReplay: () => navigate(`#/play/${episodeId}`),
    onSelect: () => navigate('#/episodes'),
  });
}

// SPEC 11.3: 終端 scene の後の専用画面(タイトルドロップ → 称号画面)。

function showFinaleTitleDropScreen() {
  ui.renderFinaleTitleDrop({
    onAdvance: () => {
      // 称号画面到達時に recordFinaleCleared() を呼ぶ(SPEC 5章/11.3)。
      storage.recordFinaleCleared();
      navigate('#/finale/credit');
    },
  });
}

function showFinaleCreditScreen() {
  ui.renderFinaleCredit({
    onBack: () => navigate('#/'),
  });
}

function showErrorScreen(message, onBack) {
  const el = document.getElementById('app');
  el.innerHTML = `
    <div class="screen screen-error">
      <p class="error-message">${message}</p>
      <button type="button" class="btn btn-primary" data-action="back">戻る</button>
    </div>
  `;
  el.querySelector('[data-action="back"]').addEventListener('click', onBack);
}

// ---------------------------------------------------------------------------
// ルーティング
// ---------------------------------------------------------------------------

function route() {
  const hash = location.hash || '#/';

  if (hash === '#/' || hash === '') {
    showTitleScreen();
    return;
  }
  if (hash === '#/episodes') {
    showEpisodeSelectScreen();
    return;
  }
  const playMatch = hash.match(/^#\/play\/(.+)$/);
  if (playMatch) {
    showPlayScreen(decodeURIComponent(playMatch[1]));
    return;
  }
  if (hash === '#/result') {
    showResultScreen();
    return;
  }
  if (hash === '#/finale/title-drop') {
    showFinaleTitleDropScreen();
    return;
  }
  if (hash === '#/finale/credit') {
    showFinaleCreditScreen();
    return;
  }
  // 不明なハッシュはタイトルへ。
  navigate('#/');
}

window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadIndex();
  } catch (e) {
    // タイトル画面自体はデータ不要なので、ここでは握りつぶして起動を継続する。
    console.warn('lets-architect: failed to preload index', e);
  }
  route();
});
