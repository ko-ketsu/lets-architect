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
 * scene ノードの effects を state.params に適用した新しい状態を返す(SPEC 3.3 拡張A)。
 * flags・nodeId は変更しない。choice の effects と同じ規則(applyEffects に委譲)。
 * 戻り値: { state: 新しいランタイム状態, before: 適用前のparams }
 */
export function applySceneEffects(state, node) {
  const before = { ...state.params };
  const params = applyEffects(state.params, node.effects);
  return { state: { ...state, params }, before };
}

/**
 * require({ flags?, minTotal? })が state に対して満たされているかを判定する。
 * flags は全部保持、minTotal は4パラメータ合計の下限。どちらも省略可(省略時は無条件で満たす)。
 * ending variants・条件付き next(SPEC 3.3)で共用する。
 */
export function matchesRequire(require, state) {
  const req = require || {};
  if (req.flags && req.flags.length && !req.flags.every((f) => state.flags.includes(f))) {
    return false;
  }
  if (typeof req.minTotal === 'number' && computeTotal(state.params) < req.minTotal) {
    return false;
  }
  return true;
}

/**
 * 「上から順に評価し、`default: true` か require を満たす最初の要素を返す」評価ロジック。
 * ending の variants(3.3)と条件付き next の配列(3.3 拡張B)は評価規則が完全に同じなので、
 * resolveEndingVariant / resolveNext の両方からこの関数を使う。
 * 仕様上は最後が必ず default だが、データ不備に備えて見つからない場合は最後の要素を返す。
 */
export function resolveConditional(items, state) {
  for (const item of items) {
    if (item.default) return item;
    if (matchesRequire(item.require, state)) return item;
  }
  return items[items.length - 1];
}

/**
 * next フィールド(文字列 or 条件付き配列、SPEC 3.3 拡張B)を解決し、遷移先ノードIDを返す。
 * 文字列は無条件遷移(従来どおり)。配列は resolveConditional で評価した要素の `to` を返す。
 */
export function resolveNext(next, state) {
  if (typeof next === 'string') return next;
  if (Array.isArray(next)) {
    return resolveConditional(next, state).to;
  }
  throw new Error(`resolveNext: invalid next value: ${JSON.stringify(next)}`);
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
  // 条件付き next(SPEC 3.3 拡張B)はこの選択で更新された flags/params を見て解決する。
  const stateAfterEffects = { ...state, params, flags };
  const nodeId = resolveNext(option.next, stateAfterEffects);
  const nextState = { ...stateAfterEffects, nodeId };
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

/**
 * ending ノードで条件に合う variant を選ぶ。上から順に評価し、最初に一致したものを返す。
 * 評価規則は条件付き next(SPEC 3.3 拡張B)と完全に同じなので resolveConditional に委譲する。
 */
export function resolveEndingVariant(node, state) {
  if (node.type !== 'ending') {
    throw new Error('resolveEndingVariant called on non-ending node');
  }
  return resolveConditional(node.variants, state);
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
  } else {
    for (const [key, ch] of Object.entries(episode.characters)) {
      if (ch && 'portrait' in ch && typeof ch.portrait !== 'string') {
        errors.push(`characters.${key}.portrait must be a string`);
      }
    }
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

  // SPEC 3.3 拡張B: next は文字列(無条件遷移)、または条件付き配列
  // [{ require?: { flags?, minTotal? }, to }, ..., { default: true, to }] を許可する。
  const checkNext = (next, where) => {
    if (typeof next === 'string') {
      if (!episode.nodes[next]) {
        errors.push(`${where}: next "${next}" does not reference an existing node`);
      }
      return;
    }
    if (Array.isArray(next)) {
      if (next.length === 0) {
        errors.push(`${where}: conditional next must not be empty`);
        return;
      }
      next.forEach((item, i) => {
        const itemWhere = `${where} next[${i}]`;
        if (!item || typeof item !== 'object') {
          errors.push(`${itemWhere}: must be an object`);
          return;
        }
        if (typeof item.to !== 'string' || !episode.nodes[item.to]) {
          errors.push(`${itemWhere}: to "${item.to}" does not reference an existing node`);
        }
        if (item.require !== undefined) {
          if (!item.require || typeof item.require !== 'object') {
            errors.push(`${itemWhere}: require must be an object`);
          } else {
            if ('flags' in item.require && !Array.isArray(item.require.flags)) {
              errors.push(`${itemWhere}: require.flags must be an array`);
            }
            if ('minTotal' in item.require && typeof item.require.minTotal !== 'number') {
              errors.push(`${itemWhere}: require.minTotal must be a number`);
            }
          }
        }
      });
      const last = next[next.length - 1];
      if (!last || last.default !== true) {
        errors.push(`${where}: last element of conditional next must have "default": true`);
      }
      return;
    }
    errors.push(`${where}: next must be a string or a conditional array`);
  };

  // SPEC 3.3 拡張A: scene/choice の effects はキーが PARAM_KEYS のみ許可(choice と同じ規則)。
  const checkEffects = (effects, where) => {
    if (effects === undefined) return;
    if (!effects || typeof effects !== 'object') {
      errors.push(`${where}: effects must be an object`);
      return;
    }
    for (const key of Object.keys(effects)) {
      if (!PARAM_KEYS.includes(key)) {
        errors.push(`${where}: unknown effect key "${key}"`);
      }
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
      if (line && 'portrait' in line && typeof line.portrait !== 'string') {
        errors.push(`${where}: line[${i}].portrait must be a string`);
      }
    });
  };

  // SPEC 8.1: scene/choice ノードの任意フィールド image = { src, caption?, alt }
  const checkImage = (image, where) => {
    if (image === undefined) return;
    if (!image || typeof image !== 'object') {
      errors.push(`${where}: image must be an object`);
      return;
    }
    if (typeof image.src !== 'string' || image.src.length === 0) {
      errors.push(`${where}: image.src must be a non-empty string`);
    }
    if (typeof image.alt !== 'string' || image.alt.length === 0) {
      errors.push(`${where}: image.alt is required and must be a non-empty string`);
    }
    if ('caption' in image && typeof image.caption !== 'string') {
      errors.push(`${where}: image.caption must be a string`);
    }
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
        checkImage(node.image, where);
        checkEffects(node.effects, where);
        checkNext(node.next, where);
        break;
      }
      case 'choice': {
        if (typeof node.prompt !== 'string' || node.prompt.length === 0) {
          errors.push(`${where}: choice requires prompt`);
        }
        checkImage(node.image, where);
        if (!Array.isArray(node.options) || node.options.length === 0) {
          errors.push(`${where}: choice requires non-empty options`);
        } else {
          node.options.forEach((opt, i) => {
            const optWhere = `${where} option[${i}]`;
            if (!opt || typeof opt.text !== 'string' || opt.text.length === 0) {
              errors.push(`${optWhere}: missing text`);
            }
            checkEffects(opt?.effects, optWhere);
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
      // SPEC 3.3 拡張A: scene の effects を lines 表示後に適用してから next を解決する。
      const { state: afterEffects } = applySceneEffects(state, node);
      state = advance(afterEffects, resolveNext(node.next, afterEffects));
    } else if (node.type === 'choice') {
      const idx = pickIndex(node);
      const { state: nextState } = applyChoice(episode, state, idx);
      state = nextState;
    } else if (node.type === 'ending') {
      const variant = resolveEndingVariant(node, state);
      log.push({ nodeId: state.nodeId, variant: variant.default ? 'default' : 'matched' });
      state = advance(state, resolveNext(node.next, state));
    } else if (node.type === 'debrief') {
      return { state, result: getResult(state), log };
    } else {
      throw new Error(`playThrough: unknown node type "${node.type}" at "${state.nodeId}"`);
    }
  }

  throw new Error('playThrough: exceeded guard limit — possible infinite loop in episode graph');
}
