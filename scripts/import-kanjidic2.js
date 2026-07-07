// scripts/import-kanjidic2.js
// One-time migration: downloads KanjiDic2 XML, parses it, and updates the kanji table.
//
// Usage: node scripts/import-kanjidic2.js

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const http = require('http');
const zlib = require('zlib');
const sax = require('sax');
const { Pool } = require('pg');

const KANJIDIC2_URL = 'http://www.edrdg.org/kanjidic/kanjidic2.xml.gz';
const BATCH_SIZE = 100;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ─── SAX parsing state ───────────────────────────────────────────────────────

// Element path stack
const stack = [];

// Current character being built
let current = null;

// Flags for where we are inside a character
let inMisc = false;
let inMeaning = false;
let meaningLang = null; // null = English (no m_lang attr)

// Batch accumulator
const batch = [];
let totalProcessed = 0;

// ─── DB update helper ────────────────────────────────────────────────────────

async function flushBatch(client, records) {
  if (records.length === 0) return;

  for (const rec of records) {
    const enMeanings = rec.meanings; // array of strings

    await client.query(
      `UPDATE kanji
       SET
         meanings    = COALESCE(meanings, '{}'::jsonb) || $1::jsonb,
         stroke_count = COALESCE(stroke_count, $2),
         grade        = COALESCE(grade, $3),
         jlpt_level   = COALESCE(jlpt_level, $4),
         frequency    = COALESCE(frequency, $5)
       WHERE literal = $6`,
      [
        JSON.stringify({ en: enMeanings }),
        rec.stroke_count !== undefined ? rec.stroke_count : null,
        rec.grade       !== undefined ? rec.grade       : null,
        rec.jlpt        !== undefined ? rec.jlpt        : null,
        rec.freq        !== undefined ? rec.freq        : null,
        rec.literal,
      ]
    );
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const client = await pool.connect();

  try {
    console.log('Connecting to DB … OK');
    console.log(`Downloading ${KANJIDIC2_URL} …`);

    await new Promise((resolve, reject) => {
      http.get(KANJIDIC2_URL, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }

        const gunzip = zlib.createGunzip();
        const saxStream = sax.createStream(false /* not strict */, {
          lowercase: true,
          trim: true,
          normalize: true,
        });

        // ── SAX event handlers ──────────────────────────────────────────────

        saxStream.on('opentag', (node) => {
          stack.push(node.name);

          switch (node.name) {
            case 'character':
              current = {
                literal: null,
                meanings: [],
                stroke_count: undefined,
                grade: undefined,
                jlpt: undefined,
                freq: undefined,
              };
              inMisc = false;
              inMeaning = false;
              break;

            case 'misc':
              if (current) inMisc = true;
              break;

            case 'meaning':
              if (current) {
                inMeaning = true;
                // m_lang attribute is absent for English entries
                // In non-strict (lowercase) mode attr names are lowercased
                meaningLang = node.attributes['m_lang'] || null;
              }
              break;
          }
        });

        saxStream.on('text', (text) => {
          if (!current) return;
          const tag = stack[stack.length - 1];

          switch (tag) {
            case 'literal':
              current.literal = text;
              break;

            case 'stroke_count':
              if (inMisc && current.stroke_count === undefined) {
                const v = parseInt(text, 10);
                if (!isNaN(v)) current.stroke_count = v;
              }
              break;

            case 'grade':
              if (inMisc) {
                const v = parseInt(text, 10);
                if (!isNaN(v)) current.grade = v;
              }
              break;

            case 'jlpt':
              if (inMisc) {
                const v = parseInt(text, 10);
                if (!isNaN(v)) current.jlpt = v;
              }
              break;

            case 'freq':
              if (inMisc) {
                const v = parseInt(text, 10);
                if (!isNaN(v)) current.freq = v;
              }
              break;

            case 'meaning':
              if (inMeaning && meaningLang === null) {
                // English meaning — no m_lang attribute
                current.meanings.push(text);
              }
              break;
          }
        });

        saxStream.on('closetag', async (name) => {
          stack.pop();

          switch (name) {
            case 'misc':
              inMisc = false;
              break;

            case 'meaning':
              inMeaning = false;
              meaningLang = null;
              break;

            case 'character':
              if (current && current.literal) {
                batch.push({ ...current });
                totalProcessed++;

                if (totalProcessed % 1000 === 0) {
                  console.log(`  … processed ${totalProcessed} kanji`);
                }

                if (batch.length >= BATCH_SIZE) {
                  const chunk = batch.splice(0, BATCH_SIZE);
                  // pause stream while writing
                  saxStream.pause && saxStream.pause();
                  try {
                    await flushBatch(client, chunk);
                  } catch (err) {
                    console.error('DB flush error:', err.message);
                  }
                  saxStream.resume && saxStream.resume();
                }
              }
              current = null;
              inMisc = false;
              inMeaning = false;
              break;
          }
        });

        saxStream.on('error', (err) => {
          // KanjiDic2 has a DOCTYPE / entity declarations that may cause
          // parse errors in non-strict mode — safe to ignore and continue.
          if (saxStream._parser) saxStream._parser.error = null;
          saxStream.resume && saxStream.resume();
        });

        saxStream.on('end', async () => {
          // Flush remaining records
          if (batch.length > 0) {
            try {
              await flushBatch(client, batch.splice(0));
            } catch (err) {
              console.error('Final DB flush error:', err.message);
            }
          }
          console.log(`\nDone! Total kanji processed: ${totalProcessed}`);
          resolve();
        });

        res.pipe(gunzip).pipe(saxStream);

        gunzip.on('error', reject);
        saxStream.on('error', (err) => {
          // Already handled above; avoid uncaught rejection
        });
      }).on('error', reject);
    });

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
