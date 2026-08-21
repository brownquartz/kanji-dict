// scripts/import-wordnet-words.js
// 日本語WordNetから熟語・単語(words テーブル)の日本語での定義を取得し、
// meanings.ja にマージする。import-wordnet.js の単語版。
//
// 実行手順:
//   1. import-wordnet.js と同じ wnjpn.db を scripts/ フォルダに置く
//   2. node scripts/import-wordnet-words.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Pool } = require('pg');

const DB_PATH = path.join(__dirname, 'wnjpn.db');
const BATCH_SIZE = 500;

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ WordNetのDBファイルが見つかりません: ${DB_PATH}`);
  console.error('  import-wordnet.js と同じ手順で wnjpn.db を用意してください。');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── WordNetから語(熟語含む)の日本語定義を取得 ────────────────────────────────
// import-wordnet.js の getMeaningsFromWordNet と同じロジックだが、
// 1文字の漢字に限らず任意の表記(lemma)で検索する。
function getMeaningsFromWordNet(wn, lemma) {
  const words = wn.prepare(`
    SELECT wordid FROM word
    WHERE lemma = ? AND lang = 'jpn'
  `).all(lemma);

  if (!words.length) return [];

  const wordIds = words.map(w => w.wordid);
  const placeholders = wordIds.map(() => '?').join(',');

  const synsets = wn.prepare(`
    SELECT DISTINCT s.synset FROM sense s
    WHERE s.wordid IN (${placeholders}) AND s.lang = 'jpn'
  `).all(...wordIds);

  if (!synsets.length) return [];

  const synsetIds = synsets.map(s => s.synset);
  const synsetPlaceholders = synsetIds.map(() => '?').join(',');

  const defs = wn.prepare(`
    SELECT def FROM synset_def
    WHERE synset IN (${synsetPlaceholders}) AND lang = 'jpn'
  `).all(...synsetIds);

  return [...new Set(defs.map(d => d.def).filter(Boolean))];
}

// ─── メイン ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('WordNet DB を開いています...');
  const wn = new Database(DB_PATH, { readonly: true });

  const client = await pool.connect();
  try {
    // 日本語定義がまだ無い、表記(kanji_form)を持つ語の distinct kanji_form 一覧
    const { rows: forms } = await client.query(`
      SELECT DISTINCT kanji_form FROM words
      WHERE kanji_form IS NOT NULL
        AND NOT (meanings ? 'ja')
      ORDER BY kanji_form
    `);
    console.log(`対象の表記数: ${forms.length}`);

    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < forms.length; i++) {
      const kanjiForm = forms[i].kanji_form;
      const meanings = getMeaningsFromWordNet(wn, kanjiForm);

      if (meanings.length === 0) {
        skipped++;
      } else {
        await client.query(`
          UPDATE words
          SET meanings = COALESCE(meanings, '{}'::jsonb) || $1::jsonb
          WHERE kanji_form = $2 AND NOT (meanings ? 'ja')
        `, [JSON.stringify({ ja: meanings }), kanjiForm]);
        updated++;
      }

      if ((i + 1) % BATCH_SIZE === 0 || i === forms.length - 1) {
        process.stdout.write(`\r  進捗: ${i + 1}/${forms.length} (更新: ${updated}, スキップ: ${skipped})`);
      }
    }

    console.log(`\n\n✅ 完了! 更新: ${updated} 表記, スキップ（WordNetになし）: ${skipped} 表記`);

    const { rows: stats } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE meanings ? 'ja') AS has_ja,
        COUNT(*) FILTER (WHERE meanings ? 'en') AS has_en
      FROM words
    `);
    console.log('\nDB状況:');
    console.log(`  日本語意味あり: ${stats[0].has_ja} 行`);
    console.log(`  英語意味あり:   ${stats[0].has_en} 行`);

  } finally {
    client.release();
    await pool.end();
    wn.close();
  }
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
