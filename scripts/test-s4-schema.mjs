#!/usr/bin/env node
// scripts/test-s4-schema.mjs — シーズン4スキーマ拡張(SPEC.md 3.3 / design/SEASON4.md「エンジン拡張」)
// の回帰テスト。インメモリの最小エピソード(実データには登録しない)で以下を assert する:
//   1. scene effects が適用・クランプされる
//   2. 条件付き next が flags / minTotal / default で正しく分岐する
//   3. validateEpisode が不正データ(to が存在しないノード / 最後が default でない /
//      不明な effects キー)を検出する
//   4. 文字列 next の後方互換
//
// 実行: node scripts/test-s4-schema.mjs

import {
  createInitialState,
  applySceneEffects,
  applyChoice,
  resolveNext,
  resolveConditional,
  playThrough,
  validateEpisode,
} from '../js/engine.js';

let failures = 0;

function ok(cond, message) {
  if (cond) {
    console.log(`✓ ${message}`);
  } else {
    failures += 1;
    console.error(`✗ ${message}`);
  }
}

function deepEqualParams(a, b) {
  return ['customer', 'quality', 'budget', 'trust'].every((k) => a[k] === b[k]);
}

// ---------------------------------------------------------------------------
// フィクスチャ: 揺さぶりイベント(scene effects)→ 条件付き next(序盤flagで展開分岐)
// → choice(条件付きnextを持つ選択肢を含む)→ ending → debrief という
// SPEC 3.3 の想定用途を素直になぞる最小エピソード。
// ---------------------------------------------------------------------------
function makeFixtureEpisode() {
  return {
    id: 'test-s4-schema-fixture',
    season: 4,
    title: 'テスト用最小エピソード(S4スキーマ回帰テスト専用・実データ非登録)',
    summary: 'test-s4-schema.mjs 専用のインメモリフィクスチャ',
    estimatedMinutes: 1,
    characters: {
      player: { name: 'あなた', role: 'player' },
      senpai: { name: 'アオイ先輩', role: 'mentor' },
    },
    params: { customer: 50, quality: 50, budget: 50, trust: 50 },
    start: 'hearing',
    nodes: {
      // 序盤: flag "asked_contract" を立てるかどうかを選ぶ choice。
      hearing: {
        type: 'choice',
        prompt: '契約条件を確認しますか?',
        options: [
          { text: '契約条件を確認する', flags: ['asked_contract'], next: 'shake' },
          { text: '確認せず進める', next: 'shake' },
        ],
      },
      // 中盤: 揺さぶりイベント。effects でパラメータを大きく削る(クランプの検証も兼ねる)。
      shake: {
        type: 'scene',
        lines: [{ speaker: 'narration', text: '予算が半分になった。' }],
        effects: { budget: -80, trust: 5 },
        // 条件付き next: 序盤に asked_contract を立てていれば被害を軽減した展開へ。
        next: [
          { require: { flags: ['asked_contract'] }, to: 'mitigated' },
          { default: true, to: 'fullDamage' },
        ],
      },
      mitigated: {
        type: 'scene',
        lines: [{ speaker: 'narration', text: '契約条件のおかげで被害を抑えられた。' }],
        next: 'reassign',
      },
      fullDamage: {
        type: 'scene',
        lines: [{ speaker: 'narration', text: '無防備に被害を受けた。' }],
        next: 'reassign',
      },
      // 終盤の choice: option 自身が条件付き next を持つケース。
      reassign: {
        type: 'choice',
        prompt: '何を守りますか?',
        options: [
          {
            text: '目的に立ち返って再仕分けする',
            flags: ['replanned'],
            next: [
              { require: { minTotal: 9999 } /* 到達不能 */, to: 'endingGood' },
              { default: true, to: 'endingGood' },
            ],
          },
          { text: '一律で削る', next: 'endingGood' },
        ],
      },
      endingGood: {
        type: 'ending',
        variants: [
          { default: true, lines: [{ speaker: 'narration', text: '結末。' }] },
        ],
        next: 'debrief',
      },
      debrief: {
        type: 'debrief',
        lines: [{ speaker: 'senpai', text: 'お疲れ様。' }],
        points: ['テストの学び'],
      },
    },
    glossary: [],
  };
}

// ---------------------------------------------------------------------------
// 1. scene effects が適用・クランプされる
// ---------------------------------------------------------------------------
function testSceneEffectsApplyAndClamp() {
  const state = { nodeId: 'x', params: { customer: 50, quality: 50, budget: 10, trust: 95 }, flags: [] };
  const node = { type: 'scene', lines: [], effects: { budget: -50, trust: 20, unknownKey: 999 } };
  const { state: after, before } = applySceneEffects(state, node);

  ok(deepEqualParams(before, state.params), 'applySceneEffects: before は適用前の params のコピー');
  ok(after.params.budget === 0, `applySceneEffects: budget は 10-50 を 0 にクランプ(実際: ${after.params.budget})`);
  ok(after.params.trust === 100, `applySceneEffects: trust は 95+20 を 100 にクランプ(実際: ${after.params.trust})`);
  ok(after.params.customer === 50, 'applySceneEffects: effects に無いキーは変化しない');
  ok(!('unknownKey' in after.params), 'applySceneEffects: PARAM_KEYS 以外のキーは無視される');
  ok(state.params.budget === 10, 'applySceneEffects: 元の state は変更されない(イミュータブル)');
}

// ---------------------------------------------------------------------------
// 2. 条件付き next が flags / minTotal / default で正しく分岐する
// ---------------------------------------------------------------------------
function testConditionalNext() {
  // flags: 全部保持していないと一致しない
  const withA = { nodeId: 'x', params: { customer: 50, quality: 50, budget: 50, trust: 50 }, flags: ['a'] };
  const nextFlagsAB = [
    { require: { flags: ['a', 'b'] }, to: 'needsAB' },
    { require: { flags: ['a'] }, to: 'needsA' },
    { default: true, to: 'fallback' },
  ];
  ok(resolveNext(nextFlagsAB, withA) === 'needsA', 'resolveNext: flags は全部保持で一致、部分一致では次の候補へ進む');

  const withNone = { ...withA, flags: [] };
  ok(resolveNext(nextFlagsAB, withNone) === 'fallback', 'resolveNext: flags が無ければ default にフォールバック');

  // minTotal: 合計の下限
  const lowTotal = { nodeId: 'x', params: { customer: 50, quality: 50, budget: 50, trust: 50 }, flags: [] }; // total=200
  const nextMinTotal = [
    { require: { minTotal: 250 }, to: 'highTotal' },
    { default: true, to: 'lowTotalPath' },
  ];
  ok(resolveNext(nextMinTotal, lowTotal) === 'lowTotalPath', 'resolveNext: minTotal 未達なら default へ');
  const highTotal = { ...lowTotal, params: { customer: 70, quality: 70, budget: 70, trust: 70 } }; // total=280
  ok(resolveNext(nextMinTotal, highTotal) === 'highTotal', 'resolveNext: minTotal 達成で一致');

  // default だけの配列
  ok(resolveNext([{ default: true, to: 'onlyDefault' }], lowTotal) === 'onlyDefault', 'resolveNext: default のみの配列も解決できる');

  // resolveConditional はオブジェクト自体を返す(next の to 以外の用途、ending variants と共有)
  const picked = resolveConditional(nextFlagsAB, withA);
  ok(picked.to === 'needsA', 'resolveConditional: next 配列に対しても一致した要素そのものを返す');
}

// ---------------------------------------------------------------------------
// 4. 文字列 next の後方互換
// ---------------------------------------------------------------------------
function testStringNextBackwardCompat() {
  const state = { nodeId: 'x', params: { customer: 50, quality: 50, budget: 50, trust: 50 }, flags: [] };
  ok(resolveNext('literalNode', state) === 'literalNode', 'resolveNext: 文字列はそのままノードIDとして返る(後方互換)');
}

// ---------------------------------------------------------------------------
// 統合テスト: フィクスチャエピソードを playThrough で通しプレイし、
// 序盤の flag が中盤の展開分岐(scene effects 適用後)に効くことを確認する。
// ---------------------------------------------------------------------------
function testFixturePlayThrough() {
  const episode = makeFixtureEpisode();
  const errors = validateEpisode(episode);
  ok(errors.length === 0, `フィクスチャは validateEpisode を通る(errors: ${JSON.stringify(errors)})`);

  // 序盤で「契約条件を確認する」(option 0)を選ぶ戦略 → mitigated 経由のはず
  const askStrategy = (node) => (node === episode.nodes.hearing ? 0 : 0);
  const { log: askLog, result: askResult } = playThrough(episode, askStrategy);
  ok(askLog.some((l) => l.nodeId === 'mitigated'), 'playThrough: asked_contract フラグありでは mitigated 経由になる');
  ok(!askLog.some((l) => l.nodeId === 'fullDamage'), 'playThrough: asked_contract フラグありでは fullDamage を通らない');
  ok(['S', 'A', 'B', 'C'].includes(askResult.rank), 'playThrough: フィクスチャは debrief に到達しランクが算出される');

  // 序盤で「確認せず進める」(option 1)を選ぶ戦略 → fullDamage 経由のはず
  const skipStrategy = (node) => (node === episode.nodes.hearing ? 1 : 0);
  const { log: skipLog } = playThrough(episode, skipStrategy);
  ok(skipLog.some((l) => l.nodeId === 'fullDamage'), 'playThrough: asked_contract フラグなしでは fullDamage 経由になる');
  ok(!skipLog.some((l) => l.nodeId === 'mitigated'), 'playThrough: asked_contract フラグなしでは mitigated を通らない');

  // choice option 自身の条件付き next(reassign)が defaultにフォールバックして endingGood まで届くこと
  ok(askLog.some((l) => l.nodeId === 'endingGood'), 'playThrough: choice option の条件付き next も解決されて ending に到達する');
}

// ---------------------------------------------------------------------------
// 3. validateEpisode が不正データを検出する
// ---------------------------------------------------------------------------
function testValidateEpisodeCatchesInvalidData() {
  const base = makeFixtureEpisode();

  // 3a. 条件付き next の to が存在しないノードを指す
  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.shake.next = [
      { require: { flags: ['asked_contract'] }, to: 'no_such_node' },
      { default: true, to: 'fullDamage' },
    ];
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('no_such_node') && e.includes('does not reference an existing node')),
      'validateEpisode: 条件付き next の to が存在しないノードを検出する',
    );
  }

  // 3b. 条件付き next の最後が default: true でない
  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.shake.next = [
      { require: { flags: ['asked_contract'] }, to: 'mitigated' },
      { require: { flags: ['never_set'] }, to: 'fullDamage' }, // 最後が default でない
    ];
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('last element of conditional next must have "default": true')),
      'validateEpisode: 条件付き next の最後が default でないことを検出する',
    );
  }

  // 3c. scene effects に不明なキー
  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.shake.effects = { budget: -80, notAParam: 10 };
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('unknown effect key "notAParam"')),
      'validateEpisode: scene effects の不明なキーを検出する',
    );
  }

  // 3d. choice option の effects に不明なキー(従来の検証が維持されていること)
  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.reassign.options[0].effects = { budget: 5, madeUpKey: -1 };
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('unknown effect key "madeUpKey"')),
      'validateEpisode: choice option effects の不明なキーも従来どおり検出する',
    );
  }

  // 3e. 対照実験: フィクスチャそのものは無エラー
  {
    const errors = validateEpisode(base);
    ok(errors.length === 0, `validateEpisode: 正しいフィクスチャは無エラー(errors: ${JSON.stringify(errors)})`);
  }

  // 3f. next が空配列
  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.shake.next = [];
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('conditional next must not be empty')),
      'validateEpisode: 条件付き next の空配列を検出する',
    );
  }

  // 3g. require.flags / require.minTotal の型不正
  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.shake.next = [
      { require: { flags: 'not-an-array' }, to: 'mitigated' },
      { default: true, to: 'fullDamage' },
    ];
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('require.flags must be an array')),
      'validateEpisode: require.flags が配列でないことを検出する',
    );
  }
}

function main() {
  console.log("Let's Architect! S4 schema regression test\n");

  testSceneEffectsApplyAndClamp();
  testConditionalNext();
  testStringNextBackwardCompat();
  testFixturePlayThrough();
  testValidateEpisodeCatchesInvalidData();

  console.log('\n----------------------------------------');
  if (failures > 0) {
    console.error(`FAILED: ${failures} assertion(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('OK: all S4 schema regression assertions passed.');
  process.exitCode = 0;
}

main();
