// engine.js — ゲームエンジン(純ロジック)。
// DOM に一切触れない。ブラウザからも Node からも import できる。
// SPEC.md 第3・4章のデータスキーマ・ノード種別・ランク判定を実装する。

export const PARAM_KEYS = ['customer', 'quality', 'budget', 'trust'];

/** 0〜100 にクランプする。 */
export function clampParam(value) {
  const n = typeof value === 'number' && !Number.isNaN(value) ? value : 0;
  return Math.min(100, Math.max(0, n));
}

/** エピソードの初期ランタイム状態を作る。 */
export function createInitialState(episode) {
  const params = {};
  for (const key of PARAM_KEYS) {
    params[key] = clampParam(episode?.params?.[key] ?? 50);
  }
  return {
    nodeId: episode.start,
    params,
    flags: [],
  };
}

/** ノードを取得する。存在しない場合は例外。 */
export function getNode(episode, nodeId) {
  const node = episode?.nodes?.[nodeId];
  if (!node) {
    throw new Error(`Unknown node id: "${nodeId}"`);
  }
  return node;
}

/** effects を params に適用した新しい params を返す(クランプ済み・イミュータブル)。 */
export function applyEffects(params, effects) {
  const next = { ...params };
  if (effects) {
    for (const [key, delta] of Object.entries(effects)) {
      if (!PARAM_KEYS.includes(key)) continue;
      next[key] = clampParam((next[key] ?? 50) + delta);
    }
  }
  return next;
}

/** flags 配列に新しいフラグを重複なく追加した新しい配列を返す。 */
export function addFlags(flags, newFlags) {
  if (!newFlags || newFlags.length === 0) return flags;
  const set = new Set(flags);
  for (const f of newFlags) set.add(f);
  return Array.from(set);
}

/** 単純にノードを移動した新しい状態を返す(scene の next などに使う)。 */
export function advance(state, nextNodeId) {
  return { ...state, nodeId: nextNodeId };
}

/**
 * choice ノードで選択肢を選んだ結果を計算する。
 * 戻り値: { state: 新しいランタイム状態, option: 選ばれた選択肢オブジェクト, before: 選択前のparams }
 */
export function applyChoice(episode, state, optionIndex) {
  const node = getNode(episode, state.nodeId);
  if (node.type !== 'choice') {
    throw new Error(`applyChoice called on non-choice node: "${state.nodeId}" (type=${node.type})`);
  }
  const option = node.options?.[optionIndex];
  if (!option) {
    throw new Error(`Invalid option index ${optionIndex} for node "${state.nodeId}"`);
  }
  const before = { ...state.params };
  const params = applyEffects(state.params, option.effects);
  const flags = addFlags(state.flags, option.flags);
  const nextState = {
    ...state,
    params,
    flags,
    nodeId: option.next,
  };
  return { state: nextState, option, before };
}

/** 4パラメータの合計値。 */
export function computeTotal(params) {
  return PARAM_KEYS.reduce((sum, key) => sum + (params[key] ?? 0), 0);
}

/** 合計値からランクを判定する。S >= 280 / A >= 240 / B >= 200 / それ未満 C。 */
export function computeRank(total) {
  if (total >= 280) return 'S';
  if (total >= 240) return 'A';
  if (total >= 200) return 'B';
  return 'C';
}

/** ending ノードで条件に合う variant を選ぶ。上から順に評価し、最初に一致したものを返す。 */
export function resolveEndingVariant(node, state) {
  if (node.type !== 'ending') {
    throw new Error('resolveEndingVariant called on non-ending node');
  }
  const total = computeTotal(state.params);
  for (const variant of node.variants) {
    if (variant.default) return variant;
    const req = variant.require || {};
    let ok = true;
    if (req.flags && req.flags.length) {
      ok = req.flags.every((f) => state.flags.includes(f));
    }
    if (ok && typeof req.minTotal === 'number') {
      ok = total >= req.minTotal;
    }
    if (ok) return variant;
  }
  // 仕様上は最後が必ず default だが、データ不備に備えたフォールバック。
  return node.variants[node.variants.length - 1];
}

/** 最終結果(パラメータ・合計・ランク)を計算する。 */
export function getResult(state) {
  const total = computeTotal(state.params);
  return { params: { ...state.params }, total, rank: computeRank(total) };
}

/**
 * エピソード JSON のスキーマ・参照整合性を検証する。
 * 戻り値: エラーメッセージの配列(空配列なら妥当)。
 */
export function validateEpisode(episode) {
  const errors = [];
  if (!episode || typeof episode !== 'object') {
    return ['episode must be an object'];
  }

  const requiredTop = [
    'id', 'season', 'title', 'summary', 'estimatedMinutes',
    'characters', 'params', 'start', 'nodes', 'glossary',
  ];
  for (const key of requiredTop) {
    if (!(key in episode)) errors.push(`missing top-level field: "${key}"`);
  }

  if (episode.params && typeof episode.params === 'object') {
    for (const key of PARAM_KEYS) {
      if (typeof episode.params[key] !== 'number') {
        errors.push(`params.${key} must be a number`);
      }
    }
  }

  if (!episode.characters || typeof episode.characters !== 'object') {
    errors.push('characters must be an object');
  }

  if (!episode.nodes || typeof episode.nodes !== 'object') {
    errors.push('nodes must be an object');
    return errors; // これ以上は検証できない
  }

  const nodeIds = Object.keys(episode.nodes);
  if (nodeIds.length === 0) errors.push('nodes must not be empty');

  if (!episode.start || !episode.nodes[episode.start]) {
    errors.push(`start node "${episode.start}" not found in nodes`);
  }

  const validSpeakers = new Set([
    'narration',
    ...(episode.characters && typeof episode.characters === 'object' ? Object.keys(episode.characters) : []),
  ]);

  const checkNext = (nextId, where) => {
    if (typeof nextId !== 'string' || !episode.nodes[nextId]) {
      errors.push(`${where}: next "${nextId}" does not reference an existing node`);
    }
  };

  const checkLines = (lines, where) => {
    if (!Array.isArray(lines) || lines.length === 0) {
      errors.push(`${where}: requires non-empty lines`);
      return;
    }
    lines.forEach((line, i) => {
      if (!line || !validSpeakers.has(line.speaker)) {
        errors.push(`${where}: line[${i}] has unknown speaker "${line?.speaker}"`);
      }
      if (!line || typeof line.text !== 'string' || line.text.length === 0) {
        errors.push(`${where}: line[${i}] missing text`);
      }
    });
  };

  for (const [id, node] of Object.entries(episode.nodes)) {
    const where = `node "${id}"`;
    if (!node || !node.type) {
      errors.push(`${where}: missing type`);
      continue;
    }
    switch (node.type) {
      case 'scene': {
        checkLines(node.lines, where);
        checkNext(node.next, where);
        break;
      }
      case 'choice': {
        if (typeof node.prompt !== 'string' || node.prompt.length === 0) {
          errors.push(`${where}: choice requires prompt`);
        }
        if (!Array.isArray(node.options) || node.options.length === 0) {
          errors.push(`${where}: choice requires non-empty options`);
        } else {
          node.options.forEach((opt, i) => {
            const optWhere = `${where} option[${i}]`;
            if (!opt || typeof opt.text !== 'string' || opt.text.length === 0) {
              errors.push(`${optWhere}: missing text`);
            }
            if (opt && opt.effects) {
              for (const key of Object.keys(opt.effects)) {
                if (!PARAM_KEYS.includes(key)) {
                  errors.push(`${optWhere}: unknown effect key "${key}"`);
                }
              }
            }
            checkNext(opt?.next, optWhere);
          });
        }
        break;
      }
      case 'ending': {
        if (!Array.isArray(node.variants) || node.variants.length === 0) {
          errors.push(`${where}: ending requires non-empty variants`);
        } else {
          node.variants.forEach((v, i) => {
            checkLines(v?.lines, `${where} variant[${i}]`);
          });
          const last = node.variants[node.variants.length - 1];
          if (!last || last.default !== true) {
            errors.push(`${where}: last ending variant must have "default": true`);
          }
        }
        checkNext(node.next, where);
        break;
      }
      case 'debrief': {
        checkLines(node.lines, where);
        if (!Array.isArray(node.points) || node.points.length === 0 || node.points.length > 4) {
          errors.push(`${where}: debrief requires 1〜4 points`);
        }
        break;
      }
      default:
        errors.push(`${where}: unknown node type "${node.type}"`);
    }
  }

  if (!Array.isArray(episode.glossary)) {
    errors.push('glossary must be an array');
  } else {
    episode.glossary.forEach((g, i) => {
      if (!g || typeof g.term !== 'string' || !g.term) errors.push(`glossary[${i}] missing term`);
      if (!g || typeof g.def !== 'string' || !g.def) errors.push(`glossary[${i}] missing def`);
    });
  }

  return errors;
}

/**
 * エピソードを機械的に最初から最後(debrief到達)まで通しプレイする。
 * choice ノードでの選択を strategy で制御する。
 * strategy: 'first' | 'last' | (node) => optionIndex
 * 戻り値: { state, result, log }
 */
export function playThrough(episode, strategy = 'first') {
  let state = createInitialState(episode);
  const log = [];
  const guardLimit = 2000;
  let guard = 0;

  const pickIndex = (node) => {
    if (typeof strategy === 'function') return strategy(node);
    if (strategy === 'last') return node.options.length - 1;
    return 0;
  };

  while (guard++ < guardLimit) {
    const node = getNode(episode, state.nodeId);
    log.push({ nodeId: state.nodeId, type: node.type });

    if (node.type === 'scene') {
      state = advance(state, node.next);
    } else if (node.type === 'choice') {
      const idx = pickIndex(node);
      const { state: nextState } = applyChoice(episode, state, idx);
      state = nextState;
    } else if (node.type === 'ending') {
      const variant = resolveEndingVariant(node, state);
      log.push({ nodeId: state.nodeId, variant: variant.default ? 'default' : 'matched' });
      state = advance(state, node.next);
    } else if (node.type === 'debrief') {
      return { state, result: getResult(state), log };
    } else {
      throw new Error(`playThrough: unknown node type "${node.type}" at "${state.nodeId}"`);
    }
  }

  throw new Error('playThrough: exceeded guard limit — possible infinite loop in episode graph');
}
