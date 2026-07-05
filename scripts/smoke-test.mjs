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

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateEpisode, playThrough } from '../js/engine.js';

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

  printSummaryAndExit();
}

main().catch((e) => {
  console.error('smoke test crashed:', e);
  process.exitCode = 1;
});
