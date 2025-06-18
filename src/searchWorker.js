/* eslint-disable no-restricted-globals */
// src/searchWorker.js

let directMap = {}, variantMap = {}, patternMap = {}, joyoSet = new Set(), oldNewMap = {};

self.onmessage = ({ data }) => {
  // ───── 初期化 ─────
  if (data.init) {
    directMap   = data.directMap;
    variantMap  = data.variantMap;
    patternMap  = data.patternMap;
    joyoSet     = new Set(data.joyoList);
    oldNewMap   = data.oldNewMap;
    console.log('▷ worker INIT received:', {
      directSize: Object.keys(directMap).length,
      variantSize: Object.keys(variantMap).length,
      patternSize: Object.keys(patternMap).length
    });
    return;
  }

  const { parts, mode, region } = data;

  // ───── 1. 部品→漢字モード：単一漢字入力の早期返却 ─────
  if (mode === 'partsToKanji' && parts.length === 1) {
    const p = parts[0];
    // directMap から候補を取得（なければ空配列）
    let results = Array.isArray(directMap[p]) ? [...directMap[p]] : [];
    // 「自身」を先頭に挿入
    if (!results.includes(p)) {
      results.unshift(p);
    }
    // joyo/japanese フィルター
    if (region === 'joyo') {
      results = results.filter(k => joyoSet.has(k));
    } else if (region === 'japanese') {
      results = results.filter(k => joyoSet.has(k) || oldNewMap[k]);
    }
    postMessage({ results });
    return;
  }

  // ───── 2. 漢字→部品モード：全パターンをマージ ─────
  if (mode === 'kanjiToParts' && parts.length > 0) {
    const out = [];
    const seen = new Set();

    // patternMap[漢字] は [ [層1の配列], [層2の配列], ... ]
    const layers = patternMap[parts.join('')] || [];

    // ⬇︎ 各層ごとに「漢字だけ」をフィルタ
    const layersKanji = layers.map(layer =>
      layer.filter(p => p.charCodeAt(0) > 0x007F)
    );
    const layers_afterExtKanji = layersKanji;

    layers_afterExtKanji.forEach(layer => {
      layer.forEach(p => {
        if (!seen.has(p)) {
          seen.add(p);
          out.push(p);
        }
      });
    });

    postMessage({ results: out });
    return;
  }

  // ───── 3. 以下、元々の部品→漢字ロジック ─────
  // 0) patternMap による暗黙の分解
  const expanded = [];
  parts.forEach(p => {
    if (!directMap[p] && patternMap[p]) {
      const pats = patternMap[p];
      if (pats.length > 0) expanded.push(...pats[0]);
      else expanded.push(p);
    } else {
      expanded.push(p);
    }
  });
  const rawParts = [...new Set(expanded)];

  // 1) 異体字も含めた配列を作成
  const variantArrays = rawParts.map(ch => [ch, ...(variantMap[ch] || [])]);

  // 2) 全組み合わせを生成
  const cartesianProduct = arrays =>
    arrays.reduce((acc, curr) => acc.flatMap(prev => curr.map(item => [...prev, item])), [[]]);
  const combos = cartesianProduct(variantArrays);

  // 3) 逆引きインデックス（directMap）でマッチ数をカウント
  const matchCountMap = new Map();
  combos.forEach(combo => {
    const sets = combo.map(p => {
      const list = directMap[p];
      return new Set(Array.isArray(list) && list.length > 0 ? list : [p]);
    });
    if (!sets.length) return;
    const intersection = sets.reduce((a, b) => new Set([...a].filter(k => b.has(k))));
    intersection.forEach(k => {
      matchCountMap.set(k, (matchCountMap.get(k) || 0) + 1);
    });
  });

  // 4) 上位100件を抽出
  const candidates = Array.from(matchCountMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([k]) => k);

  // 5) スコア計算
  const calculateScore = (patArr, inParts) => {
    const total = patArr.filter(ch => /\p{Script=Han}/u.test(ch)).length;
    if (!total) return 0;
    const cnt = {};
    inParts.forEach(x => (cnt[x] = (cnt[x] || 0) + 1));
    let match = 0;
    Object.entries(cnt).forEach(([p, n]) => {
      const occ = patArr.reduce((s, c) => (c === p ? s + 1 : s), 0);
      match += Math.min(n, occ);
    });
    const rate = (match / total) * 100;
    const exact = patArr.length >= inParts.length && inParts.every((p, i) => patArr[i] === p);
    return rate + (exact ? 50 : 0);
  };
  const scored = candidates
    .map(k => {
      const patterns = patternMap[k] || [];
      const best = patterns.reduce((m, arr) => Math.max(m, calculateScore(arr, rawParts)), 0);
      return { k, score: best };
    })
    .sort((a, b) => b.score - a.score)
    .map(x => x.k);

  // 6) joyo/japanese フィルター
  let filtered = scored;
  if (mode === 'partsToKanji') {
    if (region === 'joyo') {
      filtered = filtered.filter(k => joyoSet.has(k));
    } else if (region === 'japanese') {
      filtered = filtered.filter(k => joyoSet.has(k) || oldNewMap[k]);
    }
  }

  // 7) 最終返却
  postMessage({ results: filtered });
};
