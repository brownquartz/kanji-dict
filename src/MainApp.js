// src/MainApp.js
import React, { useState, useEffect, useMemo } from 'react';
import DetailsPage from './DetailsPage';
import './MainApp.css';

// ワーカー読み込み（CRA 5+ の組み込み機能を使う場合）
const createSearchWorker = () =>
  new Worker(new URL('./searchWorker.js', import.meta.url), { type: 'module' });

export default function MainApp() {
  // ————— データマップ —————
  const [directMap, setDirectMap] = useState({});
  const [patternMap, setPatternMap] = useState({});
  const [variantMap, setVariantMap] = useState({});
  const [joyoSet, setJoyoSet] = useState(new Set());
  const [oldNewMap, setOldNewMap] = useState({});

  // ————— UIステート —————
  const [inputValue, setInputValue] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [mode, setMode] = useState('partsToKanji');
  const [region, setRegion] = useState('joyo');
  const [results, setResults] = useState([]);
  const [page, setPage] = useState(1);
  const MAX_DISPLAY = 100;
  const [detail, setDetail] = useState(null);

  // ————— Workerインスタンスを一度だけ生成 —————
  const worker = useMemo(createSearchWorker, []);

  // ————— 1) 初期データ読み込み ── mount時に一度だけ —————
  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    (async () => {

      const [d,vdata, jdata, onew] = await Promise.all([
        fetch(`${base}/flat_decomp.json`).then(r => r.json()),
        fetch(`${base}/variants.json`).then(r => r.json()),
        fetch(`${base}/joyo2010.json`).then(r => r.json()),
        fetch(`${base}/old_to_new_kanjis.json`).then(r => r.json()),
      ]);
      // directMap
      setDirectMap(d);

      // variantMap (byBase のみ)
      setVariantMap(vdata.byBase || {});

      // joyoSet
      setJoyoSet(new Set(Object.values(jdata).map(e => e.joyo_kanji)));

      // oldNewMap
      setOldNewMap(onew);
    
      // patternMap (全チャンクをマージ)
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

  // ————— 2) Workerに初期データを渡す —————
  useEffect(() => {
    // patternMapが空の間はまだ初期化しない
    if (!Object.keys(patternMap).length) return;
    worker.postMessage({
      init: true,
      directMap,
      variantMap,
      patternMap,
      joyoList: Array.from(joyoSet),
      oldNewMap,
    });
  }, [worker, directMap, variantMap, patternMap, joyoSet, oldNewMap]);

  // ————— 3) 検索語が変わったらWorkerに投げる —————
  useEffect(() => {
    if (!searchTerm) { setResults([]); return; }
    // 漢字だけ抽出
    const rawParts = Array.from(searchTerm).filter(ch => /\p{Script=Han}/u.test(ch));
    if (!rawParts.length) { setResults([]); return; }

    worker.postMessage({ parts: rawParts, mode, region });
  }, [worker, searchTerm, mode, region]);

  // ————— 4) Workerから結果を受け取る —————
  useEffect(() => {
    const handler = e => {
      const { data } = e;
      if (data.results) {
        setResults(data.results);
        setPage(1);
      }
    };
    worker.addEventListener('message', handler);
    return () => worker.removeEventListener('message', handler);
  }, [worker]);

  // ————— 検索トリガー & キーイベント —————
  const handleSearch = () => setSearchTerm(inputValue.trim());
  const handleKeyDown = e => { if (e.key === 'Enter') handleSearch(); };

  

  // ————— ページネーション用に先頭N件だけ —————
  const visible = results.slice(0, page * MAX_DISPLAY);
  const moreCount = results.length - visible.length;

  // ————— 詳細モード —————
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

  // ————— UIレンダー —————
  return (
    <div className="app-container">
      <h1 className="header">
        漢字分解・組み立て検索
        <span className="info-icon">ⓘ
          <div className="tooltip">
            部品を簡単に組み立てて、入力した部品と一番近い漢字を出力します。
            ex: "口口口" ⇒ "品臨器操燥繰藻"、"水也" ⇒ "池"、"角刀牛" ⇒ "解"
          </div>
        </span>
      </h1>
      {/* <div className="logo-container">
        <img src={`${process.env.PUBLIC_URL}/images/logo.png`} alt="Logo" className="logo" />
      </div> */}
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
            >+表外漢字</button>
            <button
              className={region === 'chinese' ? 'active' : ''}
              onClick={() => setRegion('chinese')}
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
              {searchTerm ? '該当する漢字がありません。' : '漢字または部品を入力してください。'}
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
