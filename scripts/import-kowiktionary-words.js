// scripts/import-kowiktionary-words.js
// 韓国語版ウィクショナリー(ko.wiktionary.org)から、日本語の熟語・単語の韓国語での意味を取得し、
// words.meanings.ko にマージする。import-kowiktionary.js の単語版。
//
// ko.wiktionary は日本語の表記そのままのページに「==일본어==」セクションを持ち、
// その中に韓国語での訳語（例: 学校 -> 학교; 학원）が定義されている。
//
// 実行方法: node scripts/import-kowiktionary-words.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const https = require('https');
const { Pool } = require('pg');

const API_BASE = 'https://ko.wiktionary.org/w/api.php';
const USER_AGENT = 'kanji-dict/1.0 (contact: parkcm2262@gmail.com; one-time batch import)';
const BATCH_SIZE = 50;
const DELAY_MS = 300;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function apiGet(params) {
  const url = `${API_BASE}?${new URLSearchParams(params).toString()}`;
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

// ─── wikitext の「==일본어==」セクションから韓国語の語釈(#や*'''N.'''の行)を抜き出す ──
function extractJapaneseKoDefs(wikitext) {
  const secMatch = wikitext.match(/==\s*일본어\s*==([\s\S]*?)(?=\n==[^=]|$)/);
  if (!secMatch) return [];
  const section = secMatch[1];
  const defs = [];
  for (const line of section.split('\n')) {
    const t = line.trim();
    const m = t.match(/^#\s+(.*)$/) || t.match(/^\*\s*'''\d+\.'''\s*(.*)$/);
    if (!m) continue;
    const text = m[1]
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (full, target, pipe) => pipe ? pipe.slice(1) : target)
      .replace(/'''?/g, '')
      .replace(/\.$/, '')
      .trim();
    if (text) defs.push(text);
  }
  return [...new Set(defs)];
}

async function fetchBatch(words) {
  const data = await apiGet({
    action: 'query',
    titles: words.join('|'),
    prop: 'revisions',
    rvprop: 'content',
    format: 'json',
    formatversion: '2',
  });
  const out = new Map();
  for (const page of data.query?.pages || []) {
    if (page.missing || !page.revisions?.length) continue;
    const defs = extractJapaneseKoDefs(page.revisions[0].content);
    if (defs.length) out.set(page.title, defs);
  }
  return out;
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT DISTINCT kanji_form FROM words
      WHERE kanji_form IS NOT NULL
        AND NOT (meanings ? 'ko')
      ORDER BY kanji_form
    `);
    console.log(`対象の表記数: ${rows.length}`);

    let updated = 0;
    let checked = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const chunk = rows.slice(i, i + BATCH_SIZE).map(r => r.kanji_form);
      let defMap;
      try {
        defMap = await fetchBatch(chunk);
      } catch (e) {
        console.error(`\nバッチ取得失敗 (${i}): ${e.message}`);
        await sleep(DELAY_MS * 3);
        continue;
      }

      for (const [kanjiForm, defs] of defMap) {
        await client.query(`
          UPDATE words
          SET meanings = COALESCE(meanings, '{}'::jsonb) || $1::jsonb
          WHERE kanji_form = $2 AND NOT (meanings ? 'ko')
        `, [JSON.stringify({ ko: defs }), kanjiForm]);
        updated++;
      }

      checked += chunk.length;
      process.stdout.write(`\r  進捗: ${checked}/${rows.length} (取得: ${updated})`);
      await sleep(DELAY_MS);
    }

    console.log(`\n\n✅ 完了! 韓国語の意味を取得: ${updated} 表記`);

    const { rows: stats } = await client.query(`SELECT COUNT(*) FILTER (WHERE meanings ? 'ko') AS has_ko FROM words`);
    console.log(`DB全体で韓国語意味あり: ${stats[0].has_ko} 行`);

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
