// scripts/import-jmdict.js
// JMdict (EDRDG) から熟語・単語データを取り込み、words テーブルを新規作成して投入する。
//
// データ出典: JMdict (EDRDG, Creative Commons Attribution-ShareAlike Licence 4.0)
//   http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
//
// 事前準備: 上記URLから JMdict_e.gz をダウンロードし、scripts/JMdict_e.gz に置く。
// 実行方法: node scripts/import-jmdict.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const sax = require('sax');
const { Pool } = require('pg');

const GZ_PATH = path.join(__dirname, 'JMdict_e.gz');
const BATCH_SIZE = 1000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── Phase 1: XML を entry 単位でパースしてメモリに溜める ────────────────────
// entry = { kebs: string[], rebs: string[], glosses: string[] }
function parseJMdict() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(GZ_PATH)) {
      reject(new Error(`JMdict_e.gz が見つかりません: ${GZ_PATH}`));
      return;
    }

    const entries = [];
    let current = null;
    const stack = [];

    const saxStream = sax.createStream(false, { lowercase: true, trim: true, normalize: true });

    saxStream.on('opentag', (node) => {
      stack.push(node.name);
      if (node.name === 'entry') {
        current = { kebs: [], rebs: [], glosses: [] };
      }
    });

    saxStream.on('text', (text) => {
      if (!current || !text) return;
      const tag = stack[stack.length - 1];
      switch (tag) {
        case 'keb':
          current.kebs.push(text);
          break;
        case 'reb':
          current.rebs.push(text);
          break;
        case 'gloss':
          current.glosses.push(text);
          break;
      }
    });

    saxStream.on('closetag', (name) => {
      stack.pop();
      if (name === 'entry') {
        if (current && current.rebs.length) entries.push(current);
        current = null;
      }
    });

    // JMdictはDTDにエンティティ参照(品詞タグなど)を含むため、sax標準では
    // パースエラーになることがある。kanjidic2と同様、エラーは無視して再開する。
    saxStream.on('error', () => {
      if (saxStream._parser) saxStream._parser.error = null;
      saxStream.resume?.();
    });

    saxStream.on('end', () => resolve(entries));

    fs.createReadStream(GZ_PATH)
      .pipe(zlib.createGunzip())
      .pipe(saxStream)
      .on('error', reject);
  });
}

// ─── Phase 2: entry を words テーブルの行に変換する ───────────────────────────
// 表記(keb)がある場合は 表記×読み の組み合わせごとに1行、
// 表記がない(かな書きのみの)語は 読みごとに1行(kanji_form = NULL)。
function toRows(entries) {
  const rows = [];
  for (const e of entries) {
    if (!e.glosses.length) continue;
    const meanings = JSON.stringify({ en: e.glosses });
    if (e.kebs.length) {
      for (const keb of e.kebs) {
        for (const reb of e.rebs) {
          rows.push([keb, reb, meanings]);
        }
      }
    } else {
      for (const reb of e.rebs) {
        rows.push([null, reb, meanings]);
      }
    }
  }
  return rows;
}

// ─── Phase 3: テーブル作成 + バッチ投入 ───────────────────────────────────────
async function createTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS words (
      id         SERIAL PRIMARY KEY,
      kanji_form TEXT,
      reading    TEXT NOT NULL,
      meanings   JSONB DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS idx_words_kanji_form ON words(kanji_form);
    CREATE INDEX IF NOT EXISTS idx_words_reading ON words(reading);
  `);
}

async function batchInsert(client, rows) {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const placeholders = chunk.map((row, ri) => {
      const ph = row.map((_, ci) => `$${ri * 3 + ci + 1}`).join(', ');
      values.push(...row);
      return `(${ph})`;
    });
    await client.query(
      `INSERT INTO words (kanji_form, reading, meanings) VALUES ${placeholders.join(', ')}`,
      values
    );
    process.stdout.write(`\r  投入中: ${Math.min(i + BATCH_SIZE, rows.length)} / ${rows.length}`);
  }
  console.log();
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('JMdict_e.gz をパース中...');
  const entries = await parseJMdict();
  console.log(`エントリ数: ${entries.length}`);

  const rows = toRows(entries);
  console.log(`words 行数: ${rows.length}`);

  const client = await pool.connect();
  try {
    console.log('テーブル作成中...');
    await createTable(client);
    console.log('データ投入中...');
    await batchInsert(client, rows);
    const { rows: countRows } = await client.query('SELECT COUNT(*) FROM words');
    console.log(`\n✅ 完了! words テーブル総行数: ${countRows[0].count}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
