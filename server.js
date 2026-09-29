import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

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

app.use(express.json());
app.use(express.static('public'));

const regions = [
  'KR','US','JP','GB','IN','BR','DE','FR','CA','AU',
  'MX','ID','TR','ES','IT','NL','PL','SE','NO','DK',
  'FI','PH','TH','VN','MY','SG','TW','HK','AE','SA',
  'ZA','AR','CL','CO','PE','NZ','IE','PT','BE','AT',
  'CH','CZ','RO','HU','GR','IL','EG','MA','NG','KE'
];

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
      views BIGINT DEFAULT 0,
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS channels(
      channel_id TEXT PRIMARY KEY,
      title TEXT,
      subscriber_count BIGINT DEFAULT 0,
      view_count BIGINT DEFAULT 0,
      video_count BIGINT DEFAULT 0,
      hidden_subscriber_count BOOLEAN DEFAULT FALSE,
      last_seen BIGINT
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS channel_snapshots(
      channel_id TEXT,
      ts BIGINT,
      subscriber_count BIGINT DEFAULT 0,
      view_count BIGINT DEFAULT 0,
      video_count BIGINT DEFAULT 0,
      PRIMARY KEY(channel_id, ts)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS video_regions(
      video_id TEXT,
      region TEXT,
      last_seen BIGINT,
      PRIMARY KEY(video_id, region)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users(
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT,
      plan TEXT NOT NULL DEFAULT 'FREE',
      subscription_status TEXT NOT NULL DEFAULT 'inactive',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions(
      token_hash TEXT PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS snapshots_video_ts_idx
    ON snapshots(videoId, ts DESC)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS video_regions_region_idx
    ON video_regions(region, video_id)
  `);

  console.log('PostgreSQL 데이터베이스 연결 완료');
}

async function yt(path, params = {}) {
  if (!process.env.YOUTUBE_API_KEY) return null;

  const url = new URL(
    'https://www.googleapis.com/youtube/v3/' + path
  );

  Object.entries({
    ...params,
    key: process.env.YOUTUBE_API_KEY
  }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

function parseCookies(req) {
  const cookies = {};

  for (const item of (req.headers.cookie || '').split(';')) {
    const index = item.indexOf('=');

    if (index === -1) continue;

    const key = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();

    if (key) cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function hashToken(token) {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

async function getUser(req) {
  const token = parseCookies(req).radar_session;

  if (!token) return null;

  const result = await db.query(`
    SELECT
      u.id,
      u.email,
      u.nickname,
      u.plan,
      u.subscription_status
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
    LIMIT 1
  `, [hashToken(token)]);

  return result.rows[0] || null;
}

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);

  await db.query(`
    INSERT INTO sessions(token_hash,user_id,expires_at)
    VALUES($1,$2,NOW() + INTERVAL '30 days')
  `, [tokenHash, userId]);

  res.cookie('radar_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}
async function refreshChannels(channelIds = []) {
  const ids = [...new Set(channelIds.filter(Boolean))];
  if (!ids.length) return;

  const now = Date.now();

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);

    const data = await yt('channels', {
      part: 'snippet,statistics',
      id: batch.join(','),
      maxResults: '50'
    });

    if (!data?.items) continue;

    for (const channel of data.items) {
      const stats = channel.statistics || {};

      const subscribers = Number(stats.subscriberCount || 0);
      const views = Number(stats.viewCount || 0);
      const videos = Number(stats.videoCount || 0);
      const hidden = Boolean(stats.hiddenSubscriberCount);

      await db.query(`
        INSERT INTO channels(
          channel_id,
          title,
          subscriber_count,
          view_count,
          video_count,
          hidden_subscriber_count,
          last_seen
        )
        VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(channel_id) DO UPDATE SET
          title = EXCLUDED.title,
          subscriber_count = EXCLUDED.subscriber_count,
          view_count = EXCLUDED.view_count,
          video_count = EXCLUDED.video_count,
          hidden_subscriber_count = EXCLUDED.hidden_subscriber_count,
          last_seen = EXCLUDED.last_seen
      `, [
        channel.id,
        channel.snippet?.title || '',
        subscribers,
        views,
        videos,
        hidden,
        now
      ]);

      await db.query(`
        INSERT INTO channel_snapshots(
          channel_id,
          ts,
          subscriber_count,
          view_count,
          video_count
        )
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(channel_id, ts) DO NOTHING
      `, [
        channel.id,
        now,
        subscribers,
        views,
        videos
      ]);
    }
  }
}
async function refreshRegion(region) {
  if (!regions.includes(region)) return;

  const data = await yt('videos', {
    part: 'snippet,statistics,contentDetails',
    chart: 'mostPopular',
    regionCode: region,
    maxResults: '50'
  });

  if (!data) return;

  const now = Date.now();
  const snapshotTime =
    Math.floor(now / 600000) * 600000;
  const channelIds = (data.items || [])
    .map(x => x.snippet?.channelId)
    .filter(Boolean);
  for (const x of data.items || []) {
    const views = Number(
      x.statistics?.viewCount || 0
    );

    await db.query(`
      INSERT INTO videos(
        id,title,channel,region,thumbnail,
        publishedAt,duration,views,lastSeen
      )
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(id) DO UPDATE SET
        title=EXCLUDED.title,
        channel=EXCLUDED.channel,
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
      INSERT INTO video_regions(
        video_id,region,last_seen
      )
      VALUES($1,$2,$3)
      ON CONFLICT(video_id,region)
      DO UPDATE SET last_seen=EXCLUDED.last_seen
    `, [x.id, region, now]);

    await db.query(`
      INSERT INTO snapshots(videoId,ts,views)
      VALUES($1,$2,$3)
      ON CONFLICT(videoId,ts)
      DO UPDATE SET views=EXCLUDED.views
    `, [x.id, snapshotTime, views]);
  }
  await refreshChannels(channelIds);
}

async function refreshTrackedVideos() {
  const result = await db.query(`
    SELECT id
    FROM videos
    ORDER BY lastSeen DESC
    LIMIT 5000
  `);

  const ids = result.rows.map(x => x.id);

  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);

    if (!batch.length) continue;

    const data = await yt('videos', {
      part: 'snippet,statistics,contentDetails',
      id: batch.join(',')
    });

    const now = Date.now();
    const snapshotTime =
      Math.floor(now / 600000) * 600000;

    for (const x of data?.items || []) {
      const views = Number(
        x.statistics?.viewCount || 0
      );

      await db.query(`
        UPDATE videos
        SET
          title=$2,
          channel=$3,
          thumbnail=$4,
          publishedAt=$5,
          duration=$6,
          views=$7,
          lastSeen=$8
        WHERE id=$1
      `, [
        x.id,
        x.snippet.title,
        x.snippet.channelTitle,
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
    await refreshChannels((data?.items || []).map(x => x.snippet?.channelId));
  }
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const email =
      String(req.body?.email || '')
        .trim()
        .toLowerCase();

    const password =
      String(req.body?.password || '');

    const nickname =
      String(req.body?.nickname || '')
        .trim()
        .slice(0, 40);

    if (
      !email.includes('@') ||
      password.length < 8
    ) {
      return res.status(400).json({
        error:
          '이메일과 8자 이상의 비밀번호를 입력해주세요.'
      });
    }

    const passwordHash =
      await bcrypt.hash(password, 12);

    const result = await db.query(`
      INSERT INTO users(
        email,password_hash,nickname
      )
      VALUES($1,$2,$3)
      RETURNING id,email,nickname,plan
    `, [
      email,
      passwordHash,
      nickname || null
    ]);

    await createSession(
      res,
      result.rows[0].id
    );

    res.json({
      ok: true,
      user: result.rows[0]
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: '이미 가입된 이메일입니다.'
      });
    }

    console.error(error);
    res.status(500).json({
      error: '회원가입 중 오류가 발생했습니다.'
    });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email =
      String(req.body?.email || '')
        .trim()
        .toLowerCase();

    const password =
      String(req.body?.password || '');

    const result = await db.query(`
      SELECT *
      FROM users
      WHERE email=$1
      LIMIT 1
    `, [email]);

    const user = result.rows[0];

    if (
      !user ||
      !(await bcrypt.compare(
        password,
        user.password_hash
      ))
    ) {
      return res.status(401).json({
        error:
          '이메일 또는 비밀번호가 올바르지 않습니다.'
      });
    }

    await createSession(res, user.id);

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        nickname: user.nickname,
        plan: user.plan
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: '로그인 중 오류가 발생했습니다.'
    });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token =
      parseCookies(req).radar_session;

    if (token) {
      await db.query(
        'DELETE FROM sessions WHERE token_hash=$1',
        [hashToken(token)]
      );
    }

    res.clearCookie('radar_session', {
      path: '/'
    });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({
      error: '로그아웃 중 오류가 발생했습니다.'
    });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    res.json({
      user: await getUser(req)
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT COUNT(*) AS n FROM videos'
    );

    res.json({
      apiConfigured:
        !!process.env.YOUTUBE_API_KEY,
      databaseConfigured: true,
      tracked: Number(result.rows[0].n),
      countries: regions.length
    });
  } catch (error) {
    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/regions', (req, res) => {
  res.json(regions);
});

app.post('/api/refresh', async (req, res) => {
  try {
    const region = req.body?.region;

    if (
      region &&
      region !== 'ALL' &&
      !regions.includes(region)
    ) {
      return res.status(400).json({
        error: '지원하지 않는 국가입니다.'
      });
    }

    const wanted =
      region && region !== 'ALL'
        ? [region]
        : regions.slice(
            regionIndex,
            regionIndex + 8
          );

    for (const code of wanted) {
      await refreshRegion(code);
    }

    res.json({
      ok: true,
      regions: wanted
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message
    });
  }
});
app.get('/api/channel-rankings', async (req, res) => {
  try {
    const user = await getUser(req);

    const isPro =
      user &&
      user.plan !== 'FREE' &&
      user.subscription_status === 'active';

    const maxLimit = isPro ? 500 : 100;

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 100, 1),
      maxLimit
    );

    const period =
      ['d1', 'd6', 'd24', 'd7'].includes(req.query.period)
        ? req.query.period
        : 'd24';

    const periodMs = {
      d1: 60 * 60 * 1000,
      d6: 6 * 60 * 60 * 1000,
      d24: 24 * 60 * 60 * 1000,
      d7: 7 * 24 * 60 * 60 * 1000
    }[period];

    const result = await db.query(`
      SELECT
        c.channel_id,
        c.title,
        c.subscriber_count,
        c.view_count,
        c.video_count,
        c.hidden_subscriber_count,
        c.last_seen,

        COALESCE((
          SELECT cs.subscriber_count
          FROM channel_snapshots cs
          WHERE cs.channel_id = c.channel_id
            AND cs.ts <= $1
          ORDER BY cs.ts DESC
          LIMIT 1
        ), c.subscriber_count) AS old_subscriber_count,

        COALESCE((
          SELECT cs.view_count
          FROM channel_snapshots cs
          WHERE cs.channel_id = c.channel_id
            AND cs.ts <= $1
          ORDER BY cs.ts DESC
          LIMIT 1
        ), c.view_count) AS old_view_count

      FROM channels c
      ORDER BY c.last_seen DESC
      LIMIT 5000
    `, [Date.now() - periodMs]);

    const rows = result.rows.map(row => {
      const subscribers = Number(row.subscriber_count || 0);
      const oldSubscribers = Number(row.old_subscriber_count || 0);

      const views = Number(row.view_count || 0);
      const oldViews = Number(row.old_view_count || 0);

      const subscriberGain = Math.max(
        0,
        subscribers - oldSubscribers
      );

      const viewGain = Math.max(
        0,
        views - oldViews
      );

      const subscriberGrowthRate =
        oldSubscribers > 0
          ? (subscriberGain / oldSubscribers) * 100
          : 0;

      const viewsPerSubscriber =
        subscribers > 0
          ? viewGain / subscribers
          : 0;

      return {
        channelId: row.channel_id,
        title: row.title,
        subscribers,
        subscriberGain,
        subscriberGrowthRate,
        totalViews: views,
        viewGain,
        videoCount: Number(row.video_count || 0),
        viewsPerSubscriber,
        hiddenSubscriberCount: Boolean(
          row.hidden_subscriber_count
        ),
        lastSeen: Number(row.last_seen || 0)
      };
    });

    rows.sort((a, b) => {
      if (b.subscriberGain !== a.subscriberGain) {
        return b.subscriberGain - a.subscriberGain;
      }

      return b.subscriberGrowthRate - a.subscriberGrowthRate;
    });

    res.json({
      period,
      limit,
      items: rows.slice(0, limit)
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/rankings', async (req, res) => {
  try {
    const user = await getUser(req);
    
    const region =
      String(req.query.region || 'ALL');

    const metric =
      ['d10','d1','d6','d24','velocity']
        .includes(req.query.metric)
        ? req.query.metric
        : 'd1';

       const isPro =
      user &&
      user.plan !== 'FREE' &&
      user.subscription_status === 'active';

    const maxLimit = isPro ? 500 : 100;

    const limit = Math.min(
      Math.max(
        Number(req.query.limit) || 100,
        1
      ),
      maxLimit
    );

    const params = [];
    let regionJoin = '';

    if (region !== 'ALL') {
      params.push(region);

      regionJoin = `
        JOIN video_regions vr
          ON vr.video_id=v.id
         AND vr.region=$${params.length}
      `;
    }

    const result = await db.query(`
      SELECT
        v.id,
        v.title,
        v.channel,
        v.region,
        v.thumbnail,
        v.publishedAt AS "publishedAt",
        v.duration,
        v.views,
        v.lastSeen AS "lastSeen",

        GREATEST(
          0,
          v.views - COALESCE((
            SELECT s.views
            FROM snapshots s
            WHERE s.videoId=v.id
              AND s.ts <=
                (EXTRACT(EPOCH FROM NOW())*1000 - 600000)
            ORDER BY s.ts DESC
            LIMIT 1
          ),v.views)
        ) AS d10,

        GREATEST(
          0,
          v.views - COALESCE((
            SELECT s.views
            FROM snapshots s
            WHERE s.videoId=v.id
              AND s.ts <=
                (EXTRACT(EPOCH FROM NOW())*1000 - 3600000)
            ORDER BY s.ts DESC
            LIMIT 1
          ),v.views)
        ) AS d1,

        GREATEST(
          0,
          v.views - COALESCE((
            SELECT s.views
            FROM snapshots s
            WHERE s.videoId=v.id
              AND s.ts <=
                (EXTRACT(EPOCH FROM NOW())*1000 - 21600000)
            ORDER BY s.ts DESC
            LIMIT 1
          ),v.views)
        ) AS d6,

        GREATEST(
          0,
          v.views - COALESCE((
            SELECT s.views
            FROM snapshots s
            WHERE s.videoId=v.id
              AND s.ts <=
                (EXTRACT(EPOCH FROM NOW())*1000 - 86400000)
            ORDER BY s.ts DESC
            LIMIT 1
          ),v.views)
        ) AS d24

      FROM videos v
      ${regionJoin}
      ORDER BY v.views DESC
      LIMIT 5000
    `, params);

    let rows = result.rows.map(x => {
      const duration =
        String(x.duration || '');

      const match =
        duration.match(
          /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
        );

      const seconds = match
        ? Number(match[1] || 0) * 3600 +
          Number(match[2] || 0) * 60 +
          Number(match[3] || 0)
        : 0;

      const d10 = Number(x.d10);
      const d1 = Number(x.d1);
      const d6 = Number(x.d6);
      const d24 = Number(x.d24);

      return {
        ...x,
        views: Number(x.views),
        lastSeen: Number(x.lastSeen),
        d10,
        d1,
        d6,
        d24,
        velocity:
          d1 || d10 * 6,
        // YouTube API에는 정확한 Shorts 여부 필드가 없어 추정값
        isShort:
          seconds > 0 &&
          seconds <= 180
      };
    });

    const type =
      String(req.query.type || 'all');

    if (type === 'shorts') {
      rows = rows.filter(x => x.isShort);
    }

    if (type === 'long') {
      rows = rows.filter(x => !x.isShort);
    }

    rows.sort(
      (a, b) =>
        Number(b[metric] || 0) -
        Number(a[metric] || 0)
    );

    res.json(rows.slice(0, limit));
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: error.message
    });
  }
});

let regionIndex = 0;
let collectionRunning = false;

async function automaticCollection() {
  if (collectionRunning) return;

  collectionRunning = true;

  try {
    // 이미 발견된 영상은 10분마다 다시 조회해
    // 실제 조회수 상승 스냅샷을 쌓는다.
    await refreshTrackedVideos();

    // 새 급상승 후보는 국가를 나눠 순환 발견한다.
    const batch = [];

    for (let i = 0; i < 8; i++) {
      batch.push(
        regions[
          (regionIndex + i) %
          regions.length
        ]
      );
    }

    console.log(
      '신규 영상 탐색 국가:',
      batch.join(', ')
    );

    for (const region of batch) {
      await refreshRegion(region);
    }

    regionIndex =
      (regionIndex + 8) %
      regions.length;

    console.log(
      '자동 데이터 수집 완료'
    );
  } catch (error) {
    console.error(
      '자동 데이터 수집 오류:',
      error.message
    );
  } finally {
    collectionRunning = false;
  }
}

setInterval(
  automaticCollection,
  10 * 60 * 1000
);

async function start() {
  try {
    await initDB();

    app.listen(port, () => {
      console.log(
        `Global YouTube Radar running on port ${port}`
      );
    });
  } catch (error) {
    console.error(
      '서버 시작 실패:',
      error
    );

    process.exit(1);
  }
}

start();
