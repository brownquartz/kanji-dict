require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());

const allowedOrigins = [
  'https://kanji-dict.brwqz.net',
  'http://localhost:3000',
];
app.use(cors({
  origin: (origin, callback) => {
    // origin が undefined = サーバー間リクエスト（curl等）は許可
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS policy violation'));
    }
  },
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Feature 7: search_logs テーブルを起動時に自動作成 ──────────────────────────
(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS search_logs (
        id        BIGSERIAL PRIMARY KEY,
        query     TEXT NOT NULL,
        mode      TEXT,
        region    TEXT,
        logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('search_logs table ready');
  } catch (err) {
    console.error('Failed to create search_logs table:', err.message);
  } finally {
    client.release();
  }
})();

// ─── ヘルスチェック ────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ ok: true }));

// ─── 異体字を含む部品リストを展開するヘルパー ──────────────────────────────────
async function expandWithVariants(client, parts) {
  if (!parts.length) return [];
  const { rows } = await client.query(
    `SELECT base_char, variant_char FROM kanji_variants
     WHERE base_char = ANY($1) OR variant_char = ANY($1)`,
    [parts]
  );
  // 各部品ごとに自身 + 異体字をまとめた配列を作る
  const variantMap = {};
  for (const p of parts) variantMap[p] = [p];
  for (const { base_char, variant_char } of rows) {
    if (parts.includes(base_char) && !variantMap[base_char].includes(variant_char)) {
      variantMap[base_char].push(variant_char);
    }
    if (parts.includes(variant_char) && !variantMap[variant_char].includes(base_char)) {
      variantMap[variant_char].push(base_char);
    }
  }
  return parts.map(p => variantMap[p]);
}

// ─── Feature 8: calcScore ヘルパー ────────────────────────────────────────────
// patternParts: DB から取得した漢字のパーツ配列（row.parts）
// inputParts:   ユーザーが入力した検索パーツ配列
function calcScore(patternParts, inputParts) {
  const kanjiParts = patternParts.filter(p => p.codePointAt(0) > 0x007F);
  const total = kanjiParts.length;
  if (!total) return 0;

  // match rate（既存ロジック）
  const cnt = {};
  inputParts.forEach(p => (cnt[p] = (cnt[p] || 0) + 1));
  let match = 0;
  Object.entries(cnt).forEach(([p, n]) => {
    const occ = patternParts.filter(c => c === p).length;
    match += Math.min(n, occ);
  });
  const matchRate = (match / total) * 100;

  // order bonus: inputParts が patternParts の部分列（subsequence）として現れるか確認
  let ptr = 0;
  let orderMatched = 0;
  for (const pp of patternParts) {
    if (ptr < inputParts.length && pp === inputParts[ptr]) {
      orderMatched++;
      ptr++;
    }
  }
  const orderBonus = (orderMatched / inputParts.length) * 20;

  return matchRate + orderBonus;
}

// ─── POST /api/search ─────────────────────────────────────────────────────────
// body: { parts: string[], mode: 'partsToKanji' | 'kanjiToParts', region: 'joyo' | 'japanese' | 'chinese' }
app.post('/api/search', async (req, res) => {
  const { parts, mode, region } = req.body;
  if (!parts?.length) return res.json({ results: [] });

  // Feature 7: 検索ログを記録（fire-and-forget）
  const query = parts.join('');
  pool.query(
    `INSERT INTO search_logs (query, mode, region) VALUES ($1, $2, $3)`,
    [query, mode ?? null, region ?? null]
  ).catch(err => console.error('search_logs insert error:', err.message));

  const client = await pool.connect();
  try {
    // ── 漢字→部品 ──────────────────────────────────────────────────────────────
    if (mode === 'kanjiToParts') {
      const kanji = parts[0];
      const { rows } = await client.query(
        `SELECT layer_index, parts FROM kanji_patterns
         WHERE kanji_char = $1
         ORDER BY layer_index`,
        [kanji]
      );
      const seen = new Set();
      const out = [];
      for (const row of rows) {
        for (const p of row.parts) {
          if (p.codePointAt(0) > 0x007F && !seen.has(p)) {
            seen.add(p);
            out.push(p);
          }
        }
      }
      return res.json({ results: out });
    }

    // ── 部品→漢字（単一部品）────────────────────────────────────────────────────
    if (parts.length === 1) {
      const variantArrays = await expandWithVariants(client, parts);
      const allParts = variantArrays.flat();

      let query = `
        SELECT DISTINCT kp.kanji_char
        FROM kanji_parts kp
        JOIN kanji k ON k.character = kp.kanji_char
        WHERE kp.part_char = ANY($1)
      `;
      const params = [allParts];

      if (region === 'joyo') {
        query += ` AND k.is_joyo = true`;
      } else if (region === 'japanese') {
        query += ` AND (k.is_joyo = true OR k.is_japanese = true)`;
      }

      const { rows } = await client.query(query, params);
      // 自身を先頭に
      const results = rows.map(r => r.kanji_char);
      const self = parts[0];
      const deduped = [self, ...results.filter(k => k !== self)];
      return res.json({ results: deduped });
    }

    // ── 部品→漢字（複数部品）────────────────────────────────────────────────────
    const variantArrays = await expandWithVariants(client, parts);

    // 全組み合わせを生成
    const cartesian = arrays =>
      arrays.reduce((acc, curr) => acc.flatMap(a => curr.map(b => [...a, b])), [[]]);
    const combos = cartesian(variantArrays);

    // 全 combo で intersection を取り matchCount を集計
    const matchCount = new Map();
    for (const combo of combos) {
      // combo に含まれる全部品を持つ漢字を取得
      const { rows } = await client.query(
        `SELECT kanji_char FROM kanji_parts
         WHERE part_char = ANY($1)
         GROUP BY kanji_char
         HAVING COUNT(DISTINCT part_char) = $2`,
        [combo, combo.length]
      );
      for (const { kanji_char } of rows) {
        matchCount.set(kanji_char, (matchCount.get(kanji_char) || 0) + 1);
      }
    }

    // region フィルター
    let candidates = [...matchCount.keys()];
    if (region !== 'chinese') {
      const { rows: kanjiRows } = await client.query(
        `SELECT character FROM kanji
         WHERE character = ANY($1) AND ${region === 'joyo' ? 'is_joyo = true' : '(is_joyo = true OR is_japanese = true)'}`,
        [candidates]
      );
      const allowed = new Set(kanjiRows.map(r => r.character));
      candidates = candidates.filter(k => allowed.has(k));
    }

    // Feature 8: calcScore でスコア計算し上位100件にソート
    const scored = await Promise.all(
      candidates.map(async k => {
        const { rows } = await client.query(
          `SELECT parts FROM kanji_patterns WHERE kanji_char = $1 ORDER BY layer_index`,
          [k]
        );
        const score = rows.reduce((best, row) => {
          return Math.max(best, calcScore(row.parts, parts));
        }, 0);
        return { k, score };
      })
    );

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map(o => o.k);

    return res.json({ results });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Feature 7: GET /api/ranking ──────────────────────────────────────────────
// ?period=day|week|month&limit=10
app.get('/api/ranking', async (req, res) => {
  const { period = 'day', limit = '10' } = req.query;

  // 安全なマッピング（文字列補間は使わない）
  const intervalMap = {
    day:   '1 day',
    week:  '7 days',
    month: '30 days',
  };
  const intervalStr = intervalMap[period] ?? '1 day';
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 10));

  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT query, COUNT(*) AS count
       FROM search_logs
       WHERE logged_at >= NOW() - $1::INTERVAL
       GROUP BY query
       ORDER BY count DESC
       LIMIT $2`,
      [intervalStr, limitNum]
    );
    res.json({ period, limit: limitNum, ranking: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Feature 5: POST /api/search/subtract ────────────────────────────────────
// body: { minuend: '汲', subtrahend: '氵', region: 'joyo' }
app.post('/api/search/subtract', async (req, res) => {
  const { minuend, subtrahend, region } = req.body;
  if (!minuend || !subtrahend) {
    return res.status(400).json({ error: 'minuend and subtrahend are required' });
  }

  const client = await pool.connect();
  try {
    // minuend の直接部品（layer_index=0）を取得
    const { rows: patternRows } = await client.query(
      `SELECT parts FROM kanji_patterns
       WHERE kanji_char = $1 AND layer_index = 0`,
      [minuend]
    );

    if (!patternRows.length) {
      return res.json({ results: [], remainingParts: [] });
    }

    // 漢字文字のみ抽出
    const directParts = patternRows[0].parts.filter(
      p => p.codePointAt(0) > 0x007F
    );

    // subtrahend を1回除去
    const remaining = [...directParts];
    const subIdx = remaining.indexOf(subtrahend);
    if (subIdx !== -1) {
      remaining.splice(subIdx, 1);
    }

    if (!remaining.length) {
      return res.json({ results: [], remainingParts: remaining });
    }

    // 既存の複数部品検索ロジックと同じ処理
    const variantArrays = await expandWithVariants(client, remaining);

    const cartesian = arrays =>
      arrays.reduce((acc, curr) => acc.flatMap(a => curr.map(b => [...a, b])), [[]]);
    const combos = cartesian(variantArrays);

    const matchCount = new Map();
    for (const combo of combos) {
      const { rows } = await client.query(
        `SELECT kanji_char FROM kanji_parts
         WHERE part_char = ANY($1)
         GROUP BY kanji_char
         HAVING COUNT(DISTINCT part_char) = $2`,
        [combo, combo.length]
      );
      for (const { kanji_char } of rows) {
        matchCount.set(kanji_char, (matchCount.get(kanji_char) || 0) + 1);
      }
    }

    let candidates = [...matchCount.keys()];
    if (region && region !== 'chinese') {
      const { rows: kanjiRows } = await client.query(
        `SELECT character FROM kanji
         WHERE character = ANY($1) AND ${region === 'joyo' ? 'is_joyo = true' : '(is_joyo = true OR is_japanese = true)'}`,
        [candidates]
      );
      const allowed = new Set(kanjiRows.map(r => r.character));
      candidates = candidates.filter(k => allowed.has(k));
    }

    const scored = await Promise.all(
      candidates.map(async k => {
        const { rows } = await client.query(
          `SELECT parts FROM kanji_patterns WHERE kanji_char = $1 ORDER BY layer_index`,
          [k]
        );
        const score = rows.reduce((best, row) => {
          return Math.max(best, calcScore(row.parts, remaining));
        }, 0);
        return { k, score };
      })
    );

    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map(o => o.k);

    return res.json({ results, remainingParts: remaining });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── GET /api/kanji/:char ─────────────────────────────────────────────────────
app.get('/api/kanji/:char', async (req, res) => {
  const char = req.params.char;
  const client = await pool.connect();
  try {
    const [kanjiRes, partsRes] = await Promise.all([
      client.query(`SELECT * FROM kanji WHERE character = $1`, [char]),
      client.query(`SELECT part_char FROM kanji_parts WHERE kanji_char = $1`, [char]),
    ]);
    if (!kanjiRes.rows.length) return res.status(404).json({ error: 'not found' });
    res.json({
      ...kanjiRes.rows[0],
      parts: partsRes.rows.map(r => r.part_char),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ─── Feature 4: POST /api/handwriting ────────────────────────────────────────
// body: { ink, width, height }
app.post('/api/handwriting', async (req, res) => {
  const { ink, width, height } = req.body;
  if (!ink) return res.status(400).json({ error: 'ink is required' });

  const payload = {
    app_version: 0.1,
    api_level: 'rc',
    options: 'enable_pre_space',
    requests: [
      {
        writing_guide: {
          writing_area_width: width,
          writing_area_height: height,
        },
        ink,
        language: 'ja',
        pre_context: '',
        n_best_size: 7,
        auto_commit_n_best_size: 7,
      },
    ],
  };

  try {
    const response = await fetch(
      'https://inputtools.google.com/request?itc=ja-t-i0-handwrit&num=7',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );
    const data = await response.json();
    const candidates = data?.[1]?.[0]?.[1] ?? [];
    res.json({ candidates });
  } catch (err) {
    console.error('handwriting proxy error:', err.message);
    res.status(502).json({ error: 'handwriting service unavailable' });
  }
});

// ─── Feature 6: GET /sitemap.xml（express.static の前に配置）─────────────────
app.get('/sitemap.xml', async (req, res) => {
  const rootUrl = 'https://kanji-dict.brwqz.net';
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT character FROM kanji WHERE is_joyo = true ORDER BY character`
    );

    const urls = [
      `  <url><loc>${rootUrl}/</loc></url>`,
      ...rows.map(r => `  <url><loc>${rootUrl}/kanji/${encodeURIComponent(r.character)}</loc></url>`),
    ].join('\n');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml');
    res.send(xml);
  } catch (err) {
    console.error('sitemap error:', err.message);
    res.status(500).send('<?xml version="1.0"?><error/>');
  } finally {
    client.release();
  }
});

// ─── React 静的ファイル配信 ───────────────────────────────────────────────────
const buildPath = path.join(__dirname, '../build');
app.use(express.static(buildPath));
app.use((req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 API server running on port ${PORT}`));
