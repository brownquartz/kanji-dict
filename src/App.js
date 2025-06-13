// 20250613

import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [direct, setDirect] = useState({});
  const [variants, setVariants] = useState({ byVariant: {} });
  const [flat, setFlat] = useState({});
  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('part2char');
  const [result, setResult] = useState([]);

  // 入力確定（Enter or ボタン）
  const handleSearch = () => setQuery(inputValue.trim());
  const handleKeyDown = e => {
    if (e.key === 'Enter') handleSearch();
  };

  // JSON読み込み
  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    Promise.all([
      fetch(`${base}/direct_decomp.json`).then(r => r.ok ? r.json() : Promise.reject(r)),
      fetch(`${base}/variants.json`).then(r => r.ok ? r.json() : Promise.reject(r)),
      fetch(`${base}/flat_decomp.json`).then(r => r.ok ? r.json() : Promise.reject(r))
    ])
      .then(([directJson, variantsJson, flatJson]) => {
        setDirect(directJson);
        setVariants(variantsJson);
        setFlat(flatJson);
      })
      .catch(err => console.error('JSON読み込み失敗:', err));
  }, []);

  // 検索ロジック
  useEffect(() => {
    if (!query) {
      setResult([]);
      return;
    }
    // 漢字のみ抽出・正規化
    const normalize = ch => {
      const base = variants.byVariant[ch];
      return base ? base[0] : ch;
    };
    const rawParts = Array.from(query)
      .filter(ch => /\p{Script=Han}/u.test(ch))
      .map(normalize);
    if (rawParts.length === 0) {
      setResult([]);
      return;
    }

    let matches = [];
    if (mode === 'part2char') {
      // 部品→漢字モード: 部品ごとの候補を取得し、AND条件(交差)で絞り込み
      const lists = rawParts.map(p => flat[p] || []);
      if (lists.length > 0) {
        matches = lists.reduce(
          (acc, cur) => acc.filter(k => cur.includes(k)),
          lists[0]
        );
      }
    } else {
      // 漢字→部品モード: directマップそのまま
      matches = direct[rawParts[0]] || [];
    }

    setResult(matches);
  }, [query, mode, direct, variants, flat]);

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
            placeholder={
              mode === 'part2char'
                ? '部品となる漢字を入力'
                : '分解する漢字を入力'
            }
          />
          <button className="search-button" onClick={handleSearch}>
            検索
          </button>
        </div>
      </div>
      <ul className="result-list">
        {result.length > 0 ? (
          result.map((k, i) => <li key={i}>{k}</li>)
        ) : (
          <li className="no-data">
            {!query ? '入力待ち...' : '該当なし'}
          </li>
        )}
      </ul>
    </div>
  );
}

export default App;
