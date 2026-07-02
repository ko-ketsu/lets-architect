// storage.js — localStorage ラッパー。SPEC.md 第5章。
// キー: lets-architect:v1
// { "episodes": { "s1e1": { "cleared": true, "bestRank": "A", "playCount": 2, "lastPlayedAt": "ISO8601" } } }

const STORAGE_KEY = 'lets-architect:v1';
export const RANK_ORDER = ['C', 'B', 'A', 'S'];

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { episodes: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { episodes: {} };
    if (!parsed.episodes || typeof parsed.episodes !== 'object') parsed.episodes = {};
    return parsed;
  } catch (e) {
    // 壊れたデータは初期状態として扱う(アプリを壊さない)。
    return { episodes: {} };
  }
}

function writeAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // localStorage が使えない環境(プライベートモード等)でも落ちないようにする。
    console.warn('lets-architect: failed to persist progress', e);
  }
}

/** 1エピソード分の進捗を取得する。未クリアなら null。 */
export function getEpisodeProgress(episodeId) {
  const data = readAll();
  return data.episodes[episodeId] || null;
}

/** 全エピソードの進捗マップを取得する。 */
export function getAllProgress() {
  return readAll().episodes;
}

/**
 * エピソードクリア結果を記録する。bestRank は既存より良い場合のみ更新。
 * 戻り値: 更新後のそのエピソードの進捗レコード。
 */
export function recordResult(episodeId, rank) {
  const data = readAll();
  const prev = data.episodes[episodeId];
  const prevRankIdx = prev ? RANK_ORDER.indexOf(prev.bestRank) : -1;
  const newRankIdx = RANK_ORDER.indexOf(rank);
  const bestRank = newRankIdx > prevRankIdx ? rank : (prev ? prev.bestRank : rank);

  const record = {
    cleared: true,
    bestRank,
    playCount: (prev?.playCount || 0) + 1,
    lastPlayedAt: new Date().toISOString(),
  };
  data.episodes[episodeId] = record;
  writeAll(data);
  return record;
}

/** 全進捗をリセットする。 */
export function resetProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('lets-architect: failed to reset progress', e);
  }
}
