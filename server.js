import express from 'express';
import dotenv from 'dotenv';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

dotenv.config();

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 3000;

const OWNER_EMAIL = String(
  process.env.OWNER_EMAIL || ''
).trim().toLowerCase();

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
const chinaDiscoveryQueries = String(
  process.env.CHINA_DISCOVERY_QUERIES || ''
)
  .split('\n')
  .map(x => x.trim())
  .filter(Boolean);

function getSimpleCategory(categoryId, title = '', channel = '') {
  const text =
    `${title} ${channel}`.toLowerCase();


  // 세부 카테고리는 제목/채널명으로 먼저 보정
  const economyKoreanSignals = [
  '주식',
  '재테크',
  '경제',
  '투자',
  '금융',
  '증시',
  '코인',
  '비트코인',
  '부동산',
  '금리',
  '환율',
  '채권',
  '배당',
  '나스닥',
  '코스피',
  '코스닥',
  '세금',
  '창업',
  '자산관리',
  '펀드',
  '연금'
];

const hasEconomyKorean =
  economyKoreanSignals.some(
    signal => text.includes(signal)
  );

const hasEconomyEnglish =
  /\b(etf|finance|stocks?|crypto|bitcoin|invest|investment|nasdaq|bonds?|dividend|tax|startup|pension)\b/i
    .test(text);

if (hasEconomyKorean || hasEconomyEnglish) {
  return 'economy';
}
  
  if (
  /뉴스|속보|시사|정치|사회|국제|세계|외교|사건|사고|날씨|재난|선거|국회|정부|대통령|기자|방송|보도|현장|인터뷰|news|breaking|politics|world|global|election|government|report/.test(text)
) {
  return 'news';
}
  
  if (
    /인공지능|ai |chatgpt|테크|코딩|개발|technology|software|coding|gadget/.test(text)
  ) {
    return 'tech';
  }

  if (
    /뷰티|메이크업|패션|화장|beauty|makeup|fashion|skincare|cosmetic/.test(text)
  ) {
    return 'beauty';
  }

  if (
    /먹방|요리|음식|여행|맛집|mukbang|food|cooking|recipe|travel|restaurant/.test(text)
  ) {
    return 'food_travel';
  }

  const categoryMap = {
    '1': 'entertainment',
    '2': 'life',
    '10': 'music',
    '15': 'life',
    '17': 'sports',
    '19': 'food_travel',
    '20': 'gaming',
    '22': 'life',
    '23': 'entertainment',
    '24': 'entertainment',
    '25': 'news',
    '26': 'life',
    '27': 'education',
    '28': 'tech',
    '29': 'life'
  };

  return categoryMap[String(categoryId)] || 'entertainment';
}
function isChinaRelated(title = '', channel = '') {
  const text =
    `${title} ${channel}`.toLowerCase();

  const chinaSignals = [
    '中国',
    '中國',
    '中国大陆',
    '中國大陸',
    '北京',
    '上海',
    '深圳',
    '广州',
    '廣州',
    '杭州',
    '成都',
    '重庆',
    '重慶',
    '武汉',
    '武漢',
    '南京',
    '西安',

    '抖音',
    'douyin',

    '哔哩哔哩',
    '嗶哩嗶哩',
    'bilibili',

    '小红书',
    '小紅書',
    'xiaohongshu',

    '微博',
    'weibo',

    'china',
    'chinese',
    'beijing',
    'shanghai',
    'shenzhen'
  ];

  return chinaSignals.some(
    signal => text.includes(signal)
  );
}
function getChinaCategory(title = '', channel = '') {
  const text =
    `${title} ${channel}`.toLowerCase();

  if (/新闻|热点|时事|热搜|央视|news|breaking/.test(text)) {
    return 'news';
  }

  if (/电视剧|网剧|短剧|剧集|drama|series/.test(text)) {
    return 'drama';
  }

  if (/电影|影片|movie|film/.test(text)) {
    return 'movie';
  }

  if (/综艺|真人秀|variety show|variety/.test(text)) {
    return 'variety';
  }

  if (/明星|娱乐圈|娱乐|艺人|演员|celebrity|star/.test(text)) {
    return 'celebrity';
  }

  if (/音乐|歌曲|神曲|歌手|mv|music|song/.test(text)) {
    return 'music';
  }

  if (/游戏|电竞|game|gaming|esports|valorant|原神|王者荣耀/.test(text)) {
    return 'gaming';
  }

  return 'other';
}

function getChinaPlatform(title = '', channel = '') {
  const text =
    `${title} ${channel}`.toLowerCase();

  if (/抖音|douyin/.test(text)) {
    return 'douyin';
  }

  if (/哔哩哔哩|嗶哩嗶哩|bilibili/.test(text)) {
    return 'bilibili';
  }

  if (/小红书|小紅書|xiaohongshu/.test(text)) {
    return 'xiaohongshu';
  }

  if (/微博|weibo/.test(text)) {
    return 'weibo';
  }

  return 'other';
}

async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS videos(
  id TEXT PRIMARY KEY,
  title TEXT,
  channel TEXT,
  channel_id TEXT,
  region TEXT,
  thumbnail TEXT,
  publishedAt TEXT,
  duration TEXT,
  category_id TEXT,
  china_discovered BOOLEAN NOT NULL DEFAULT FALSE,
  china_source TEXT,
  views BIGINT DEFAULT 0,
  lastSeen BIGINT
)
  `);
await db.query(`
  ALTER TABLE videos
  ADD COLUMN IF NOT EXISTS channel_id TEXT,
  ADD COLUMN IF NOT EXISTS category_id TEXT
  ADD COLUMN IF NOT EXISTS china_discovered BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS china_source TEXT
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
      special_access BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
  ALTER TABLE users
  ADD COLUMN IF NOT EXISTS special_access BOOLEAN NOT NULL DEFAULT FALSE
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
  CREATE TABLE IF NOT EXISTS china_discovery_state(
    id INTEGER PRIMARY KEY,
    next_index INTEGER NOT NULL DEFAULT 0,
    initial_completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_run BIGINT DEFAULT 0
  )
`);

await db.query(`
  INSERT INTO china_discovery_state(
    id,
    next_index,
    initial_completed,
    last_run
  )
  VALUES(1, 0, FALSE, 0)
  ON CONFLICT(id) DO NOTHING
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
  u.subscription_status,
  u.special_access

    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = $1
      AND s.expires_at > NOW()
    LIMIT 1
  `, [hashToken(token)]);

  const user = result.rows[0] || null;

  if (!user) return null;

  if (
    OWNER_EMAIL &&
    String(user.email).toLowerCase() === OWNER_EMAIL
  ) {
    user.plan = 'OWNER';
    user.subscription_status = 'active';
    user.special_access = true;
  }

  return user;
}

function canUseSpecialFeatures(user) {
  return (
    String(user?.plan || '').toUpperCase() === 'OWNER' ||
    user?.special_access === true
  );
}

function getPlanAccess(user) {
  const plan = String(user?.plan || 'FREE').toUpperCase();
  const active = user?.subscription_status === 'active';

  if (plan === 'OWNER') {
    return {
      plan: 'OWNER',
      maxLimit: 500,
      minPeriodMinutes: 10
    };
  }

  if (!active) {
    return {
      plan: 'FREE',
      maxLimit: 100,
      minPeriodMinutes: 1440
    };
  }

  if (plan === 'BUSINESS') {
    return {
      plan: 'BUSINESS',
      maxLimit: 500,
      minPeriodMinutes: 10
    };
  }

  if (plan === 'PRO_PLUS') {
    return {
      plan: 'PRO_PLUS',
      maxLimit: 500,
      minPeriodMinutes: 60
    };
  }

  if (plan === 'PRO') {
    return {
      plan: 'PRO',
      maxLimit: 500,
      minPeriodMinutes: 360
    };
  }

  return {
    plan: 'FREE',
    maxLimit: 100,
    minPeriodMinutes: 1440
  };
}

function canUsePeriod(access, period) {
  const minutes = {
    d10: 10,
    d1: 60,
    d6: 360,
    d24: 1440,
    d7: 10080
  }[period];

  return minutes >= access.minPeriodMinutes;
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
    id,title,channel,channel_id,region,thumbnail,
    publishedAt,duration,category_id,views,lastSeen
  )
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  ON CONFLICT(id) DO UPDATE SET
    title=EXCLUDED.title,
    channel=EXCLUDED.channel,
    channel_id=EXCLUDED.channel_id,
    thumbnail=EXCLUDED.thumbnail,
    publishedAt=EXCLUDED.publishedAt,
    duration=EXCLUDED.duration,
    category_id=EXCLUDED.category_id,
    views=EXCLUDED.views,
    lastSeen=EXCLUDED.lastSeen
`, [
  x.id,
  x.snippet.title,
  x.snippet.channelTitle,
  x.snippet.channelId || '',
  region,
  x.snippet.thumbnails?.medium?.url || '',
  x.snippet.publishedAt,
  x.contentDetails?.duration || '',
  x.snippet.categoryId || '',
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
async function discoverChinaVideos() {
  if (!chinaDiscoveryQueries.length) {
    console.log('중국 자동수집 검색어가 없습니다.');
    return;
  }

  const stateResult = await db.query(`
    SELECT
      next_index,
      initial_completed,
      last_run
    FROM china_discovery_state
    WHERE id = 1
    LIMIT 1
  `);

  const state = stateResult.rows[0];

  if (!state) return;

  let startIndex =
    Number(state.next_index || 0);

  // 처음 수집이 이미 끝났다면 여기서는 다시 전체 수집하지 않는다.
  let endIndex =
  chinaDiscoveryQueries.length;

if (state.initial_completed) {
  const intervalMinutes = Math.max(
    Number(
      process.env.CHINA_DISCOVERY_INTERVAL_MINUTES
    ) || 120,
    30
  );

  const lastRun =
    Number(state.last_run || 0);

  const intervalMs =
    intervalMinutes * 60 * 1000;

  if (
    Date.now() - lastRun <
    intervalMs
  ) {
    return;
  }

  startIndex =
    startIndex %
    chinaDiscoveryQueries.length;

  endIndex =
    startIndex + 1;
}

  const maxResults = Math.min(
    Math.max(
      Number(
        process.env.CHINA_DISCOVERY_MAX_RESULTS
      ) || 10,
      1
    ),
    50
  );

  for (
  let i = startIndex;
  i < endIndex;
  i++
) {
    const query =
      chinaDiscoveryQueries[i];

    try {
      console.log(
        `중국 자동수집 ${i + 1}/${chinaDiscoveryQueries.length}:`,
        query
      );

      const searchData = await yt(
        'search',
        {
          part: 'snippet',
          q: query,
          type: 'video',
          order: 'date',
          maxResults: String(maxResults)
        }
      );

      const ids = (searchData?.items || [])
        .map(item => item.id?.videoId)
        .filter(Boolean);

      if (ids.length) {
        const details = await yt(
          'videos',
          {
            part:
              'snippet,statistics,contentDetails',
            id: ids.join(',')
          }
        );

        const now = Date.now();

        const snapshotTime =
          Math.floor(now / 600000) *
          600000;

        const channelIds = [];

        for (const x of details?.items || []) {
          const views = Number(
            x.statistics?.viewCount || 0
          );

          const channelId =
            x.snippet?.channelId || '';

          if (channelId) {
            channelIds.push(channelId);
          }

          await db.query(`
            INSERT INTO videos(
              id,
              title,
              channel,
              channel_id,
              region,
              thumbnail,
              publishedAt,
              duration,
              category_id,
              china_discovered,
              china_source,
              views,
              lastSeen
            )
            VALUES(
              $1,$2,$3,$4,$5,$6,$7,
              $8,$9,$10,$11,$12,$13
            )
            ON CONFLICT(id) DO UPDATE SET
              title=EXCLUDED.title,
              channel=EXCLUDED.channel,
              channel_id=EXCLUDED.channel_id,
              thumbnail=EXCLUDED.thumbnail,
              publishedAt=EXCLUDED.publishedAt,
              duration=EXCLUDED.duration,
              category_id=EXCLUDED.category_id,
              china_discovered=TRUE,
              china_source=EXCLUDED.china_source,
              views=EXCLUDED.views,
              lastSeen=EXCLUDED.lastSeen
          `, [
            x.id,
            x.snippet?.title || '',
            x.snippet?.channelTitle || '',
            channelId,
            'CN',
            x.snippet?.thumbnails?.medium?.url || '',
            x.snippet?.publishedAt || '',
            x.contentDetails?.duration || '',
            x.snippet?.categoryId || '',
            true,
            query,
            views,
            now
          ]);

          await db.query(`
            INSERT INTO snapshots(
              videoId,
              ts,
              views
            )
            VALUES($1,$2,$3)
            ON CONFLICT(videoId,ts)
            DO UPDATE SET
              views=EXCLUDED.views
          `, [
            x.id,
            snapshotTime,
            views
          ]);
        }

        await refreshChannels(
          [...new Set(channelIds)]
        );
      }

      const nextIndex = i + 1;

      await db.query(`
        UPDATE china_discovery_state
        SET
          next_index = $1,
          last_run = $2
        WHERE id = 1
      `, [
        nextIndex,
        Date.now()
      ]);

    } catch (error) {
      console.error(
        '중국 자동수집 오류:',
        query,
        error.message
      );

      // 오류가 난 검색어에서 멈춰서
      // 다음 실행 때 다시 이어서 시도한다.
      break;
    }
  }

  const finalState = await db.query(`
    SELECT next_index
    FROM china_discovery_state
    WHERE id = 1
  `);

  if (
    Number(finalState.rows[0]?.next_index || 0) >=
    chinaDiscoveryQueries.length
  ) {
    await db.query(`
      UPDATE china_discovery_state
      SET
        next_index = 0,
        initial_completed = TRUE,
        last_run = $1
      WHERE id = 1
    `, [Date.now()]);

    console.log(
      '중국 검색어 초기 전체 수집 완료'
    );
  }
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
    channel_id=$4,
    thumbnail=$5,
    publishedAt=$6,
    duration=$7,
    category_id=$8,
    views=$9,
    lastSeen=$10
  WHERE id=$1
`, [
  x.id,
  x.snippet.title,
  x.snippet.channelTitle,
  x.snippet.channelId || '',
  x.snippet.thumbnails?.medium?.url || '',
  x.snippet.publishedAt,
  x.contentDetails?.duration || '',
  x.snippet.categoryId || '',
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
     RETURNING id,email,nickname,plan,subscription_status
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

    const responseUser = {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      plan: user.plan,
      subscription_status: user.subscription_status,
      special_access: Boolean(user.special_access)
    };

    if (
      OWNER_EMAIL &&
      String(user.email).toLowerCase() === OWNER_EMAIL
    ) {
      responseUser.plan = 'OWNER';
      responseUser.subscription_status = 'active';
      responseUser.special_access = true;
    }

    res.json({
      ok: true,
      user: responseUser
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
app.post('/api/admin/special-access', async (req, res) => {
  try {
    const user = await getUser(req);

    if (
      !user ||
      String(user.plan || '').toUpperCase() !== 'OWNER'
    ) {
      return res.status(403).json({
        error: 'OWNER만 특수회원 권한을 변경할 수 있습니다.'
      });
    }

    const email =
      String(req.body?.email || '')
        .trim()
        .toLowerCase();

    const enabled =
      req.body?.enabled === true;

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        error: '올바른 이메일을 입력해주세요.'
      });
    }

    const result = await db.query(`
      UPDATE users
      SET special_access = $1
      WHERE LOWER(email) = $2
      RETURNING
        id,
        email,
        nickname,
        plan,
        subscription_status,
        special_access
    `, [enabled, email]);

    if (!result.rows[0]) {
      return res.status(404).json({
        error: '해당 회원을 찾을 수 없습니다.'
      });
    }

    res.json({
      ok: true,
      user: result.rows[0]
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: '특수회원 권한 변경 중 오류가 발생했습니다.'
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
    const access = getPlanAccess(user);

    const limit = Math.min(
      Math.max(Number(req.query.limit) || 100, 1),
      Math.min(access.maxLimit, 500)
    );

    const sort =
      String(req.query.sort || 'd24_subscribers');

    const now = Date.now();

    // 랭킹 후보는 최대 500채널만 계산한다.
    const channelsResult = await db.query(`
      SELECT
        channel_id,
        title,
        subscriber_count,
        view_count,
        video_count,
        hidden_subscriber_count,
        last_seen
      FROM channels
      ORDER BY last_seen DESC
      LIMIT 500
    `);

    const channelIds =
      channelsResult.rows.map(row => row.channel_id);

    if (!channelIds.length) {
      return res.json({
        limit,
        sort,
        periods: ['d10', 'd1', 'd6', 'd24', 'd7'],
        items: []
      });
    }
    // TOP 500 채널의 대표 카테고리를 한 번에 계산
const categoryVideosResult = await db.query(`
  SELECT
    channel_id,
    category_id,
    title,
    channel
  FROM videos
  WHERE channel_id = ANY($1::text[])
    AND category_id IS NOT NULL
    AND category_id <> ''
  ORDER BY lastSeen DESC
  LIMIT 5000
`, [channelIds]);

const channelCategoryCounts = new Map();

for (const video of categoryVideosResult.rows) {
  const category = getSimpleCategory(
    video.category_id,
    video.title,
    video.channel
  );

  if (!channelCategoryCounts.has(video.channel_id)) {
    channelCategoryCounts.set(
      video.channel_id,
      new Map()
    );
  }

  const counts =
    channelCategoryCounts.get(video.channel_id);

  counts.set(
    category,
    (counts.get(category) || 0) + 1
  );
}

const channelCategoryMap = new Map();

for (const [channelId, counts] of channelCategoryCounts) {
  let bestCategory = 'entertainment';
  let bestCount = 0;

  for (const [category, count] of counts) {
    if (count > bestCount) {
      bestCategory = category;
      bestCount = count;
    }
  }

  channelCategoryMap.set(
    channelId,
    bestCategory
  );
}

    // 500채널의 필요한 과거 스냅샷을 한 번에 가져온다.
    const snapshotsResult = await db.query(`
      SELECT
        channel_id,
        ts,
        subscriber_count,
        view_count,
        video_count
      FROM channel_snapshots
      WHERE channel_id = ANY($1::text[])
        AND ts >= $2
      ORDER BY channel_id, ts DESC
    `, [
      channelIds,
      now - 8 * 24 * 60 * 60 * 1000
    ]);

    const snapshotsByChannel = new Map();

    for (const snapshot of snapshotsResult.rows) {
      if (!snapshotsByChannel.has(snapshot.channel_id)) {
        snapshotsByChannel.set(
          snapshot.channel_id,
          []
        );
      }

      snapshotsByChannel
        .get(snapshot.channel_id)
        .push(snapshot);
    }

    const periods = {
      d10: 10 * 60 * 1000,
      d1: 60 * 60 * 1000,
      d6: 6 * 60 * 60 * 1000,
      d24: 24 * 60 * 60 * 1000,
      d7: 7 * 24 * 60 * 60 * 1000
    };

    function getPeriodData(
      snapshots,
      cutoff,
      subscribers,
      totalViews
    ) {
      let old = null;

      // cutoff보다 과거이면서 가장 가까운 스냅샷
      for (const snapshot of snapshots) {
        if (Number(snapshot.ts) <= cutoff) {
          old = snapshot;
          break;
        }
      }

      const oldSubscribers =
        old
          ? Number(old.subscriber_count || 0)
          : subscribers;

      const oldViews =
        old
          ? Number(old.view_count || 0)
          : totalViews;

      const subscriberGain = Math.max(
        0,
        subscribers - oldSubscribers
      );

      const viewGain = Math.max(
        0,
        totalViews - oldViews
      );

      return {
        subscriberGain,

        subscriberGrowthRate:
          oldSubscribers > 0
            ? (subscriberGain / oldSubscribers) * 100
            : 0,

        viewGain,
        available: Boolean(old)
      };
    }

    let rows = channelsResult.rows.map(row => {
      const subscribers =
        Number(row.subscriber_count || 0);

      const totalViews =
        Number(row.view_count || 0);

      const videoCount =
        Number(row.video_count || 0);

      const snapshots =
        snapshotsByChannel.get(row.channel_id) || [];

      const d10 = getPeriodData(
        snapshots,
        now - periods.d10,
        subscribers,
        totalViews
      );

      const d1 = getPeriodData(
        snapshots,
        now - periods.d1,
        subscribers,
        totalViews
      );

      const d6 = getPeriodData(
        snapshots,
        now - periods.d6,
        subscribers,
        totalViews
      );

      const d24 = getPeriodData(
        snapshots,
        now - periods.d24,
        subscribers,
        totalViews
      );

      const d7 = getPeriodData(
        snapshots,
        now - periods.d7,
        subscribers,
        totalViews
      );

      const monthlyViewEstimate =
        d7.available && d7.viewGain > 0
          ? (d7.viewGain / 7) * 30
          : d24.viewGain * 30;

      return {
        channelId: row.channel_id,
        title: row.title,
        category: channelCategoryMap.get(row.channel_id) || 'entertainment',

        subscribers,
        totalViews,
        videoCount,

        hiddenSubscriberCount:
          Boolean(row.hidden_subscriber_count),

        lastSeen:
          Number(row.last_seen || 0),

        d10,
        d1,
        d6,
        d24,
        d7,

        estimatedMonthlyViews:
          Math.round(monthlyViewEstimate),

        estimatedMonthlyRevenue: {
          min: Math.round(
            (monthlyViewEstimate / 1000) * 0.5
          ),
          max: Math.round(
            (monthlyViewEstimate / 1000) * 5
          )
        }
      };
    });
    const category =
  String(req.query.category || 'all');

if (category !== 'all') {
  rows = rows.filter(
    x => x.category === category
  );
}

    const sortMap = {
      d10_subscribers: x => x.d10.subscriberGain,
      d1_subscribers: x => x.d1.subscriberGain,
      d6_subscribers: x => x.d6.subscriberGain,
      d24_subscribers: x => x.d24.subscriberGain,
      d7_subscribers: x => x.d7.subscriberGain,

      d10_views: x => x.d10.viewGain,
      d1_views: x => x.d1.viewGain,
      d6_views: x => x.d6.viewGain,
      d24_views: x => x.d24.viewGain,
      d7_views: x => x.d7.viewGain,

      subscribers: x => x.subscribers,
      totalViews: x => x.totalViews
    };

    const sortFunction =
      sortMap[sort] ||
      sortMap.d24_subscribers;

    rows.sort(
      (a, b) =>
        sortFunction(b) -
        sortFunction(a)
    );

    res.json({
      limit,
      sort,

      periods: [
        'd10',
        'd1',
        'd6',
        'd24',
        'd7'
      ],

      items: rows.slice(0, limit)
    });

  } catch (error) {
    console.error(
      '채널 랭킹 오류:',
      error
    );

    res.status(500).json({
      error: error.message
    });
  }
});
  
app.get('/api/channel-search', async (req, res) => {
  try {
    const query =
      String(req.query.q || '')
        .trim()
        .slice(0, 100);

    if (query.length < 2) {
      return res.json({
        query,
        items: []
      });
    }

    const result = await db.query(`
      SELECT
        channel_id,
        title,
        subscriber_count,
        view_count,
        video_count,
        hidden_subscriber_count,
        last_seen
      FROM channels
      WHERE title ILIKE $1
      ORDER BY subscriber_count DESC
      LIMIT 50
    `, [`%${query}%`]);

    res.json({
      query,
      items: result.rows.map(row => ({
        channelId: row.channel_id,
        title: row.title,
        subscribers:
          Number(row.subscriber_count || 0),
        totalViews:
          Number(row.view_count || 0),
        videoCount:
          Number(row.video_count || 0),
        hiddenSubscriberCount:
          Boolean(row.hidden_subscriber_count),
        lastSeen:
          Number(row.last_seen || 0)
      }))
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: error.message
    });
  }
});

app.get('/api/channel-analysis/:channelId', async (req, res) => {
  try {
    const channelId =
      String(req.params.channelId || '').trim();

    const result = await db.query(`
      SELECT
        channel_id,
        title,
        subscriber_count,
        view_count,
        video_count,
        hidden_subscriber_count,
        last_seen
      FROM channels
      WHERE channel_id = $1
      LIMIT 1
    `, [channelId]);

    const row = result.rows[0];

    if (!row) {
      return res.status(404).json({
        error: '채널을 찾을 수 없습니다.'
      });
    }

    const subscribers =
      Number(row.subscriber_count || 0);

    const totalViews =
      Number(row.view_count || 0);

    const videoCount =
      Number(row.video_count || 0);

    const periods = {
      d10: 10 * 60 * 1000,
      d1: 60 * 60 * 1000,
      d6: 6 * 60 * 60 * 1000,
      d24: 24 * 60 * 60 * 1000,
      d7: 7 * 24 * 60 * 60 * 1000
    };

    const growth = {};

    for (const [key, ms] of Object.entries(periods)) {
      const snapshot = await db.query(`
        SELECT
          subscriber_count,
          view_count,
          video_count,
          ts
        FROM channel_snapshots
        WHERE channel_id = $1
          AND ts <= $2
        ORDER BY ts DESC
        LIMIT 1
      `, [
        channelId,
        Date.now() - ms
      ]);

      const old = snapshot.rows[0] || null;

      const oldSubscribers =
        old
          ? Number(old.subscriber_count || 0)
          : subscribers;

      const oldViews =
        old
          ? Number(old.view_count || 0)
          : totalViews;

      const subscriberGain = Math.max(
        0,
        subscribers - oldSubscribers
      );

      const viewGain = Math.max(
        0,
        totalViews - oldViews
      );

      growth[key] = {
        subscriberGain,
        subscriberGrowthRate:
          oldSubscribers > 0
            ? (subscriberGain / oldSubscribers) * 100
            : 0,
        viewGain,
        available: Boolean(old),
        snapshotTime:
          old ? Number(old.ts || 0) : null
      };
    }

    const monthlyViews =
      growth.d7.viewGain > 0
        ? (growth.d7.viewGain / 7) * 30
        : growth.d24.viewGain * 30;

    res.json({
      channelId: row.channel_id,
      title: row.title,
      subscribers,
      totalViews,
      videoCount,

      hiddenSubscriberCount:
        Boolean(row.hidden_subscriber_count),

      lastSeen:
        Number(row.last_seen || 0),

      growth,

      estimatedMonthlyViews:
        Math.round(monthlyViews),

      estimatedMonthlyRevenue: {
        min: Math.round(
          (monthlyViews / 1000) * 0.5
        ),
        max: Math.round(
          (monthlyViews / 1000) * 5
        )
      }
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

   const requestedMetric =
  ['d10', 'd1', 'd6', 'd24', 'd7', 'velocity']
    .includes(req.query.metric)
    ? req.query.metric
    : 'd24';

const access = getPlanAccess(user);

const metricPeriod =
  requestedMetric === 'velocity'
    ? 'd1'
    : requestedMetric;

const metric = canUsePeriod(access, metricPeriod)
  ? requestedMetric
  : 'd24';

const limit = Math.min(
  Math.max(
    Number(req.query.limit) || 100,
    1
  ),
  access.maxLimit
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
  v.channel_id,
  v.region,
  v.thumbnail,
  v.publishedAt AS "publishedAt",
  v.duration,
  v.category_id,
  v.china_discovered,
  v.china_source,
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
        ) AS d24,
        

GREATEST(
  0,
  v.views - COALESCE((
    SELECT s.views
    FROM snapshots s
    WHERE s.videoId=v.id
      AND s.ts <=
        (EXTRACT(EPOCH FROM NOW())*1000 - 604800000)
    ORDER BY s.ts DESC
    LIMIT 1
  ),v.views)
) AS d7

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
      const d7 = Number(x.d7);

      return {
  ...x,
  views: Number(x.views),

  channelId: x.channel_id || '',
  category: getSimpleCategory(
    x.category_id,
    x.title,
    x.channel
  ),
  
  chinaRelated:
  Boolean(x.china_discovered) ||
  isChinaRelated(
    x.title,
    x.channel
  ),

chinaSource:
  x.china_source || '',

chinaCategory: getChinaCategory(
  x.title,
  `${x.channel} ${x.china_source || ''}`
),

chinaPlatform: getChinaPlatform(
  x.title,
  `${x.channel} ${x.china_source || ''}`
),
        
        lastSeen: Number(x.lastSeen),
        d10,
        d1,
        d6,
        d24,
        d7,
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
    const category =
  String(req.query.category || 'all');

if (category !== 'all') {
  rows = rows.filter(
    x => x.category === category
  );
}
const chinaOnly =
  String(req.query.china || 'false') === 'true';

if (chinaOnly) {
  rows = rows.filter(
    x => x.chinaRelated === true
  );

  const chinaCategory =
    String(req.query.chinaCategory || 'all');

  if (chinaCategory !== 'all') {
    rows = rows.filter(
      x => x.chinaCategory === chinaCategory
    );
  }

  const chinaPlatform =
    String(req.query.chinaPlatform || 'all');

  if (chinaPlatform !== 'all') {
    rows = rows.filter(
      x => x.chinaPlatform === chinaPlatform
    );
  }

  const chinaSearch =
    String(req.query.chinaSearch || '')
      .trim()
      .toLowerCase();

  if (chinaSearch) {
    rows = rows.filter(x =>
      `${x.title || ''} ${x.channel || ''}`
        .toLowerCase()
        .includes(chinaSearch)
    );
  }
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
    await discoverChinaVideos();

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
