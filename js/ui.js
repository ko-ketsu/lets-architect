// ui.js — 描画(DOM操作はここに集約)。SPEC.md 第4章の画面仕様を実装する。
// engine.js のロジックには依存するが、DOM の詳細は main.js からは隠蔽する。

const PARAM_META = {
  customer: { label: '顧客満足', className: 'param-customer' },
  quality: { label: '品質', className: 'param-quality' },
  budget: { label: '予算/納期', className: 'param-budget' },
  trust: { label: '信頼', className: 'param-trust' },
};
const PARAM_ORDER = ['customer', 'quality', 'budget', 'trust'];

function root() {
  return document.getElementById('app');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 本文中の glossary term を <button class="glossary-term"> でハイライトした HTML を返す。 */
function highlightGlossary(text, glossary) {
  if (!glossary || glossary.length === 0) return escapeHtml(text);
  const terms = [...glossary].filter((g) => g.term).sort((a, b) => b.term.length - a.term.length);
  const ranges = [];
  for (const g of terms) {
    let idx = 0;
    while (true) {
      const found = text.indexOf(g.term, idx);
      if (found === -1) break;
      const end = found + g.term.length;
      const overlaps = ranges.some((r) => found < r.end && end > r.start);
      if (!overlaps) ranges.push({ start: found, end, term: g.term });
      idx = found + g.term.length;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  let html = '';
  let cursor = 0;
  for (const r of ranges) {
    html += escapeHtml(text.slice(cursor, r.start));
    html += `<button type="button" class="glossary-term" data-term="${escapeHtml(r.term)}">${escapeHtml(text.slice(r.start, r.end))}</button>`;
    cursor = r.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

/** data/ 配下の相対パスを実際に fetch 可能な相対 URL に変換する。 */
function assetPath(relPath) {
  return `./data/${relPath}`;
}

/** SPEC 8.1: scene/choice ノードの image フィールドを描画する figure マークアップ。image が無ければ空文字。 */
function nodeImageHtml(image) {
  if (!image || !image.src) return '';
  const src = assetPath(image.src);
  const alt = escapeHtml(image.alt || '');
  return `
    <figure class="node-image">
      <div class="node-image-scroll">
        <img class="node-image-img" src="${escapeHtml(src)}" alt="${alt}" data-full-src="${escapeHtml(src)}" data-full-alt="${alt}">
      </div>
      ${image.caption ? `<figcaption class="node-image-caption">${escapeHtml(image.caption)}</figcaption>` : ''}
    </figure>
  `;
}

/** SPEC 9.1: portrait(立ち絵)フレームの HTML。src が無ければ空文字。 */
function portraitFrameHtml(portraitSrc, name) {
  if (!portraitSrc) return '';
  const alt = escapeHtml(`${name || ''}の立ち絵`);
  return `<div class="portrait-frame"><img class="portrait-img" src="${escapeHtml(assetPath(portraitSrc))}" alt="${alt}"></div>`;
}

function meterBarHtml(key, value) {
  const meta = PARAM_META[key];
  return `
    <div class="meter ${meta.className}" data-param="${key}">
      <span class="meter-label">${meta.label}</span>
      <span class="meter-track"><span class="meter-fill" style="width:${value}%"></span></span>
      <span class="meter-value">${value}</span>
    </div>
  `;
}

function rankLabel(rank) {
  return rank || '-';
}

/** difficulty(1〜4)を ★☆☆☆〜★★★★ の文字列にする。範囲外や未指定は空文字。 */
function difficultyStars(difficulty) {
  const n = Number(difficulty);
  if (!Number.isInteger(n) || n < 1 || n > 4) return '';
  return '★'.repeat(n) + '☆'.repeat(4 - n);
}

// ---------------------------------------------------------------------------
// タイトル画面
// ---------------------------------------------------------------------------
export function renderTitle({ onStart, onReset }) {
  root().innerHTML = `
    <div class="screen screen-title">
      <div class="title-hero">
        <h1 class="title-logo">Let's Architect!</h1>
        <p class="title-catch">設計の judgement は、体験で学べ。</p>
      </div>
      <div class="title-actions">
        <button type="button" class="btn btn-primary" data-action="start">はじめる</button>
        <button type="button" class="btn btn-ghost" data-action="reset">進捗をリセット</button>
      </div>
    </div>
  `;
  root().querySelector('[data-action="start"]').addEventListener('click', onStart);
  root().querySelector('[data-action="reset"]').addEventListener('click', () => {
    if (confirm('これまでのクリア状況・ランクをすべて削除します。よろしいですか?')) {
      onReset();
    }
  });
}

// ---------------------------------------------------------------------------
// エピソード選択画面
// ---------------------------------------------------------------------------
export function renderEpisodeSelect({ index, progress, onSelect, onBack }) {
  const seasons = index.seasons || [];
  const episodesBySeason = new Map();
  for (const ep of index.episodes || []) {
    const list = episodesBySeason.get(ep.season) || [];
    list.push(ep);
    episodesBySeason.set(ep.season, list);
  }
  for (const list of episodesBySeason.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  const seasonsHtml = seasons.map((season) => {
    const episodes = episodesBySeason.get(season.id) || [];
    const cardsHtml = episodes.map((ep) => {
      const prog = progress[ep.id];
      const badge = prog?.bestRank
        ? `<span class="badge badge-rank rank-${prog.bestRank}">${prog.bestRank}</span>`
        : '';
      return `
        <button type="button" class="episode-card" data-episode="${escapeHtml(ep.id)}">
          <div class="episode-card-head">
            <h3 class="episode-card-title">${escapeHtml(ep.title)}</h3>
            ${badge}
          </div>
          <p class="episode-card-summary">${escapeHtml(ep.summary)}</p>
          <p class="episode-card-meta">所要時間 目安 ${escapeHtml(String(ep.estimatedMinutes))} 分${difficultyStars(ep.difficulty) ? ` ・ 難易度 <span class="episode-card-difficulty" aria-label="難易度${ep.difficulty}">${difficultyStars(ep.difficulty)}</span>` : ''}</p>
        </button>
      `;
    }).join('');
    return `
      <section class="season-group">
        <h2 class="season-title">${escapeHtml(season.title)}</h2>
        <p class="season-desc">${escapeHtml(season.description || '')}</p>
        <div class="episode-list">${cardsHtml || '<p class="episode-empty">エピソード準備中です。</p>'}</div>
      </section>
    `;
  }).join('');

  root().innerHTML = `
    <div class="screen screen-select">
      <header class="select-header">
        <button type="button" class="btn btn-ghost btn-back" data-action="back">戻る</button>
        <h1 class="select-title">エピソードを選ぶ</h1>
      </header>
      <div class="select-body">${seasonsHtml}</div>
    </div>
  `;

  root().querySelector('[data-action="back"]').addEventListener('click', onBack);
  root().querySelectorAll('.episode-card').forEach((el) => {
    el.addEventListener('click', () => onSelect(el.dataset.episode));
  });
}

// ---------------------------------------------------------------------------
// プレイ画面
// ---------------------------------------------------------------------------

/**
 * プレイ画面を構築し、進行を駆動するためのハンドルを返す。
 * DOM の詳細(1行ずつ送る・フィードバックカード・用語ポップアップ)はここに閉じ込める。
 */
export function createPlayScreen(episode, { onQuit }) {
  root().innerHTML = `
    <div class="screen screen-play">
      <header class="play-header">
        <button type="button" class="btn-quit" aria-label="中断してエピソード選択に戻る">×</button>
        <h1 class="play-title">${escapeHtml(episode.title)}</h1>
        <div class="meters">
          ${PARAM_ORDER.map((key) => meterBarHtml(key, episode.params[key] ?? 50)).join('')}
        </div>
      </header>
      <main class="play-main" id="play-main"></main>
      <div class="glossary-popup" id="glossary-popup" hidden>
        <div class="glossary-popup-card">
          <p class="glossary-popup-term" id="glossary-popup-term"></p>
          <p class="glossary-popup-def" id="glossary-popup-def"></p>
          <button type="button" class="btn btn-ghost" data-action="close-glossary">閉じる</button>
        </div>
      </div>
      <div class="image-modal" id="image-modal" tabindex="-1" hidden>
        <button type="button" class="image-modal-close" aria-label="閉じる">×</button>
        <img class="image-modal-img" id="image-modal-img" src="" alt="">
      </div>
    </div>
  `;

  const main = root().querySelector('#play-main');
  const popup = root().querySelector('#glossary-popup');
  const popupTerm = root().querySelector('#glossary-popup-term');
  const popupDef = root().querySelector('#glossary-popup-def');
  const imageModal = root().querySelector('#image-modal');
  const imageModalImg = root().querySelector('#image-modal-img');

  function characterName(speaker) {
    if (speaker === 'narration') return null;
    return episode.characters?.[speaker]?.name || speaker;
  }

  function openGlossary(term) {
    const entry = (episode.glossary || []).find((g) => g.term === term);
    if (!entry) return;
    popupTerm.textContent = entry.term;
    popupDef.textContent = entry.def;
    popup.hidden = false;
  }

  function closeGlossary() {
    popup.hidden = true;
  }

  popup.addEventListener('click', (e) => {
    if (e.target === popup || e.target.dataset.action === 'close-glossary') {
      closeGlossary();
    }
  });

  function openImageModal(src, alt) {
    imageModalImg.src = src;
    imageModalImg.alt = alt || '';
    imageModal.hidden = false;
    imageModal.focus({ preventScroll: true });
  }

  function closeImageModal() {
    imageModal.hidden = true;
    imageModalImg.src = '';
  }

  // 図解の拡大モーダル: タップ(画像・背景・閉じるボタンのどこでも) or Esc で閉じる。
  imageModal.addEventListener('click', () => closeImageModal());
  imageModal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeImageModal();
  });

  main.addEventListener('click', (e) => {
    const imageEl = e.target.closest('.node-image-img');
    if (imageEl) {
      e.stopPropagation();
      openImageModal(imageEl.dataset.fullSrc, imageEl.dataset.fullAlt);
      return;
    }
    const termBtn = e.target.closest('.glossary-term');
    if (termBtn) {
      e.stopPropagation();
      openGlossary(termBtn.dataset.term);
    }
  });

  root().querySelector('.btn-quit').addEventListener('click', () => {
    if (confirm('プレイを中断してエピソード選択に戻ります。ここまでの進行は保存されません。よろしいですか?')) {
      onQuit();
    }
  });

  function updateMeters(params) {
    for (const key of PARAM_ORDER) {
      const meterEl = root().querySelector(`.meter[data-param="${key}"]`);
      if (!meterEl) continue;
      const value = params[key];
      meterEl.querySelector('.meter-fill').style.width = `${value}%`;
      meterEl.querySelector('.meter-value').textContent = value;
    }
  }

  /** speaker/line から portrait 画像パスを解決する。line.portrait が優先。 */
  function resolvePortrait(speaker, line) {
    return line?.portrait || episode.characters?.[speaker]?.portrait || null;
  }

  function renderMessageLine(speaker, text, onAdvance, advanceLabel, image, portraitSrc) {
    const name = characterName(speaker);
    main.innerHTML = `
      <div class="message-row ${portraitSrc ? 'has-portrait' : ''}">
        ${portraitFrameHtml(portraitSrc, name)}
        <div class="message-box" tabindex="0" role="button">
          ${nodeImageHtml(image)}
          ${name ? `<p class="message-speaker">${escapeHtml(name)}</p>` : ''}
          <p class="message-text ${name ? '' : 'is-narration'}">${highlightGlossary(text, episode.glossary)}</p>
          <p class="message-advance">${escapeHtml(advanceLabel || '▶ タップして続ける')}</p>
        </div>
      </div>
    `;
    const box = main.querySelector('.message-box');
    const advance = (e) => {
      // 用語ボタン・図解のクリックでは先に進めない(モーダル表示やポップアップに専念させる)。
      if (e && e.target && e.target.closest && (e.target.closest('.glossary-term') || e.target.closest('.node-image'))) return;
      onAdvance();
    };
    box.addEventListener('click', advance);
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        advance(e);
      }
    });
    box.focus({ preventScroll: true });
  }

  /** lines を1行ずつ表示し、最後の行の後に onComplete を呼ぶ。image はノード共通(scene の image)。 */
  function showLines(lines, onComplete, image) {
    let i = 0;
    const showNext = () => {
      if (i >= lines.length) {
        onComplete();
        return;
      }
      const line = lines[i];
      const isLast = i === lines.length - 1;
      i += 1;
      const portraitSrc = resolvePortrait(line.speaker, line);
      renderMessageLine(line.speaker, line.text, showNext, isLast ? '▶ 次へ' : '▶ タップして続ける', image, portraitSrc);
    };
    showNext();
  }

  function showChoice(node, onChoose) {
    // 選択肢ボタン内の用語ハイライトは行わない。<button> の中に
    // <button class="glossary-term"> を入れ子にすると HTML として不正で、
    // パーサーが外側のボタンを分断してテキストがはみ出すため。
    const optionsHtml = node.options.map((opt, i) => `
      <button type="button" class="choice-option" data-index="${i}">${escapeHtml(opt.text)}</button>
    `).join('');
    main.innerHTML = `
      <div class="choice-box">
        ${nodeImageHtml(node.image)}
        <p class="choice-prompt">${highlightGlossary(node.prompt, episode.glossary)}</p>
        <div class="choice-options">${optionsHtml}</div>
      </div>
    `;
    main.querySelectorAll('.choice-option').forEach((btn) => {
      btn.addEventListener('click', () => {
        onChoose(Number(btn.dataset.index));
      });
    });
  }

  function showFeedback(option, before, after, onNext) {
    const deltaItems = PARAM_ORDER
      .map((key) => ({ key, delta: (after[key] ?? 0) - (before[key] ?? 0) }))
      .filter((d) => d.delta !== 0)
      .map((d) => {
        const sign = d.delta > 0 ? '+' : '';
        const cls = d.delta > 0 ? 'delta-up' : 'delta-down';
        return `<span class="delta ${cls}">${sign}${d.delta} ${PARAM_META[d.key].label}</span>`;
      }).join('');

    main.innerHTML = `
      <div class="message-row has-portrait">
        ${portraitFrameHtml('portraits/aoi-dry.svg', 'アオイ先輩')}
        <div class="feedback-card" tabindex="0" role="button">
          <p class="feedback-label">アオイ先輩</p>
          <p class="feedback-text">${highlightGlossary(option.feedback || '', episode.glossary)}</p>
          <div class="feedback-deltas">${deltaItems || '<span class="delta delta-none">変化なし</span>'}</div>
          <p class="message-advance">▶ タップして続ける</p>
        </div>
      </div>
    `;
    const card = main.querySelector('.feedback-card');
    const advance = (e) => {
      if (e && e.target && e.target.closest && e.target.closest('.glossary-term')) return;
      onNext();
    };
    card.addEventListener('click', advance);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        advance(e);
      }
    });
    card.focus({ preventScroll: true });
  }

  /**
   * SPEC 3.3 拡張A: scene の effects によるパラメータ変動を明示するカード。
   * choice のフィードバックカードと同じ見た目(deltas)を流用するが、アオイのコメントは出さない。
   */
  function showSceneEffects(before, after, onNext) {
    const deltaItems = PARAM_ORDER
      .map((key) => ({ key, delta: (after[key] ?? 0) - (before[key] ?? 0) }))
      .filter((d) => d.delta !== 0)
      .map((d) => {
        const sign = d.delta > 0 ? '+' : '';
        const cls = d.delta > 0 ? 'delta-up' : 'delta-down';
        return `<span class="delta ${cls}">${sign}${d.delta} ${PARAM_META[d.key].label}</span>`;
      }).join('');

    main.innerHTML = `
      <div class="message-row">
        <div class="feedback-card" tabindex="0" role="button">
          <div class="feedback-deltas">${deltaItems || '<span class="delta delta-none">変化なし</span>'}</div>
          <p class="message-advance">▶ タップして続ける</p>
        </div>
      </div>
    `;
    const card = main.querySelector('.feedback-card');
    const advance = () => onNext();
    card.addEventListener('click', advance);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        advance();
      }
    });
    card.focus({ preventScroll: true });
  }

  function showDebrief(node, onFinish) {
    showLines(node.lines, () => {
      const pointsHtml = (node.points || []).map((p) => `<li>${highlightGlossary(p, episode.glossary)}</li>`).join('');
      main.innerHTML = `
        <div class="debrief-box">
          <h2 class="debrief-heading">持ち帰りメモ</h2>
          <ul class="debrief-points">${pointsHtml}</ul>
          <button type="button" class="btn btn-primary" data-action="finish">リザルトを見る</button>
        </div>
      `;
      main.querySelector('[data-action="finish"]').addEventListener('click', onFinish);
    });
  }

  return { updateMeters, showLines, showChoice, showFeedback, showSceneEffects, showDebrief };
}

// ---------------------------------------------------------------------------
// リザルト画面
// ---------------------------------------------------------------------------
export function renderResult({ episode, result, isNewBest, onReplay, onSelect }) {
  const barsHtml = PARAM_ORDER.map((key) => meterBarHtml(key, result.params[key])).join('');
  root().innerHTML = `
    <div class="screen screen-result">
      <h1 class="result-episode-title">${escapeHtml(episode.title)}</h1>
      <div class="result-rank rank-${result.rank}">
        <span class="result-rank-label">総合ランク</span>
        <span class="result-rank-value">${rankLabel(result.rank)}</span>
        ${isNewBest ? '<span class="result-rank-new">自己ベスト更新!</span>' : ''}
      </div>
      ${result.rank !== 'S' ? '<p class="result-replay-hint">Sルートはこの話に1本だけ。ヒアリングの選び方から見直してみよう。</p>' : ''}
      <div class="result-meters">${barsHtml}</div>
      <section class="result-debrief">
        <h2>持ち帰りメモ</h2>
        <ul class="debrief-points">${(episode.nodes.debrief?.points || []).map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
      </section>
      <div class="result-actions">
        <button type="button" class="btn btn-primary" data-action="replay">もう一度</button>
        <button type="button" class="btn btn-ghost" data-action="select">エピソード選択へ</button>
      </div>
    </div>
  `;
  root().querySelector('[data-action="replay"]').addEventListener('click', onReplay);
  root().querySelector('[data-action="select"]').addEventListener('click', onSelect);
}
