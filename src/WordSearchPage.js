// src/WordSearchPage.js
// 独立した単語検索ページ。読み・表記いずれかの前方一致で words テーブルを検索する。
import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import MeaningsList from './MeaningsList';
import './App.css';
import './MainApp.css';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:4000';

export default function WordSearchPage() {
  const [inputValue, setInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async (term) => {
    if (!term) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/words/search?q=${encodeURIComponent(term)}`);
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    const term = inputValue.trim();
    setSearchTerm(term);
    doSearch(term);
  };
  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  return (
    <div className="app-container">
      <Helmet>
        <title>単語検索｜漢字分解検索</title>
        <meta name="description" content="読みまたは表記（部分一致）から日本語の単語を検索します。" />
      </Helmet>

      <h1 className="header">単語検索</h1>

      <div className="controls">
        <div className="search-section">
          <div className="search-box">
            <input
              className="search-input"
              placeholder="単語（表記または読み）を入力"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="search-button" onClick={handleSearch}>検索</button>
          </div>
          {searchTerm && (
            <div className="search-info">
              {loading ? '検索中…' : `検索ワード：${searchTerm}`}
            </div>
          )}
        </div>
      </div>

      {results.length > 0 && (
        <div className="word-result">
          {results.map((entry, i) => (
            <div key={i} className="word-entry">
              <h3 style={{ fontSize: '1.5rem', margin: '0 0 0.25rem' }}>
                {entry.kanji_form || entry.reading}
              </h3>
              {entry.kanji_form && <p className="word-reading">{entry.reading}</p>}
              <MeaningsList meanings={entry.meanings} />
            </div>
          ))}
        </div>
      )}

      {searchTerm && !loading && results.length === 0 && (
        <div className="no-data" style={{ marginTop: '1rem' }}>該当する単語が見つかりませんでした。</div>
      )}

      <p style={{ textAlign: 'center', marginTop: '2rem' }}>
        <Link to="/">← 漢字分解ツールへ戻る</Link>
      </p>
    </div>
  );
}
