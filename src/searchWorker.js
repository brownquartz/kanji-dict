/* eslint-disable no-restricted-globals */
// src/searchWorker.js

let directMap = {}, variantMap = {}, patternMap = {}, joyoSet = new Set(), oldNewMap = {};

onmessage = ({ data }) => {
  if (data.init) {
    // 初期データのセット
    directMap   = data.directMap;
    variantMap  = data.variantMap;
    patternMap  = data.patternMap;
    joyoSet     = new Set(data.joyoList);
    oldNewMap   = data.oldNewMap;
    console.log('◁ worker INIT received:', {
      directSize: Object.keys(directMap).length,
      variantSize: Object.keys(variantMap).length,
      patternSize: Object.keys(patternMap).length
    });
    return;
  }

  const { parts, mode, region } = data; 

  // ==== 追加: 単一漢字入力時は directMap で検索 ====
  if (mode === 'partsToKanji' && parts.length === 1) {
    const p = parts[0];
    // directMap から候補を取得（未定義なら空配列）
    let results = Array.isArray(directMap[p]) ? [...directMap[p]] : [];
    // 自身を先頭に追加
    if (!results.includes(p)) {
     results.unshift(p);
    }
    // フィルタリング: joyo/japanese
    if (region === 'joyo') {
      results = results.filter(k => joyoSet.has(k));
    } else if (region === 'japanese') {
      results = results.filter(k => joyoSet.has(k) || oldNewMap[k]);
    }
    postMessage({ results });
    return;
  }

  // 0. 部品として見なせない文字は、patternMap で分解して部品に
  const expanded = [];
  parts.forEach(p => {
    if (!directMap[p] && patternMap[p]) {
      // 漢字→部品モードのように最初の分解パターンを使う
      const pats = patternMap[p];
      if (pats.length > 0) expanded.push(...pats[0]);
      else expanded.push(p);
    } else {
      expanded.push(p);
    }
  });
  const rawParts = [...new Set(expanded)];

  // 1. 異体字を含む配列を作成
  const variantArrays = rawParts.map(ch => [ch, ...(variantMap[ch] || [])]);

  // 2. 全組み合わせを生成
  const cartesianProduct = arrays =>
    arrays.reduce(
      (acc, curr) => acc.flatMap(prev => curr.map(item => [...prev, item])),
      [[]]
    );
  const combos = cartesianProduct(variantArrays);

  // 3. 逆引きインデックスで共通候補抽出
  const matchCountMap = new Map();
  combos.forEach(combo => {
    const sets = combo.map(p => {
      const list = directMap[p];
      // 未定義 or 空配列 なら 自身のみ fallback
      const arr = (Array.isArray(list) && list.length > 0) ? list : [p];
      return new Set(arr);
    });
    if (!sets.length) return;
    const intersection = sets.reduce((a, b) => new Set([...a].filter(k => b.has(k))));
    intersection.forEach(k => {
      matchCountMap.set(k, (matchCountMap.get(k) || 0) + 1);
    });
  });

  // 4. 上位100件を抽出
  const candidates = Array.from(matchCountMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100)
    .map(([k]) => k);

  // 5. スコア計算
  const calculateScore = (patArr, inParts) => {
    const onlyHan = patArr.filter(ch => /\p{Script=Han}/u.test(ch));
    const total = onlyHan.length;
    if (!total) return 0;
    const cnt = {};
    inParts.forEach(p => { cnt[p] = (cnt[p] || 0) + 1; });
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

  // 6. フィルタリング
  let filtered = scored;
  if (mode === 'partsToKanji') {
    if (region === 'joyo') {
      filtered = filtered.filter(k => joyoSet.has(k));
    } else if (region === 'japanese') {
      filtered = filtered.filter(k => joyoSet.has(k) || oldNewMap[k]);
    }
    // chinese は制限なし
  }

  // 7. 結果を返却
  postMessage({ results: filtered });
};
