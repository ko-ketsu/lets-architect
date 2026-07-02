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
  const entry = indexData.episodes.find((e) => e.id === id);
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
  ui.renderEpisodeSelect({
    index: indexData,
    progress,
    onSelect: (id) => navigate(`#/play/${id}`),
    onBack: () => navigate('#/'),
  });
}

async function showPlayScreen(episodeId) {
  try {
    await loadIndex();
    const episode = await loadEpisode(episodeId);
    startEpisode(episode);
  } catch (e) {
    showErrorScreen(`エピソード "${episodeId}" の読み込みに失敗しました。`, () => navigate('#/episodes'));
  }
}

function startEpisode(episode) {
  let state = engine.createInitialState(episode);
  const screen = ui.createPlayScreen(episode, {
    onQuit: () => navigate('#/episodes'),
  });
  screen.updateMeters(state.params);

  function runNode() {
    const node = engine.getNode(episode, state.nodeId);

    if (node.type === 'scene') {
      screen.showLines(node.lines, () => {
        state = engine.advance(state, node.next);
        runNode();
      });
      return;
    }

    if (node.type === 'choice') {
      screen.showChoice(node, (optionIndex) => {
        const { state: nextState, option, before } = engine.applyChoice(episode, state, optionIndex);
        screen.updateMeters(nextState.params);
        screen.showFeedback(option, before, nextState.params, () => {
          state = nextState;
          runNode();
        });
      });
      return;
    }

    if (node.type === 'ending') {
      const variant = engine.resolveEndingVariant(node, state);
      screen.showLines(variant.lines, () => {
        state = engine.advance(state, node.next);
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
