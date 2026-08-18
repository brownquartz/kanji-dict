// src/WordFromParts.js
// 「2文字の熟語は分からないが、それぞれの漢字の書き方(部品)は分かる」場合に、
// 1文字目・2文字目を部品検索で順番に特定し、連結して熟語辞書を引く機能。
import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:4000';

export default function WordFromParts() {
  const [step, setStep] = useState(1); // 1文字目を探しているか、2文字目か
  const [char1, setChar1] = useState(null);
  const [char2, setChar2] = useState(null);

  const [inputValue, setInputValue] = useState('');
  const [region, setRegion] = useState('joyo');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const [wordResult, setWordResult] = useState(null); // { entries } | 'not-found' | null

  const doSearch = useCallback(async (term, currentRegion) => {
    const rawParts = Array.from(term).filter(ch => /\p{Script=Han}/u.test(ch));
    if (!rawParts.length) { setResults([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: rawParts, mode: 'partsToKanji', region: currentRegion }),
      });
      const data = await res.json();
      setResults(data.results || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const lookupWord = useCallback(async (text) => {
    setLoading(true);
    setWordResult(null);
    try {
      const res = await fetch(`${API_URL}/api/word/${encodeURIComponent(text)}`);
      if (res.status === 404) {
        setWordResult('not-found');
        return;
      }
      const data = await res.json();
      setWordResult(data);
    } catch (e) {
      console.error(e);
      setWordResult('not-found');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = () => {
    const term = inputValue.trim();
    if (!term) return;
    doSearch(term, region);
  };
  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  const pickChar = (k) => {
    setInputValue('');
    setResults([]);
    if (step === 1) {
      setChar1(k);
      setStep(2);
    } else {
      setChar2(k);
      lookupWord((char1 ?? '') + k);
    }
  };

  const reset = () => {
    setStep(1);
    setChar1(null);
    setChar2(null);
    setInputValue('');
    setResults([]);
    setWordResult(null);
  };

  const currentStepLabel = step === 1 ? '1文字目' : '2文字目';

  return (
    <div className="word-from-parts">
      <p className="search-info" style={{ marginBottom: 12 }}>
        それぞれの漢字を部品から特定し、2文字をつなげて熟語として調べます。
      </p>

      <div className="char-progress" style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <span className={`char-slot ${char1 ? 'filled' : ''}`}>{char1 || '？'}</span>
        <span className="char-slot">{char2 || (step === 2 ? '？' : '')}</span>
      </div>

      {!wordResult && (
        <>
          <div className="region-filter">
            <button className={region === 'joyo' ? 'active' : ''} onClick={() => setRegion('joyo')}>常用漢字</button>
            <button className={region === 'japanese' ? 'active' : ''} onClick={() => setRegion('japanese')}>+表外漢字</button>
            <button className={region === 'chinese' ? 'active' : ''} onClick={() => setRegion('chinese')}>+中国漢字</button>
          </div>
          <div className="search-section">
            <div className="search-box">
              <input
                className="search-input"
                placeholder={`${currentStepLabel}の部品を入力`}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
              />
              <button className="search-button" onClick={handleSearch}>検索</button>
            </div>
            <div className="search-info">
              {loading ? '検索中…' : `${currentStepLabel}を探しています`}
            </div>
          </div>

          <div className="result-section">
            <ul className="result-list">
              {results.length > 0 ? (
                results.slice(0, 100).map((k, i) => (
                  <li key={i} onClick={() => pickChar(k)}>{k}</li>
                ))
              ) : (
                <li className="no-data">.</li>
              )}
            </ul>
          </div>
        </>
      )}

      {wordResult && wordResult !== 'not-found' && (
        <div className="word-result">
          <h3>{char1}{char2}</h3>
          {wordResult.entries.map((entry, i) => (
            <div key={i} className="word-entry">
              <p className="word-reading">{entry.reading}</p>
              <p className="word-meanings">{(entry.meanings?.en || []).join('、')}</p>
            </div>
          ))}
        </div>
      )}

      {wordResult === 'not-found' && (
        <div className="word-result">
          <p>「{char1}{char2}」は辞書に登録がありませんでした。</p>
          <p>
            各文字の詳細はこちら：
            <Link to={`/kanji/${encodeURIComponent(char1)}`}> {char1}</Link>
            {' '}
            <Link to={`/kanji/${encodeURIComponent(char2)}`}>{char2}</Link>
          </p>
        </div>
      )}

      {(char1 || char2) && (
        <button className="search-button" style={{ marginTop: 16 }} onClick={reset}>
          やり直す
        </button>
      )}
    </div>
  );
}
