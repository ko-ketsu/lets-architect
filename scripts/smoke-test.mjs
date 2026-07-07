#!/usr/bin/env node
// scripts/smoke-test.mjs — Node で engine.js を通しプレイするスモークテスト。SPEC.md 第7章。
//
// 実行: node scripts/smoke-test.mjs
//
// data/index.json に列挙された各エピソードのうち「ファイルが実在するもの」だけを検証する。
// s1e2 / s1e3 のように執筆中でファイルがまだ無いものはスキップし、失敗扱いにはしない。
//
// 検証内容(SPEC.md 第7章):
//   1. エピソード JSON のスキーマ必須項目
//   2. 全ノードの next / start / ending の参照先が存在すること
//   3. 「常に最初の選択肢」「常に最後の選択肢」「常に最長の文の選択肢」で機械的に
//      通しプレイし、必ず debrief に到達しランクが算出されること。かつランクが S に
//      ならないこと(正解が位置や文の長さで機械的に当てられる状態を検出する)
//   4. エピソードが参照する image.src / portrait の実ファイルが data/ 配下に存在すること
//   5. index.json の difficulty が 1〜4 であること
//   6. final.json(第11章フィナーレ)は別枠で検証する: スキーマ(finale 必須項目・禁止
//      フィールドの不在)/ start・全 next の参照整合 / 全分岐の通しプレイで終端到達。
//      ランク assert・check-routes の対象には含めない。data/index.json に finale キーが
//      無い、または data/episodes/final.json が未作成の間は警告して skip する(T50 未完)。

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateEpisode,
  playThrough,
  createInitialState,
  getNode,
  applyChoice,
  advance,
  resolveNext,
} from '../js/engine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

let failures = 0;
let checkedEpisodes = 0;

function fail(message) {
  failures += 1;
  console.error(`✗ ${message}`);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

async function readJson(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

/** 4. エピソードが参照する image.src / portrait の実ファイルが data/ 配下に存在することを検証する。 */
function checkAssetFiles(entry, episode) {
  const refs = new Set();

  for (const [key, ch] of Object.entries(episode.characters || {})) {
    if (ch && typeof ch.portrait === 'string') refs.add(`characters.${key}.portrait\t${ch.portrait}`);
  }

  for (const [id, node] of Object.entries(episode.nodes || {})) {
    if (node.image && typeof node.image.src === 'string') {
      refs.add(`node "${id}".image.src\t${node.image.src}`);
    }
    if (Array.isArray(node.lines)) {
      node.lines.forEach((line, i) => {
        if (line && typeof line.portrait === 'string') {
          refs.add(`node "${id}".lines[${i}].portrait\t${line.portrait}`);
        }
      });
    }
    if (Array.isArray(node.variants)) {
      node.variants.forEach((v, vi) => {
        if (Array.isArray(v?.lines)) {
          v.lines.forEach((line, i) => {
            if (line && typeof line.portrait === 'string') {
              refs.add(`node "${id}".variants[${vi}].lines[${i}].portrait\t${line.portrait}`);
            }
          });
        }
      });
    }
  }

  for (const ref of refs) {
    const [where, relPath] = ref.split('\t');
    const filePath = path.join(dataDir, relPath);
    if (!existsSync(filePath)) {
      fail(`${entry.id}: ${where} references missing file "data/${relPath}"`);
    } else {
      pass(`${entry.id}: ${where} -> data/${relPath} exists`);
    }
  }
}

async function checkEpisode(entry, episodePath) {
  console.log(`\n--- ${entry.id}: ${entry.title} ---`);
  let episode;
  try {
    episode = await readJson(episodePath);
  } catch (e) {
    fail(`${entry.id}: failed to parse JSON: ${e.message}`);
    return;
  }

  // 1. スキーマ必須項目 + 2. next/start/ending の参照整合性
  const errors = validateEpisode(episode);
  if (errors.length > 0) {
    for (const err of errors) fail(`${entry.id}: ${err}`);
    return; // 構造が壊れている場合は通しプレイを試みない
  }
  pass(`${entry.id}: schema + node references are valid`);

  if (episode.id !== entry.id) {
    fail(`${entry.id}: data/index.json id "${entry.id}" does not match episode.id "${episode.id}"`);
  }

  // 4. image.src / portrait の実ファイル存在チェック
  checkAssetFiles(entry, episode);

  // 3. 常に最初 / 常に最後 / 常に最長文の選択肢で機械的に通しプレイし、debrief到達・ランク算出を確認。
  const pickLongest = (node) =>
    node.options.reduce((best, o, i, arr) => (o.text.length > arr[best].text.length ? i : best), 0);
  for (const [strategy, picker] of [['first', 'first'], ['last', 'last'], ['longest', pickLongest]]) {
    try {
      const { result, log } = playThrough(episode, picker);
      const reachedDebrief = log[log.length - 1]?.type === 'debrief';
      if (!reachedDebrief) {
        fail(`${entry.id} [${strategy}]: playthrough did not end on a debrief node`);
        continue;
      }
      if (!['S', 'A', 'B', 'C'].includes(result.rank)) {
        fail(`${entry.id} [${strategy}]: invalid rank "${result.rank}"`);
        continue;
      }
      if (result.rank === 'S') {
        fail(`${entry.id} [${strategy}]: mechanical play reached rank S — 正解が位置または文長で機械的に当てられる(SPEC 10 参照)`);
        continue;
      }
      pass(`${entry.id} [${strategy}]: reached debrief, rank=${result.rank}, total=${result.total}`);
    } catch (e) {
      fail(`${entry.id} [${strategy}]: playthrough threw: ${e.message}`);
    }
  }

  checkedEpisodes += 1;
}

/**
 * SPEC 7章6 / 11.4: フィナーレ(第11章)の全 choice 分岐を総当たりし、
 * 終端 scene(next のない scene)に到達した経路を列挙する。
 * ランク・debrief は存在しないので playThrough ではなく専用の総当たりを行う。
 */
function enumerateFinaleTerminals(episode) {
  const terminals = [];
  const guardLimit = 5000;
  let guard = 0;

  function walk(state) {
    guard += 1;
    if (guard > guardLimit) {
      throw new Error('enumerateFinaleTerminals: guard limit exceeded — possible infinite loop');
    }
    const node = getNode(episode, state.nodeId);
    if (node.type === 'scene') {
      if (node.next === undefined) {
        terminals.push(state.nodeId);
        return;
      }
      walk(advance(state, resolveNext(node.next, state)));
      return;
    }
    if (node.type === 'choice') {
      node.options.forEach((_, i) => {
        const { state: nextState } = applyChoice(episode, state, i);
        walk(nextState);
      });
      return;
    }
    throw new Error(`enumerateFinaleTerminals: unexpected node type "${node.type}" at "${state.nodeId}"`);
  }

  walk(createInitialState(episode));
  return terminals;
}

/**
 * 6. final.json(第11章フィナーレ)を別枠で検証する。
 * data/index.json に finale キーが無い、または final.json が未作成の間は警告して skip する
 * (T50: シナリオ執筆が未完のため)。ランク assert・check-routes の対象には含めない。
 */
async function checkFinale(indexData) {
  console.log('\n--- final: フィナーレ(第11章) ---');

  const finaleEntry = indexData.finale;
  if (!finaleEntry) {
    console.log('… data/index.json に finale キーがまだありません — skipped (T50 未完)');
    return;
  }

  const finalePath = path.join(dataDir, finaleEntry.file);
  if (!existsSync(finalePath)) {
    console.log(`… ${finaleEntry.file} not found — skipped (T50 未完)`);
    return;
  }

  let episode;
  try {
    episode = await readJson(finalePath);
  } catch (e) {
    fail(`final: failed to parse JSON: ${e.message}`);
    return;
  }

  if (episode.finale !== true) {
    fail('final: episode.finale must be true');
    return;
  }

  // スキーマ(finale 必須項目・禁止フィールドの不在)+ start・全 next の参照整合
  const errors = validateEpisode(episode);
  if (errors.length > 0) {
    for (const err of errors) fail(`final: ${err}`);
    return;
  }
  pass('final: schema + node references are valid (finale rules)');

  if (episode.id !== finaleEntry.id) {
    fail(`final: data/index.json finale.id "${finaleEntry.id}" does not match episode.id "${episode.id}"`);
  }

  checkAssetFiles(finaleEntry, episode);

  // 全分岐の通しプレイで終端(next のない scene)に到達することを確認する。
  try {
    const terminals = enumerateFinaleTerminals(episode);
    if (terminals.length === 0) {
      fail('final: no route reached a terminal scene (scene without next)');
    } else {
      pass(`final: all branches reached a terminal scene (${terminals.length} route(s): ${terminals.join(', ')})`);
    }
  } catch (e) {
    fail(`final: branch traversal threw: ${e.message}`);
  }
}

function printSummaryAndExit() {
  console.log('\n----------------------------------------');
  if (failures > 0) {
    console.error(`FAILED: ${failures} error(s) across ${checkedEpisodes} checked episode(s).`);
    process.exitCode = 1;
    return;
  }
  if (checkedEpisodes === 0) {
    console.error('FAILED: no episode files were found to check.');
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${checkedEpisodes} episode(s) verified with no errors.`);
  process.exitCode = 0;
}

async function main() {
  console.log("Let's Architect! smoke test\n");

  const indexPath = path.join(dataDir, 'index.json');
  let indexData;
  try {
    indexData = await readJson(indexPath);
    pass('data/index.json parses as JSON');
  } catch (e) {
    fail(`data/index.json failed to parse: ${e.message}`);
    printSummaryAndExit();
    return;
  }

  if (!Array.isArray(indexData.seasons) || indexData.seasons.length === 0) {
    fail('data/index.json: seasons must be a non-empty array');
  } else {
    pass(`data/index.json: ${indexData.seasons.length} season(s) found`);
  }

  if (!Array.isArray(indexData.episodes) || indexData.episodes.length === 0) {
    fail('data/index.json: episodes must be a non-empty array');
    printSummaryAndExit();
    return;
  }

  // 5. index.json の difficulty が 1〜4 であることを検証
  for (const entry of indexData.episodes) {
    if (![1, 2, 3, 4].includes(entry.difficulty)) {
      fail(`data/index.json: episode "${entry.id}" difficulty must be 1, 2, 3, or 4 (got ${JSON.stringify(entry.difficulty)})`);
    } else {
      pass(`data/index.json: episode "${entry.id}" difficulty=${entry.difficulty}`);
    }
  }

  for (const entry of indexData.episodes) {
    const episodePath = path.join(dataDir, entry.file);
    if (!existsSync(episodePath)) {
      console.log(`… skipping ${entry.id} (${entry.file} not written yet)`);
      continue;
    }
    await checkEpisode(entry, episodePath);
  }

  // 6. final.json(第11章)は別枠で検証する。ランク assert・check-routes の対象外。
  await checkFinale(indexData);

  printSummaryAndExit();
}

main().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exitCode = 1;
});
