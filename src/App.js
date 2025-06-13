import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [decomp, setDecomp] = useState({});
  const [variants, setVariants] = useState({ byVariant: {} });
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('part2char');
  const [result, setResult] = useState([]);

  // 並列で JSON を読み込んで正規化
  useEffect(() => {
    const base = process.env.PUBLIC_URL;
    Promise.all([
      fetch(`${base}/cjkvi_decomp_resolved.json`).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      }),
      fetch(`${base}/variants.json`).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
    ])
      .then(([decompJson, variantsJson]) => {
        // 正規化関数
        const normalize = ch => {
          const baseChars = variantsJson.byVariant[ch];
          return baseChars ? baseChars[0] : ch;
        };
        // 部品マップを正規化
        const normalized = {};
        Object.entries(decompJson).forEach(([kanji, parts]) => {
          normalized[kanji] = parts.map(normalize);
        });
        setDecomp(normalized);
        setVariants(variantsJson);
      })
      .catch(err => console.error('JSON読み込み失敗:', err));
  }, []);

  // 入力・モード・データ変更時に検索
  useEffect(() => {
    const normalizeChar = ch => {
      const bases = variants.byVariant[ch];
      return bases ? bases[0] : ch;
    };
    // 入力から漢字だけ取り出し、正規化
    const inputChars = Array.from(query)
      .filter(ch => /\p{Script=Han}/u.test(ch))
      .map(normalizeChar);
    if (inputChars.length === 0) {
      setResult([]);
      return;
    }
    const uniqueChars = [...new Set(inputChars)];
    let matches = [];
    if (mode === 'part2char') {
      matches = Object.entries(decomp)
        .filter(([, comps]) => uniqueChars.every(p => comps.includes(p)))
        .map(([kanji]) => kanji);
    } else {
      const base = uniqueChars[0];
      matches = decomp[base] || [];
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
