#!/usr/bin/env node
// scripts/test-finale-schema.mjs — フィナーレ(第11章 / SPEC.md 11.2)のエンジン拡張の
// 回帰テスト。test-s4-schema.mjs に倣い、インメモリの最小 finale エピソード(実データには
// 登録しない)で以下を assert する:
//   1. 終端 scene(next のない scene)が finale では許可される
//   2. 通常エピソードでは next のない scene がエラーになる(finale だけの特例であること)
//   3. 禁止フィールド(scene.effects / choice option の effects・flags・feedback /
//      episode.params・glossary / ending・debrief ノード)の検証エラー
//   4. params なしでの通しプレイ(全 choice 分岐が終端 scene に到達し、result は null)
//
// 実行: node scripts/test-finale-schema.mjs

import {
  createInitialState,
  getNode,
  applyChoice,
  advance,
  resolveNext,
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

// ---------------------------------------------------------------------------
// フィクスチャ: design/ENDING.md の幕構成をなぞる最小 finale エピソード。
// report(scene) → lastQuestion(choice、3択・全て有効で優劣なし) → silence(scene)
// → curtain(scene、next なし = 終端)。
// ---------------------------------------------------------------------------
function makeFinaleFixture() {
  return {
    id: 'test-finale-fixture',
    finale: true,
    title: 'テスト用最小フィナーレ(test-finale-schema.mjs 専用・実データ非登録)',
    summary: 'test-finale-schema.mjs 専用のインメモリフィクスチャ',
    estimatedMinutes: 1,
    characters: {
      player: { name: 'あなた', role: 'player' },
      senpai: { name: 'アオイ先輩', role: 'mentor' },
    },
    start: 'report',
    nodes: {
      report: {
        type: 'scene',
        lines: [{ speaker: 'senpai', text: '話がある。異動が決まった。' }],
        next: 'lastQuestion',
      },
      lastQuestion: {
        type: 'choice',
        prompt: '最初の一手、どうする?',
        options: [
          { text: '「絶対」の中身をSLAに翻訳しに行く', next: 'silence' },
          { text: '落ちてはいけない経路を特定しに行く', next: 'silence' },
          { text: '制約の優先順位を先に握りに行く', next: 'silence' },
        ],
      },
      silence: {
        type: 'scene',
        lines: [{ speaker: 'narration', text: '……' }],
        next: 'curtain',
      },
      curtain: {
        type: 'scene',
        lines: [{ speaker: 'narration', text: 'ここまでは、序章。' }],
        // next なし = 終端(finale のときだけ許可)。
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 1・2. 終端 scene(next なし)は finale でのみ許可される
// ---------------------------------------------------------------------------
function testTerminalSceneOnlyAllowedInFinale() {
  const finaleEpisode = makeFinaleFixture();
  const finaleErrors = validateEpisode(finaleEpisode);
  ok(
    finaleErrors.length === 0,
    `finale: 終端 scene(next なし)を含む最小フィクスチャは validateEpisode を通る(errors: ${JSON.stringify(finaleErrors)})`,
  );

  // 同じノード構造を通常エピソードとして検証すると、終端 scene がエラーになるはず。
  const nonFinale = JSON.parse(JSON.stringify(finaleEpisode));
  delete nonFinale.finale;
  nonFinale.season = 4;
  nonFinale.params = { customer: 50, quality: 50, budget: 50, trust: 50 };
  nonFinale.glossary = [];
  const nonFinaleErrors = validateEpisode(nonFinale);
  ok(
    nonFinaleErrors.some((e) => e.includes('node "curtain"') && e.includes('next must be a string or a conditional array')),
    `通常エピソードでは next のない scene がエラーになる(finale だけの特例であることの確認、errors: ${JSON.stringify(nonFinaleErrors)})`,
  );
}

// ---------------------------------------------------------------------------
// 3. 禁止フィールドの検証エラー
// ---------------------------------------------------------------------------
function testForbiddenFieldsRejected() {
  const base = makeFinaleFixture();

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.report.effects = { trust: 5 };
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('scene effects are not allowed in finale')),
      `finale: scene の effects 禁止を検出する(errors: ${JSON.stringify(errors)})`,
    );
  }

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.lastQuestion.options[0].effects = { trust: 5 };
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('effects are not allowed in finale')),
      'finale: choice option の effects 禁止を検出する',
    );
  }

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.lastQuestion.options[0].flags = ['x'];
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('flags are not allowed in finale')),
      'finale: choice option の flags 禁止を検出する',
    );
  }

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.lastQuestion.options[0].feedback = 'コメント';
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('feedback is not allowed in finale')),
      'finale: choice option の feedback 禁止を検出する',
    );
  }

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.params = { customer: 50, quality: 50, budget: 50, trust: 50 };
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('must not have "params"')),
      'finale: episode.params 禁止を検出する',
    );
  }

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.glossary = [];
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('must not have "glossary"')),
      'finale: episode.glossary 禁止を検出する',
    );
  }

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.endingX = {
      type: 'ending',
      variants: [{ default: true, lines: [{ speaker: 'narration', text: 'x' }] }],
      next: 'curtain',
    };
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('node "endingX"') && e.includes('not allowed in finale')),
      'finale: ending ノードの使用禁止を検出する',
    );
  }

  {
    const bad = JSON.parse(JSON.stringify(base));
    bad.nodes.debriefX = {
      type: 'debrief',
      lines: [{ speaker: 'narration', text: 'x' }],
      points: ['p'],
    };
    const errors = validateEpisode(bad);
    ok(
      errors.some((e) => e.includes('node "debriefX"') && e.includes('not allowed in finale')),
      'finale: debrief ノードの使用禁止を検出する',
    );
  }

  // 対照実験: フィクスチャそのものは無エラー
  {
    const errors = validateEpisode(base);
    ok(errors.length === 0, `finale: 正しいフィクスチャは無エラー(errors: ${JSON.stringify(errors)})`);
  }
}

// ---------------------------------------------------------------------------
// 4. params なしでの通しプレイ: 全 choice 分岐が終端 scene に到達し、result は null
// ---------------------------------------------------------------------------
function testPlayThroughAllBranchesReachTerminalWithoutParams() {
  const episode = makeFinaleFixture();
  ok(!('params' in episode), 'finale: フィクスチャは params を持たない');

  for (let idx = 0; idx < 3; idx++) {
    const { result, log } = playThrough(episode, () => idx);
    const last = log[log.length - 1];
    ok(
      last.nodeId === 'curtain' && last.type === 'scene',
      `playThrough(finale, option ${idx}): 終端 scene "curtain" に到達する(実際: ${JSON.stringify(last)})`,
    );
    ok(
      result === null,
      `playThrough(finale, option ${idx}): finale の通しプレイはランク処理をスキップし result が null になる`,
    );
  }

  // choice ノード自体は engine の applyChoice / resolveNext で通常どおり解決されること
  // (option に effects/flags が無くても崩れないこと)を確認する再帰総当たり。
  function enumerateTerminals(ep) {
    const terminals = [];
    function walk(state) {
      const node = getNode(ep, state.nodeId);
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
          const { state: nextState } = applyChoice(ep, state, i);
          walk(nextState);
        });
        return;
      }
      throw new Error(`unexpected node type "${node.type}"`);
    }
    walk(createInitialState(ep));
    return terminals;
  }

  const terminals = enumerateTerminals(episode);
  ok(
    terminals.length === 3 && terminals.every((t) => t === 'curtain'),
    `finale: 全3分岐が終端 scene "curtain" に到達する(実際: ${JSON.stringify(terminals)})`,
  );
}

function main() {
  console.log("Let's Architect! finale schema regression test\n");

  testTerminalSceneOnlyAllowedInFinale();
  testForbiddenFieldsRejected();
  testPlayThroughAllBranchesReachTerminalWithoutParams();

  console.log('\n----------------------------------------');
  if (failures > 0) {
    console.error(`FAILED: ${failures} assertion(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log('OK: all finale schema regression assertions passed.');
  process.exitCode = 0;
}

main();
