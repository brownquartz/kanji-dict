require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(cors());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

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

// ─── POST /api/search ─────────────────────────────────────────────────────────
// body: { parts: string[], mode: 'partsToKanji' | 'kanjiToParts', region: 'joyo' | 'japanese' | 'chinese' }
app.post('/api/search', async (req, res) => {
  const { parts, mode, region } = req.body;
  if (!parts?.length) return res.json({ results: [] });

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

    // スコアで上位100件にソート
    const scored = await Promise.all(
      candidates.map(async k => {
        const { rows } = await client.query(
          `SELECT parts FROM kanji_patterns WHERE kanji_char = $1 ORDER BY layer_index`,
          [k]
        );
        const score = rows.reduce((best, row) => {
          const total = row.parts.filter(p => p.codePointAt(0) > 0x007F).length;
          if (!total) return best;
          const cnt = {};
          parts.forEach(p => (cnt[p] = (cnt[p] || 0) + 1));
          let match = 0;
          Object.entries(cnt).forEach(([p, n]) => {
            const occ = row.parts.filter(c => c === p).length;
            match += Math.min(n, occ);
          });
          return Math.max(best, (match / total) * 100);
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

// ─── React 静的ファイル配信 ───────────────────────────────────────────────────
const buildPath = path.join(__dirname, '../build');
app.use(express.static(buildPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(buildPath, 'index.html'));
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 API server running on port ${PORT}`));
