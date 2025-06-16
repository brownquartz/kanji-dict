import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [directMap, setDirectMap] = useState({});
  const [patternMap, setPatternMap] = useState({});
  const [variantsMap, setVariantsMap] = useState({});
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState(''); // 実際に検索した文字列
  const [mode, setMode] = useState('part2char'); // 'part2char' or 'char2part'
  const [result, setResult] = useState([]);
  const [page, setPage] = useState(1);

  const MAX_DISPLAY = 100;

  // 検索実行時にクエリ保存 & ページリセット
  const handleSearch = () => {
    setQuery(inputValue.trim());
    setPage(1);
  };
  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  // 初期データ読み込み
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

  // query, mode, or data 変更時に検索実行
  useEffect(() => {
    if (!query) { setResult([]); return; }
    const rawParts = Array.from(query).filter(ch => /\p{Script=Han}/u.test(ch));
    if (!rawParts.length) { setResult([]); return; }

    if (mode === 'part2char') {
      const needCounts = rawParts.reduce((acc, p) => {
        acc[p] = (acc[p] || 0) + 1;
        return acc;
      }, {});

      const found = new Set();
      Object.entries(patternMap).forEach(([kanji, patterns]) => {
        for (const patArr of patterns) {
          let ok = true;
          for (const [part, cnt] of Object.entries(needCounts)) {
            const have = patArr.reduce((sum, x) => x === part ? sum + 1 : sum, 0);
            if (have < cnt) { ok = false; break; }
          }
          if (ok) { found.add(kanji); break; }
        }
      });
      // 単一部品なら自身も含める
      if (rawParts.length === 1) {
        found.add(rawParts[0]);
      }
      setResult(Array.from(found));

    } else {
      const target = query[0];
      const parts = directMap[target] || [];
      setResult([target, ...parts]);
    }
  }, [query, mode, patternMap, directMap]);

  // 表示件数・残余件数
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
            <input
              type="radio"
              name="mode"
              value="part2char"
              checked={mode === 'part2char'}
              onChange={() => setMode('part2char')}
            />
            部品 → 漢字
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="char2part"
              checked={mode === 'char2part'}
              onChange={() => setMode('char2part')}
            />
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
          {query && (
            <span className="search-info">検索ワード: {query}</span>
          )}
        </div>
      </div>

      <div className="result-section">
        {mode === 'char2part' ? (
          <ul className="result-list">
            {visibleResults.length > 0
              ? visibleResults.map((c, i) => <li key={i}>{c}</li>)
              : <li className="no-data">{!query ? '入力待ち...' : '該当なし'}</li>
            }
          </ul>
        ) : (
          <>
            <ul className="result-list">
              {visibleResults.length > 0
                ? visibleResults.map((k, i) => <li key={i}>{k}</li>)
                : <li className="no-data">{!query ? '入力待ち...' : '該当なし'}</li>
              }
            </ul>
            {remaining > 0 && (
              <button
                className="more-button"
                onClick={() => setPage(page + 1)}
              >その他 ({remaining}件)</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
