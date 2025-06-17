import React, { useState, useEffect } from 'react';
import DetailsPage from './DetailsPage';
import './App.css';

// Score calculation (match rate + exact match bonus)
function calculateScore(patternArray, inputParts) {
  const onlyHan = patternArray.filter(ch => /\p{Script=Han}/u.test(ch));
  const total = onlyHan.length;
  if (total === 0) return 0;

  const countMap = {};
  inputParts.forEach(part => {
    countMap[part] = (countMap[part] || 0) + 1;
  });

  let matchCount = 0;
  Object.entries(countMap).forEach(([part, cnt]) => {
    const occ = patternArray.reduce((n, ch) => (ch === part ? n + 1 : n), 0);
    matchCount += Math.min(cnt, occ);
  });

  const rate = (matchCount / total) * 100;
  const exact =
    patternArray.length >= inputParts.length &&
    inputParts.every((p, i) => patternArray[i] === p);

  return rate + (exact ? 50 : 0);
}

// Generate Cartesian product of arrays
function cartesianProduct(arrays) {
  return arrays.reduce(
    (acc, curr) => acc.flatMap(prev => curr.map(item => [...prev, item])),
    [[]]
  );
}

export default function MainApp() {
  const [directMap, setDirectMap] = useState({});
  const [patternMap, setPatternMap] = useState({});
  const [variantMap, setVariantMap] = useState({});
  const [joyoSet, setJoyoSet] = useState(new Set());
  const [oldNewMap, setOldNewMap] = useState({});

  const [inputValue, setInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [mode, setMode] = useState('partsToKanji');
  const [region, setRegion] = useState('joyo');
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const MAX_DISPLAY = 100;

  // Load data on mount
  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    (async () => {
      const directData = await fetch(`${base}/direct_decomp.json`).then(r => r.json());
      setDirectMap(directData);

      const variantsData = await fetch(`${base}/variants.json`).then(r => r.json());
      setVariantMap(variantsData.byBase || {});

      const joyoData = await fetch(`${base}/joyo2010.json`).then(r => r.json());

      setJoyoSet(new Set(Object.values(joyoData).map(e => e.joyo_kanji)));

      const oldNewData = await fetch(`${base}/old_to_new_kanjis.json`).then(r => r.json());
      setOldNewMap(oldNewData);

      const merged = {};
      for (let i = 1; i <= 20; i++) {
        const idx = String(i).padStart(2, '0');
        const chunk = await fetch(
          `${base}/pattern_chunks/pattern_decomp_${idx}.json`
        ).then(r => r.json());
        Object.assign(merged, chunk);
      }
      setPatternMap(merged);
    })();
  }, []);

  // Search handlers
  const handleSearch = () => { setSearchTerm(inputValue.trim()); setPage(1); };
  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  // Main search effect with detailed logging
  useEffect(() => {
    if (!searchTerm) { setResults([]); return; }

    const rawParts = Array.from(searchTerm).filter(ch => /\p{Script=Han}/u.test(ch));

    if (rawParts.length === 0) { setResults([]); return; }

    // Build variant arrays for all patterns
    const variantArrays = rawParts.map(ch => [ch, ...(variantMap[ch] || [])]);

    // Generate all combos
    const combos = cartesianProduct(variantArrays);

    // STEP1: Extract candidates
    const found = new Set();
    combos.forEach(combo => {
      const need = {};
      combo.forEach(p => { need[p] = (need[p] || 0) + 1; });

      Object.entries(patternMap).forEach(([kanji, decomps]) => {
        if (decomps.some(dec =>
          Object.entries(need).every(([p, cnt]) =>
            dec.filter(x => x === p).length >= cnt
          )
        )) {
          found.add(kanji);
        }
      });
    });
    if (rawParts.length === 1) found.add(rawParts[0]);

    // STEP2: Scoring
    const scored = Array.from(found).map(k => {
      const decomps = patternMap[k] || [];
      const bestScore = decomps.reduce(
        (max, arr) => Math.max(max, calculateScore(arr, rawParts)),
        0
      );
      return { k, score: bestScore };
    }).sort((a, b) => b.score - a.score);

    const scoredList = scored.map(x => x.k);

    // STEP3: Filtering by region
    let filtered = scoredList;
    if (mode === 'partsToKanji') {
      if (region === 'joyo') {
        filtered = filtered.filter(k => joyoSet.has(k));
      } else if (region === 'japanese') {
        filtered = filtered.filter(k => joyoSet.has(k) || oldNewMap[k]);
      }
    }

    setResults(filtered);
  }, [searchTerm, mode, region, patternMap, directMap, joyoSet, oldNewMap, variantMap]);

  // Pagination and detail view
  const visible = results.slice(0, page * MAX_DISPLAY);
  const moreCount = results.length - visible.length;
  const [detail, setDetail] = useState(null);

  if (detail) {
    return (
      <div className="app-container">
        <button className="search-button" onClick={() => setDetail(null)}>
          ← 検索一覧へ戻る
        </button>
        <DetailsPage kanji={detail} />
      </div>
    );
  }

  // Main render
  return (
    <div className="app-container">
      <h1 className="header">漢字分解・組み立て検索</h1>
      <div className="controls">
        <div className="modes">
          <button
            className={mode === 'partsToKanji' ? 'active' : ''}
            onClick={() => setMode('partsToKanji')}
          >部品→漢字</button>
          <button
            className={mode === 'kanjiToParts' ? 'active' : ''}
            onClick={() => setMode('kanjiToParts')}
          >漢字→部品</button>
        </div>
        {mode === 'partsToKanji' && (
          <div className="region-filter">
            <button
              className={region === 'joyo' ? 'active' : ''}
              onClick={() => setRegion('joyo')}
            >常用漢字</button>
            <button
              className={region === 'japanese' ? 'active' : ''}
              onClick={() => setRegion('japanese')}
            >日本漢字</button>
            <button
              className={region === 'chinese' ? 'active' : ''}
              onClick={() => setRegion('chinese')}
            >中国漢字</button>
          </div>
        )}
        <div className="search-section">
          <div className="search-box">
            <input
              className="search-input"
              placeholder={mode === 'partsToKanji' ? '部品入力' : '漢字入力'}
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="search-button" onClick={handleSearch}>検索</button>
          </div>
          {searchTerm && (
            <div className="search-info">検索ワード：{searchTerm}</div>
          )}
        </div>
      </div>
      <div className="result-section">
        <ul className="result-list">
          {visible.length > 0 ? (
            visible.map((k, i) => (
              <li key={i} onClick={() => setDetail(k)}>{k}</li>
            ))
          ) : (
            <li className="no-data">
              {searchTerm ? 'X' : '.'}
            </li>
          )}
        </ul>
        {moreCount > 0 && (
          <button className="more-button" onClick={() => setPage(p => p + 1)}>
            その他（{moreCount}件）
          </button>
        )}
      </div>
    </div>
  );
}
