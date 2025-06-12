import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [data, setData] = useState({});
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('part2char');
  const [result, setResult] = useState([]);

  // JSON データを読み込み
  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch('/cjkvi_decomp_resolved.json');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error('JSON読み込み失敗:', err);
      }
    }
    loadData();
  }, []);

  // query or mode が変わるたびに検索
  useEffect(() => {
    const chars = Array.from(query).filter(ch => /\p{Script=Han}/u.test(ch));
    if (chars.length === 0) {
      setResult([]);
      return;
    }
    const uniqueChars = [...new Set(chars)];
    let matches = [];

    if (mode === 'part2char') {
      matches = Object.entries(data)
        .filter(([, comps]) => uniqueChars.every(p => comps.includes(p)))
        .map(([kanji]) => kanji);
    } else {
      // mode === 'char2part'
      const ch = uniqueChars[0];
      matches = data[ch] || [];
    }

    setResult(matches);
  }, [query, mode, data]);

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
          placeholder={mode === 'part2char' ? '部品となる漢字を入力' : '分解する漢字を入力'}
        />
      </div>

      <ul className="result-list">
        {result.length > 0 ? (
          result.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))
        ) : (
          <li className="no-data">{query === '' ? '入力待ち...' : '該当なし'}</li>
        )}
      </ul>
    </div>
  );
}

export default App;
