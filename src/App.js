// 20250613

import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [decomp, setDecomp] = useState({});
  const [variants, setVariants] = useState({ byVariant: {} });
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('part2char');
  const [result, setResult] = useState([]);

  // JSON を並列フェッチしてマップを正規化
  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    Promise.all([
      fetch(`${base}/cjkvi_decomp_resolved.json`).then(res => {
        if (!res.ok) throw new Error(`decomp HTTP ${res.status}`);
        return res.json();
      }),
      fetch(`${base}/variants.json`).then(res => {
        if (!res.ok) throw new Error(`variants HTTP ${res.status}`);
        return res.json();
      })
    ])
      .then(([decompJson, variantsJson]) => {
        // 異体字対応：原字と異体字をまとめる normalize 関数
        const normalize = ch => {
          const bases = variantsJson.byVariant[ch];
          return bases ? bases[0] : ch;
        };
        // 部品マップの正規化
        const normalized = {};
        Object.entries(decompJson).forEach(([kanji, parts]) => {
          normalized[kanji] = parts.map(normalize);
        });
        setDecomp(normalized);
        setVariants(variantsJson);
      })
      .catch(err => console.error('JSON読み込み失敗:', err));
  }, []);

  // クエリやモード変化時に検索
  useEffect(() => {
    // 漢字のみ抽出
    const rawChars = Array.from(query).filter(ch => /\p{Script=Han}/u.test(ch));
    if (rawChars.length === 0) {
      setResult([]);
      return;
    }
    // 各入力文字の原字＋異体字リスト
    const variantGroups = rawChars.map(ch => {
      const vs = variants.byVariant[ch] || [];
      return [ch, ...vs];
    });

    let matches = [];
    if (mode === 'part2char') {
      // 部品→漢字: すべてのグループからいずれか1つ含む漢字を探す
      matches = Object.entries(decomp)
        .filter(([, comps]) =>
          variantGroups.every(group =>
            group.some(v => comps.includes(v))
          )
        )
        .map(([kanji]) => kanji);
    } else {
      // 漢字→部品: 第一入力文字の部品をそのまま返す
      const first = rawChars[0];
      matches = decomp[first] || [];
    }

    setResult(matches);
  }, [query, mode, decomp, variants]);

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
            /> 部品 → 漢字
          </label>
          <label>
            <input
              type="radio"
              name="mode"
              value="char2part"
              checked={mode === 'char2part'}
              onChange={() => setMode('char2part')}
            /> 漢字 → 部品
          </label>
        </div>
        <input
          className="search-input"
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={
            mode === 'part2char'
              ? '部品となる漢字を入力'
              : '分解する漢字を入力'
          }
        />
      </div>
      <ul className="result-list">
        {result.length > 0 ? (
          result.map((item, idx) => <li key={idx}>{item}</li>)
        ) : (
          <li className="no-data">
            {query === '' ? '入力待ち...' : '該当なし'}
          </li>
        )}
      </ul>
    </div>
  );
}

export default App;
