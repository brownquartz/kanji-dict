// 20250613

import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [decomp, setDecomp] = useState({});
  const [variants, setVariants] = useState({ byVariant: {}, byBase: {} });
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('part2char');
  const [result, setResult] = useState([]);

  // 再帰的に分解をフラット化するユーティリティ
  const buildFlatMap = (map) => {
    const cache = {};
    const dfs = (kanji) => {
      if (cache[kanji]) return cache[kanji];
      // 初回呼び出し時に空の Set をキャッシュに登録しておく（循環防止）
      const all = new Set();
      cache[kanji] = all;
      const direct = map[kanji] || [];
      direct.forEach(p => {
        all.add(p);
        if (map[p]) {
          dfs(p).forEach(x => all.add(x));
        }
      });
      return all;
    };
    Object.keys(map).forEach(k => dfs(k));
    return cache;

  };

  // JSON を並列フェッチしてマップを正規化
  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    Promise.all([
      fetch(`${base}/cjkvi_decomp_resolved.json`).then(res => res.ok ? res.json() : Promise.reject(res)),
      fetch(`${base}/variants.json`).then(res => res.ok ? res.json() : Promise.reject(res))
    ])
    .then(([decompJson, variantsJson]) => {
      // 正規化関数
      const normalize = ch => {
        const bases = variantsJson.byVariant[ch];
        return bases ? bases[0] : ch;
      };
      // 直接部品マップと異体字マップをセット
      setVariants(variantsJson);
      // 部品マップを正規化
      const normalized = {};
      Object.entries(decompJson).forEach(([kanji, parts]) => {
        normalized[kanji] = parts.map(normalize);
      });
      setDecomp(normalized);
    })
    .catch(err => console.error('JSON読み込み失敗:', err));
  }, []);

  // 入力・モード・マップ変更時に検索
  useEffect(() => {
    const rawChars = Array.from(query).filter(ch => /\p{Script=Han}/u.test(ch));
    if (rawChars.length === 0) {
      setResult([]);
      return;
    }
    // 各文字の原字+異体字一覧を作成
    const variantGroups = rawChars.map(ch => [ch, ...(variants.byVariant[ch] || [])]);
    // フラットマップを一度だけ作成
    const flatMap = buildFlatMap(decomp);
    // 入力の全組み合わせ（直積）を生成
    const combos = variantGroups.reduce((acc, arr) => {
      if (acc.length === 0) return arr.map(x => [x]);
      return acc.flatMap(prev => arr.map(x => [...prev, x]));
    }, []);
    let matches = [];

    if (mode === 'part2char') {
      // 部品→漢字: 組み合わせのいずれかをすべて含む漢字を返す
      matches = Object.entries(flatMap)
        .filter(([, leafSet]) => combos.some(combo => combo.every(p => leafSet.has(p))))
        .map(([kanji]) => kanji);
    } else {
      // 漢字→部品: 最初の文字の直接部品を返す
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
            <input type="radio" name="mode" value="part2char"
              checked={mode === 'part2char'} onChange={() => setMode('part2char')} /> 部品 → 漢字
          </label>
          <label>
            <input type="radio" name="mode" value="char2part"
              checked={mode === 'char2part'} onChange={() => setMode('char2part')} /> 漢字 → 部品
          </label>
        </div>
        <input className="search-input" value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={mode==='part2char' ? '部品となる漢字を入力' : '分解する漢字を入力'} />
      </div>
      <ul className="result-list">
        {result.length > 0 ? result.map((ch,i)=><li key={i}>{ch}</li>)
          : <li className="no-data">{query===''?'入力待ち...':'該当なし'}</li>}
      </ul>
    </div>
  );
}

export default App;


