import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL이 설정되지 않았습니다.');
  process.exit(1);
}

const db = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS videos(
      id TEXT PRIMARY KEY,
      title TEXT,
      channel TEXT,
      region TEXT,
      thumbnail TEXT,
      publishedAt TEXT,
      duration TEXT,
      views BIGINT,
      lastSeen BIGINT
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS snapshots(
      videoId TEXT,
      ts BIGINT,
      views BIGINT,
      PRIMARY KEY(videoId, ts)
    )
  `);

  console.log('PostgreSQL 데이터베이스 연결 완료');
}

app.use(express.static('public'));
app.use(express.json());

const regions = [
  'US','KR','JP','GB','IN','BR','DE','FR','CA','AU',
  'MX','ID','TR','ES','IT','NL','PL','SE','NO','DK',
  'FI','PH','TH','VN','MY','SG','TW','HK','AE','SA',
  'ZA','AR','CL','CO','PE','NZ','IE','PT','BE','AT',
  'CH','CZ','RO','HU','GR','IL','EG','MA','NG','KE'
];

async function yt(path, params = {}) {
  if (!process.env.YOUTUBE_API_KEY) return null;

  const u = new URL('https://www.googleapis.com/youtube/v3/' + path);

  Object.entries({
    ...params,
    key: process.env.YOUTUBE_API_KEY
  }).forEach(([k, v]) => u.searchParams.set(k, v));

  const response = await fetch(u);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

async function refreshRegion(region) {
  const data = await yt('videos', {
    part: 'snippet,statistics,contentDetails',
    chart: 'mostPopular',
    regionCode: region,
    maxResults: '50'
  });

  if (!data) return;

  const now = Date.now();
  const snapshotTime = Math.floor(now / 600000) * 600000;

  for (const x of data.items || []) {
    const views = Number(x.statistics?.viewCount || 0);

    await db.query(`
      INSERT INTO videos
        (id,title,channel,region,thumbnail,publishedAt,duration,views,lastSeen)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(id) DO UPDATE SET
        title=EXCLUDED.title,
        channel=EXCLUDED.channel,
        region=EXCLUDED.region,
        thumbnail=EXCLUDED.thumbnail,
        publishedAt=EXCLUDED.publishedAt,
        duration=EXCLUDED.duration,
        views=EXCLUDED.views,
        lastSeen=EXCLUDED.lastSeen
    `, [
      x.id,
      x.snippet.title,
      x.snippet.channelTitle,
      region,
      x.snippet.thumbnails?.medium?.url || '',
      x.snippet.publishedAt,
      x.contentDetails?.duration || '',
      views,
      now
    ]);

    await db.query(`
      INSERT INTO snapshots(videoId,ts,views)
      VALUES($1,$2,$3)
      ON CONFLICT(videoId,ts)
      DO UPDATE SET views=EXCLUDED.views
    `, [x.id, snapshotTime, views]);
  }
}

async function delta(id, views, ms) {
  const cutoff = Date.now() - ms;

  const result = await db.query(`
    SELECT views
    FROM snapshots
    WHERE videoId=$1 AND ts<=$2
    ORDER BY ts DESC
    LIMIT 1
  `, [id, cutoff]);

  if (!result.rows.length) return null;

  return Math.max(
    0,
    Number(views) - Number(result.rows[0].views)
  );
}

app.get('/api/status', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) AS n FROM videos'
    );

    res.json({
      apiConfigured: !!process.env.YOUTUBE_API_KEY,
      databaseConfigured: !!process.env.DATABASE_URL,
      tracked: Number(result.rows[0].n)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/refresh', async (req, res) => {
  try {
    const wanted = req.body?.region
      ? [req.body.region]
      : regions;

    for (const region of wanted.slice(0, 8)) {
      await refreshRegion(region);
    }

    res.json({
      ok: true,
      regions: wanted.slice(0, 8)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/rankings', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT *
      FROM videos
      ORDER BY views DESC
      LIMIT 5000
    `);

    let rows = result.rows.map(x => ({
      ...x,
      views: Number(x.views),
      lastSeen: Number(x.lastseen)
    }));

    const region = req.query.region;

    if (region && region !== 'ALL') {
      rows = rows.filter(x => x.region === region);
    }

    const type = req.query.type || 'all';

    rows = await Promise.all(
      rows.map(async x => {
        const d10 = await delta(x.id, x.views, 10 * 60000);
        const d1 = await delta(x.id, x.views, 60 * 60000);
        const d6 = await delta(x.id, x.views, 6 * 60 * 60000);
        const d24 = await delta(x.id, x.views, 24 * 60 * 60000);

        return {
          ...x,
          d10,
          d1,
          d6,
          d24,
          velocity: d1 ?? (d10 != null ? d10 * 6 : 0),
          isShort:
            /^PT(?:(?:[0-5]?\d)S|1M(?:[0-0]?\dS)?)$/
              .test(x.duration)
        };
      })
    );

    if (type === 'shorts') {
      rows = rows.filter(x => x.isShort);
    }

    if (type === 'long') {
      rows = rows.filter(x => !x.isShort);
    }

    const metric = req.query.metric || 'd1';

    rows.sort(
      (a, b) =>
        (b[metric] ?? -1) -
        (a[metric] ?? -1)
    );

    res.json(
      rows.slice(
        0,
        Math.min(Number(req.query.limit) || 100, 500)
      )
    );
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// // 10분마다 국가를 8개씩 순환하며 자동 수집
let regionIndex = 0;

setInterval(async () => {
  try {
    const batch = [];

    for (let i = 0; i < 8; i++) {
      batch.push(regions[(regionIndex + i) % regions.length]);
    }

    console.log('자동 수집 국가:', batch.join(', '));

    for (const region of batch) {
      await refreshRegion(region);
    }

    regionIndex = (regionIndex + 8) % regions.length;

    console.log('자동 데이터 수집 완료');
  } catch (error) {
    console.error('자동 데이터 수집 오류:', error.message);
  }
}, 10 * 60 * 1000);

async function start() {
  try {
    await initDB();

    app.listen(port, () => {
      console.log(
        `Global YouTube Radar running on port ${port}`
      );
    });
  } catch (error) {
    console.error('서버 시작 실패:', error);
    process.exit(1);
  }
}

start();
