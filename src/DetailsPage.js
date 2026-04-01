// src/DetailsPage.js
import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL ?? 'http://localhost:4000';

export default function DetailsPage({ kanji, onPartClick }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    setData(null);
    fetch(`${API_URL}/api/kanji/${encodeURIComponent(kanji)}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error);
  }, [kanji]);

  if (!data) return <div>Loading...</div>;

  const hex = kanji.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
  const on  = data.on_yomi?.join('、');
  const kun = data.kun_yomi?.join('、');
  const meanings = data.meanings?.ja?.filter(m => m);
  const description = `漢字「${kanji}」の情報。Unicode U+${hex}、音読み: ${on || '-'}、訓読み: ${kun || '-'}。`;

  return (
    <div className="details-container">
      <Helmet>
        <title>漢字情報：{kanji}｜漢字分解検索</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={`漢字情報：${kanji}`} />
        <meta property="og:description" content={description} />
      </Helmet>

      <h2>{kanji}</h2>
      <p>Unicode: U+{hex}</p>
      {on  && <p>音読み: {on}</p>}
      {kun && <p>訓読み: {kun}</p>}

      {meanings?.length > 0 && (
        <div className="meanings">
          <p>意味:</p>
          <ol>
            {meanings.map((m, i) => <li key={i}>{m}</li>)}
          </ol>
        </div>
      )}

      {data.parts?.length > 0 && (
        <div className="parts">
          <p>部品:</p>
          <ul className="parts-list">
            {data.parts.map((p, i) => (
              <li key={i} onClick={() => onPartClick?.(p)} className="part-item">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
