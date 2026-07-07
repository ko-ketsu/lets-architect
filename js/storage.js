// storage.js — localStorage ラッパー。SPEC.md 第5章。
// キー: lets-architect:v1
// { "episodes": { "s1e1": { "cleared": true, "bestRank": "A", "playCount": 2, "lastPlayedAt": "ISO8601" } } }
// フィナーレ(第11章)は episodes["final"] に bestRank なしで記録する(recordFinaleCleared):
// { "cleared": true, "playCount": 1, "lastPlayedAt": "ISO8601" }

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

/**
 * フィナーレ(第11章)のクリアを記録する。ランク要素が無いため bestRank は持たない
 * (SPEC 5章)。既存の recordResult はランク前提のため、finale ではこちらを使う。
 * 戻り値: 更新後の episodes["final"] レコード。
 */
export function recordFinaleCleared(episodeId = 'final') {
  const data = readAll();
  const prev = data.episodes[episodeId];
  const record = {
    cleared: true,
    playCount: (prev?.playCount || 0) + 1,
    lastPlayedAt: new Date().toISOString(),
  };
  data.episodes[episodeId] = record;
  writeAll(data);
  return record;
}

/**
 * フィナーレの解放条件(SPEC 11.1: 全エピソードの bestRank が S)を判定する。
 * storage は data/index.json を fetch しない設計のため、判定対象のエピソード一覧
 * (index.json の episodes 配列、各要素に少なくとも `id` を持つもの)を呼び出し側から渡す。
 * 戻り値: { unlocked, sCount, total }
 */
export function getFinaleUnlockStatus(episodeEntries, progress = getAllProgress()) {
  const entries = episodeEntries || [];
  const total = entries.length;
  const sCount = entries.filter((e) => progress?.[e.id]?.bestRank === 'S').length;
  return { unlocked: total > 0 && sCount === total, sCount, total };
}

/** 全進捗をリセットする。 */
export function resetProgress() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('lets-architect: failed to reset progress', e);
  }
}
