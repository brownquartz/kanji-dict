import React, { useState, useEffect } from 'react';
import './App.css';

// スコア計算関数
function computeScore(patArr, rawParts) {
  const hanOnly = patArr.filter(ch => /\p{Script=Han}/u.test(ch));
  const denom = hanOnly.length;
  if (denom === 0) return 0;
  const counts = rawParts.reduce((acc, p) => { acc[p] = (acc[p] || 0) + 1; return acc; }, {});
  let matches = 0;
  Object.entries(counts).forEach(([part, cnt]) => {
    const have = patArr.reduce((n, x) => x === part ? n + 1 : n, 0);
    matches += Math.min(cnt, have);
  });
  const matchRate = (matches / denom) * 100;
  let bonus = 0;
  if (patArr.length >= rawParts.length && rawParts.every((p, i) => patArr[i] === p)) {
    bonus = 50;
  }
  return matchRate + bonus;
}

function App() {
  const [directMap, setDirectMap] = useState({});
  const [patternMap, setPatternMap] = useState({});
  const [variantsMap, setVariantsMap] = useState({});
  const [joyoSet, setJoyoSet] = useState(new Set());
  const [kyuSet, setKyuSet] = useState(new Set());
  const [jpAllSet, setJpAllSet] = useState(new Set());

  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('part2char');
  const [region, setRegion] = useState('joyo');
  const [result, setResult] = useState([]);
  const [page, setPage] = useState(1);
  const MAX_DISPLAY = 100;

  // データロード
  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    async function loadData() {
      try {
        const [direct, variants, joyoData, oldToNew] = await Promise.all([
          fetch(`${base}/direct_decomp.json`).then(r => r.json()),
          fetch(`${base}/variants.json`).then(r => r.json()),
          fetch(`${base}/joyo2010.json`).then(r => r.json()),
          fetch(`${base}/old_to_new_kanjis.json`).then(r => r.json())
        ]);
        setDirectMap(direct);
        const merged = {};
        for (let i = 1; i <= 20; i++) {
          const idx = String(i).padStart(2, '0');
          const chunk = await fetch(
            `${base}/pattern_chunks/pattern_decomp_${idx}.json`
          ).then(r => r.json());
          Object.assign(merged, chunk);
        }
        setPatternMap(merged);
        setVariantsMap(variants.byBase || {});

        // 常用漢字
        const joyoChars = Object.values(joyoData).map(e => e.joyo_kanji);
        setJoyoSet(new Set(joyoChars));
        // 旧字体
        const kyuChars = Object.keys(oldToNew);
        setKyuSet(new Set(kyuChars));
        // 日本漢字
        setJpAllSet(new Set([...joyoChars, ...kyuChars]));
      } catch (err) {
        console.error('データ読み込みエラー:', err);
      }
    }
    loadData();
  }, []);

  // 検索
  const handleSearch = () => { setQuery(inputValue.trim()); setPage(1); };
  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  // 検索 & ソート & フィルタ
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
      if (rawParts.length === 1) found.add(rawParts[0]);
      candidates = Array.from(found);
    } else {
      const parts = directMap[query[0]] || [];
      candidates = parts;
    }

    const scored = candidates.map(kanji => {
      const patterns = patternMap[kanji] || [];
      let best = 0;
      patterns.forEach(patArr => {
        const score = computeScore(patArr, rawParts);
        if (score > best) best = score;
      });
      return { kanji, score: best };
    }).sort((a, b) => b.score - a.score);

    let filtered = scored.map(item => item.kanji);
    if (mode === 'part2char') {
      if (region === 'joyo') {
        filtered = filtered.filter(k => joyoSet.has(k));
      } else if (region === 'jpAll') {
        filtered = filtered.filter(k => jpAllSet.has(k));
      }
    }
    setResult(filtered);
  }, [query, mode, region, patternMap, directMap, joyoSet, jpAllSet]);

  const visibleResults = mode === 'part2char' ? result.slice(0, page * MAX_DISPLAY) : result;
  const remaining = mode === 'part2char' ? result.length - visibleResults.length : 0;

  return (
    <div className="app-container">
      <h1 className="header">漢字分解・組み立て検索</h1>
      <div className="controls">
        <div className="modes">
          <button className={mode==='part2char'?'active':''} onClick={()=>setMode('part2char')}>部品→漢字</button>
          <button className={mode==='char2part'?'active':''} onClick={()=>setMode('char2part')}>漢字→部品</button>
        </div>
        {mode==='part2char' && (
          <div className="region-filter">
            <button className={region==='joyo'?'active':''} onClick={()=>setRegion('joyo')}>常用漢字</button>
            <button className={region==='jpAll'?'active':''} onClick={()=>setRegion('jpAll')}>日本漢字</button>
            <button className={region==='all'?'active':''} onClick={()=>setRegion('all')}>中国漢字</button>
          </div>
        )}
        <div className="search-box">
          <input
            className="search-input"
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={mode==='part2char'?'部品入力':'漢字入力'}
          />
          <button className="search-button" onClick={handleSearch}>検索</button>
          {query && <span className="search-info">検索ワード: {query}</span>}
        </div>
      </div>
      <div className="result-section">
        <ul className="result-list">
          {visibleResults.length>0 ? (
            visibleResults.map((k,i)=><li key={i}>{k}</li>)
          ) : (
            <li className="no-data">{!query?'入力待ち...':'該当なし'}</li>
          )}
        </ul>
        {mode==='part2char' && remaining>0 && (
          <button className="more-button" onClick={()=>setPage(page+1)}>その他 ({remaining}件)</button>
        )}
      </div>
    </div>
  );
}

export default App;
