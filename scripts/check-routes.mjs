#!/usr/bin/env node
// check-routes.mjs — 全エピソードの全選択ルートを総当たりし、ランク分布・最善ルートを表示する。
// SPEC.md 7章 / design/SEASON2.md 参照。
//
// 使い方:
//   node scripts/check-routes.mjs                 → data/episodes/*.json すべて
//   node scripts/check-routes.mjs s2e1 s2e2        → エピソードIDを指定
//   node scripts/check-routes.mjs data/episodes/s2e1.json → ファイルパスを指定
//
// 各エピソードについて:
//   - validateEpisode でスキーマ検証(エラーがあれば即エラー終了)
//   - 全ノードを再帰的に辿り、choice ノードのすべての選択肢を総当たりして
//     debrief 到達までの全ルートを列挙(ランク・合計・選択列)
//   - ランク分布を表示
//   - assert: S ランク(合計 >= 280)のルートがちょうど1本であること
//   - assert: 最善ルートの合計が 280〜290 の範囲であること
// 上記を満たさない場合は process.exit(1)。

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  createInitialState,
  getNode,
  applyChoice,
  advance,
  applySceneEffects,
  resolveNext,
  resolveEndingVariant,
  computeTotal,
  computeRank,
  validateEpisode,
} from '../js/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const episodesDir = path.join(repoRoot, 'data', 'episodes');

function resolveTargetFiles(args) {
  if (args.length === 0) {
    return readdirSync(episodesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => path.join(episodesDir, f));
  }
  return args.map((arg) => {
    if (arg.endsWith('.json')) {
      return path.isAbsolute(arg) ? arg : path.resolve(repoRoot, arg);
    }
    // エピソードID(例: s2e1)として扱う
    return path.join(episodesDir, `${arg}.json`);
  });
}

function loadEpisode(file) {
  const raw = readFileSync(file, 'utf-8');
  return JSON.parse(raw);
}

/**
 * エピソードの全ルートを再帰的に列挙する。
 * 戻り値: [{ path: string[] (選んだ選択肢テキストの列), total, rank, flags }]
 */
function enumerateRoutes(episode) {
  const routes = [];
  const guardLimit = 200000;
  let guard = 0;

  function walk(state, choicePath) {
    guard += 1;
    if (guard > guardLimit) {
      throw new Error('enumerateRoutes: guard limit exceeded — possible infinite loop or explosion');
    }
    const node = getNode(episode, state.nodeId);
    switch (node.type) {
      case 'scene': {
        // SPEC 3.3 拡張A/B: effects を集計に含めてから条件付き next を state で解決する。
        const { state: afterEffects } = applySceneEffects(state, node);
        walk(advance(afterEffects, resolveNext(node.next, afterEffects)), choicePath);
        return;
      }
      case 'choice': {
        node.options.forEach((opt, i) => {
          const { state: nextState } = applyChoice(episode, state, i);
          walk(nextState, [...choicePath, `${state.nodeId}[${i}]:${opt.text.slice(0, 24)}`]);
        });
        return;
      }
      case 'ending': {
        const variant = resolveEndingVariant(node, state);
        walk(advance(state, resolveNext(node.next, state)), choicePath);
        return;
      }
      case 'debrief': {
        const total = computeTotal(state.params);
        routes.push({
          path: choicePath,
          total,
          rank: computeRank(total),
          flags: [...state.flags],
          params: { ...state.params },
        });
        return;
      }
      default:
        throw new Error(`enumerateRoutes: unknown node type "${node.type}" at "${state.nodeId}"`);
    }
  }

  walk(createInitialState(episode), []);
  return routes;
}

/**
 * ヒアリング(4候補から2つ)はノード上 hearing1→hearing2_* の2段階choiceで表現するため、
 * 同じ2問を「Aを先に聞く」「Bを先に聞く」の2通りの選択列で辿れる。
 * これは同一の情報収集結果(flags・total とも同一)であり、プレイヤー体験としては
 * 同じ1本のルートとみなす。そこで「S ルートちょうど1本」の判定は、
 * 選択列そのものではなく (sorted flags + total) をキーに重複排除してから数える。
 */
function dedupeKey(route) {
  return `${[...route.flags].sort().join(',')}|${route.total}`;
}

function summarize(routes) {
  const dist = { S: 0, A: 0, B: 0, C: 0 };
  for (const r of routes) dist[r.rank] += 1;
  const best = routes.reduce((a, b) => (b.total > a.total ? b : a), routes[0]);
  const sRoutes = routes.filter((r) => r.rank === 'S');

  const seen = new Map();
  for (const r of sRoutes) {
    const key = dedupeKey(r);
    if (!seen.has(key)) seen.set(key, r);
  }
  const distinctSRoutes = [...seen.values()];

  return { dist, best, sRoutes, distinctSRoutes, count: routes.length };
}

function main() {
  const args = process.argv.slice(2);
  const files = resolveTargetFiles(args);
  let hasError = false;

  for (const file of files) {
    const label = path.relative(repoRoot, file);
    console.log(`\n=== ${label} ===`);

    let episode;
    try {
      episode = loadEpisode(file);
    } catch (e) {
      console.error(`  読み込み失敗: ${e.message}`);
      hasError = true;
      continue;
    }

    const errors = validateEpisode(episode);
    if (errors.length > 0) {
      console.error('  validateEpisode エラー:');
      for (const e of errors) console.error(`    - ${e}`);
      hasError = true;
      continue;
    }

    let routes;
    try {
      routes = enumerateRoutes(episode);
    } catch (e) {
      console.error(`  ルート列挙エラー: ${e.message}`);
      hasError = true;
      continue;
    }

    const { dist, best, sRoutes, distinctSRoutes, count } = summarize(routes);

    console.log(`  総ルート数: ${count}`);
    console.log(`  ランク分布: S=${dist.S} A=${dist.A} B=${dist.B} C=${dist.C}`);
    console.log(`  最善ルート: total=${best.total} rank=${best.rank}`);
    console.log(`    params: ${JSON.stringify(best.params)}`);
    console.log(`    flags: ${best.flags.join(', ')}`);
    console.log('    選択列:');
    for (const step of best.path) console.log(`      - ${step}`);

    if (sRoutes.length > 0) {
      console.log(`  S ルート(選択列ベースで${sRoutes.length}本、うちヒアリング順序違いを除いた実質${distinctSRoutes.length}本):`);
      for (const r of sRoutes) {
        console.log(`    - total=${r.total} flags=[${r.flags.join(', ')}]`);
        for (const step of r.path) console.log(`        - ${step}`);
      }
    }

    // assert: S ルートはちょうど1本(ヒアリングの質問順序違いによる同一結果の重複は除く)
    if (distinctSRoutes.length !== 1) {
      console.error(`  [FAIL] S ルートは "ちょうど1本" である必要がありますが、実質${distinctSRoutes.length}本見つかりました。`);
      hasError = true;
    } else {
      console.log(`  [OK] S ルートはちょうど1本(選択列ベースでは${sRoutes.length}本だが、いずれもヒアリング質問の順序違いのみで同一の結果)`);
    }

    // assert: 最善ルート合計は 280〜290
    if (best.total < 280 || best.total > 290) {
      console.error(`  [FAIL] 最善ルート合計 ${best.total} は 280〜290 の範囲外です。`);
      hasError = true;
    } else {
      console.log(`  [OK] 最善ルート合計 ${best.total} は 280〜290 の範囲内`);
    }
  }

  if (hasError) {
    console.error('\ncheck-routes: 一部のエピソードで assert に失敗しました。');
    process.exit(1);
  } else {
    console.log('\ncheck-routes: すべてのエピソードで assert を満たしました。');
  }
}

main();
