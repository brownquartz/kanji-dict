// src/DetailsPage.js
import React, { useState, useEffect } from 'react';
import { Helmet } from 'react-helmet';
import './App.css';

export default function DetailsPage({ kanji }) {
  const [entry, setEntry] = useState(null);
  const [parts, setParts] = useState([]);

  useEffect(() => {
    const base = process.env.PUBLIC_URL || '';
    (async() => {
      const [joyoData, direct] = await Promise.all([
        fetch(`${base}/joyo2010.json`).then(r=>r.json()),
        fetch(`${base}/direct_decomp.json`).then(r=>r.json())
      ]);
      const cp = kanji.codePointAt(0).toString();
      setEntry(joyoData[cp] || {});
      setParts(direct[kanji] || []);
    })();
  }, [kanji]);

  if (!entry) return <div>Loading...</div>;

  const hex = kanji.codePointAt(0).toString(16).toUpperCase().padStart(4,'0');
  const on = entry.yomi?.on_yomi?.join('、');
  const kun = entry.yomi?.kun_yomi?.join('、');
  const description = `漢字「${kanji}」の情報。Unicode U+${hex}、音読み: ${on||'-'}、訓読み: ${kun||'-'}。`;

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
      {on && <p>音読み: {on}</p>}
      {kun && <p>訓読み: {kun}</p>}
      <p>部品: {parts.join('、') || '-'}</p>
    </div>
  );
}
