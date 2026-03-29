// src/MainApp.js
import React, { useState, useCallback } from 'react';
import DetailsPage from './DetailsPage';
import './MainApp.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000';

export default function MainApp() {
  const [inputValue, setInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [mode, setMode] = useState('partsToKanji');
  const [region, setRegion] = useState('joyo');
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const MAX_DISPLAY = 100;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);

  const runSearch = useCallback(async (term, currentMode, currentRegion) => {
    if (!term) { setResults([]); return; }
    const rawParts = Array.from(term).filter(ch => /\p{Script=Han}/u.test(ch));
    if (!rawParts.length) { setResults([]); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: rawParts, mode: currentMode, region: currentRegion }),
      });
      const data = await res.json();
      setResults(data.results || []);
      setPage(1);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    const term = inputValue.trim();
    setSearchTerm(term);
    runSearch(term, mode, region);
  };

  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (searchTerm) runSearch(searchTerm, newMode, region);
  };

  const handleRegionChange = (newRegion) => {
    setRegion(newRegion);
    if (searchTerm) runSearch(searchTerm, mode, newRegion);
  };

  const visible = results.slice(0, page * MAX_DISPLAY);
  const moreCount = results.length - visible.length;

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

  return (
    <div className="app-container">
      {loading && (
        <div className="loading-overlay">
          <div className="loading-bar" />
        </div>
      )}
      <h1 className="header">
        漢字分解・組み立て検索
        <span className={`info-icon ${mode}`}>ⓘ
          {mode === 'partsToKanji' && (
            <div className="tooltip">
              {`入力部品を組み立てて、
              一番近い漢字を出力します。
              ex) "口口口" ⇒ "品臨器操燥繰藻"
                  "水也" ⇒ "池"
                  "角刀牛" ⇒ "解"
              `}
            </div>
          )}
          {mode === 'kanjiToParts' && (
            <div className="tooltip">
              {`漢字を複数層で分けて、
              全要素を重複なしで出力します。
              ex) "嘔" ⇒ "口區匸品"
              "池" ⇒ "氵也"
              "解" ⇒ "刀牛角丿𠃌"
              `}
            </div>
          )}
        </span>
      </h1>
      <div className="controls">
        <div className="modes">
          <button
            className={mode === 'partsToKanji' ? 'active' : ''}
            onClick={() => handleModeChange('partsToKanji')}
          >部品→漢字</button>
          <button
            className={mode === 'kanjiToParts' ? 'active' : ''}
            onClick={() => handleModeChange('kanjiToParts')}
          >漢字→部品</button>
        </div>
        {mode === 'partsToKanji' && (
          <div className="region-filter">
            <button
              className={region === 'joyo' ? 'active' : ''}
              onClick={() => handleRegionChange('joyo')}
            >常用漢字</button>
            <button
              className={region === 'japanese' ? 'active' : ''}
              onClick={() => handleRegionChange('japanese')}
            >+表外漢字</button>
            <button
              className={region === 'chinese' ? 'active' : ''}
              onClick={() => handleRegionChange('chinese')}
            >+中国漢字</button>
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
