import React, { useState, useEffect } from 'react';
import './App.css';

// スコア計算関数
function computeScore(patArr, rawParts) {
  // 分母: 漢字要素のみの数
  const hanOnly = patArr.filter(ch => /\p{Script=Han}/u.test(ch));
  const denom = hanOnly.length;
  if (denom === 0) return 0;

  // 分子: rawParts の出現回数とパターン内のマッチ数の最小値の合計
  const counts = rawParts.reduce((acc, p) => {
    acc[p] = (acc[p] || 0) + 1;
    return acc;
  }, {});
  let matches = 0;
  Object.entries(counts).forEach(([part, cnt]) => {
    const have = patArr.reduce((n, x) => (x === part ? n + 1 : n), 0);
    matches += Math.min(cnt, have);
  });

  const matchRate = (matches / denom) * 100;

  // 順序ボーナス: 先頭から rawParts が完全一致する場合 +50
  let bonus = 0;
  if (
    patArr.length >= rawParts.length &&
    rawParts.every((p, i) => patArr[i] === p)
  ) {
    bonus = 50;
  }

  return matchRate + bonus;
}

function App() {
  const [directMap, setDirectMap] = useState({});
  const [patternMap, setPatternMap] = useState({});
  const [variantsMap, setVariantsMap] = useState({});
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState(''); // 検索実行時の固定クエリ
  const [mode, setMode] = useState('part2char');
  const [result, setResult] = useState([]);
  const [page, setPage] = useState(1);

  const MAX_DISPLAY = 100;

  // 検索実行
  const handleSearch = () => {
    setQuery(inputValue.trim());
    setPage(1);
  };
  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  // データロード
  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    async function loadData() {
      try {
        const [direct, vdata] = await Promise.all([
          fetch(`${base}/direct_decomp.json`).then(r => r.json()),
          fetch(`${base}/variants.json`).then(r => r.json())
        ]);
        setDirectMap(direct);
        setVariantsMap(vdata.byBase || {});

        const merged = {};
        for (let i = 1; i <= 20; i++) {
          const idx = String(i).padStart(2, '0');
          const chunk = await fetch(
            `${base}/pattern_chunks/pattern_decomp_${idx}.json`
          ).then(r => r.json());
          Object.assign(merged, chunk);
        }
        setPatternMap(merged);
      } catch (err) {
        console.error('データ読み込みエラー:', err);
      }
    }
    loadData();
  }, []);

  // 検索ロジック + スコアソート
  useEffect(() => {
    if (!query) { setResult([]); return; }
    const rawParts = Array.from(query).filter(ch => /\p{Script=Han}/u.test(ch));
    if (!rawParts.length) { setResult([]); return; }

    let candidates = [];
    if (mode === 'part2char') {
      const needCounts = rawParts.reduce((acc, p) => { acc[p] = (acc[p] || 0) + 1; return acc; }, {});
      const found = new Set();
      Object.entries(patternMap).forEach(([kanji, patterns]) => {
        for (const patArr of patterns) {
          let ok = true;
          for (const [part, cnt] of Object.entries(needCounts)) {
            const have = patArr.reduce((n, x) => x === part ? n + 1 : n, 0);
            if (have < cnt) { ok = false; break; }
          }
          if (ok) { found.add(kanji); break; }
        }
      });
      // 単一部品なら自体も含む
      if (rawParts.length === 1) found.add(rawParts[0]);
      candidates = Array.from(found);

    } else {
      const target = query[0];
      const parts = directMap[target] || [];
      candidates = [target, ...parts];
    }

    // スコア計算してソート
    const scored = candidates.map(kanji => {
      const patterns = patternMap[kanji] || [];
      let best = 0;
      patterns.forEach(patArr => {
        const score = computeScore(patArr, rawParts);
        if (score > best) best = score;
      });
      return { kanji, score: best };
    });
    scored.sort((a, b) => b.score - a.score);

    setResult(scored.map(item => item.kanji));
  }, [query, mode, patternMap, directMap]);

  // ページネーション
  const visibleResults = mode === 'part2char'
    ? result.slice(0, page * MAX_DISPLAY)
    : result;
  const remaining = mode === 'part2char'
    ? result.length - visibleResults.length
    : 0;

  return (
    <div className="app-container">
      <h1 className="header">漢字分解・組み立て検索</h1>
      <div className="controls">
        <div className="modes">
          <label>
            <input type="radio" name="mode" value="part2char"
              checked={mode === 'part2char'} onChange={() => setMode('part2char')} />
            部品 → 漢字
          </label>
          <label>
            <input type="radio" name="mode" value="char2part"
              checked={mode === 'char2part'} onChange={() => setMode('char2part')} />
            漢字 → 部品
          </label>
        </div>
        <div className="search-box">
          <input
            className="search-input"
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'part2char' ? '部品を連続入力 例: 口口品' : '漢字を入力'}
          />
          <button className="search-button" onClick={handleSearch}>検索</button>
          {query && <span className="search-info">検索ワード: {query}</span>}
        </div>
      </div>
      <div className="result-section">
        {mode === 'char2part' ? (
          <ul className="result-list">
            {visibleResults.length > 0
              ? visibleResults.map((c, i) => <li key={i}>{c}</li>)
              : <li className="no-data">
                  {!query ? '入力待ち...' : '該当なし'}
                </li>}
          </ul>
        ) : (
          <>
            <ul className="result-list">
              {visibleResults.length > 0
                ? visibleResults.map((k, i) => <li key={i}>{k}</li>)
                : <li className="no-data">
                    {!query ? '入力待ち...' : '該当なし'}
                  </li>}
            </ul>
            {remaining > 0 && (
              <button className="more-button" onClick={() => setPage(page + 1)}>
                その他 ({remaining}件)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
