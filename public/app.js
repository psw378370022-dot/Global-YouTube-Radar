const $ = s => document.querySelector(s);

const fmt = n => {
  if (n == null) return '수집 중';

  return new Intl.NumberFormat('ko-KR', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(n));
};

const els = ['region', 'type', 'category', 'metric', 'limit'];

let currentUser = null;
let rankingMode = 'video';
let authMode = 'login';
let loadTimer = null;

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(url, options = {}) {
  const response = await fetch(url, options);

  let data;

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error || '요청을 처리하지 못했습니다.'
    );
  }

  return data;
}

async function loadUser() {
  try {
    const data = await api('/api/auth/me');
    currentUser = data.user || null;
  } catch {
    currentUser = null;
  }

  updateAccount();
}

function updateAccount() {
  const planBadge = $('#planBadge');
  const userName = $('#userName');
  const loginBtn = $('#loginBtn');
  const signupBtn = $('#signupBtn');
  const logoutBtn = $('#logoutBtn');
 
  const specialAdminBtn = $('#specialAdminBtn');

  if (currentUser) {
    const plan = currentUser.plan || 'FREE';

    planBadge.textContent = plan;
    planBadge.classList.toggle(
      'pro',
      plan !== 'FREE'
    );

    userName.textContent =
      currentUser.nickname ||
      currentUser.email;

    loginBtn.classList.add('hidden');
    signupBtn.classList.add('hidden');
    logoutBtn.classList.remove('hidden');

    specialAdminBtn.classList.toggle(
  'hidden',
  plan !== 'OWNER'
);
} else {
    planBadge.textContent = 'FREE';
    planBadge.classList.remove('pro');

    userName.textContent = '';

    loginBtn.classList.remove('hidden');
    signupBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
    
    
    specialAdminBtn.classList.add('hidden');
  }
}

function openAuth(mode = 'login') {
  authMode = mode;

  $('#authModal').classList.remove('hidden');
  $('#authMessage').textContent = '';

  $('#email').value = '';
  $('#password').value = '';
  $('#nickname').value = '';

  updateAuthModal();

  setTimeout(() => {
    if (authMode === 'register') {
      $('#nickname').focus();
    } else {
      $('#email').focus();
    }
  }, 50);
}

function closeAuth() {
  $('#authModal').classList.add('hidden');
  $('#authMessage').textContent = '';
}

function updateAuthModal() {
  const register = authMode === 'register';

  $('#authTitle').textContent =
    register ? '무료 회원가입' : '로그인';

  $('#authSubmit').textContent =
    register ? '회원가입' : '로그인';

  $('#authSwitch').textContent =
    register
      ? '이미 계정이 있나요? 로그인'
      : '계정이 없나요? 무료 회원가입';

  $('#nickname').classList.toggle(
    'hidden',
    !register
  );

  $('#password').setAttribute(
    'autocomplete',
    register
      ? 'new-password'
      : 'current-password'
  );
}

async function submitAuth() {
  const email = $('#email').value.trim();
  const password = $('#password').value;
  const nickname = $('#nickname').value.trim();
  const message = $('#authMessage');
  const button = $('#authSubmit');

  if (!email || !password) {
    message.textContent =
      '이메일과 비밀번호를 입력해주세요.';
    return;
  }

  if (password.length < 8) {
    message.textContent =
      '비밀번호는 8자 이상 입력해주세요.';
    return;
  }

  button.disabled = true;
  button.textContent =
    authMode === 'register'
      ? '가입 중…'
      : '로그인 중…';

  try {
    const body = {
      email,
      password
    };

    if (authMode === 'register') {
      body.nickname = nickname;
    }

    const data = await api(
      authMode === 'register'
        ? '/api/auth/register'
        : '/api/auth/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    currentUser = data.user;
    updateAccount();
    closeAuth();
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent =
      authMode === 'register'
        ? '회원가입'
        : '로그인';
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', {
      method: 'POST'
    });
  } catch {
    // 서버 오류가 있더라도 화면에서는 로그아웃 처리
  }

  currentUser = null;
  updateAccount();
}

async function load() {
  const status = $('#status');

  try {
    if (rankingMode === 'channel') return loadChannels();
    
    const qs = new URLSearchParams(
  Object.fromEntries(
    els
      .map(id => {
        const element = $('#' + id);

        return element
          ? [id, element.value]
          : null;
      })
      .filter(Boolean)
  )
);
if (rankingMode === 'china') {
  qs.set('china', 'true');

  qs.set(
    'chinaCategory',
    $('#chinaCategory')?.value || 'all'
  );

  qs.set(
    'chinaPlatform',
    $('#chinaPlatform')?.value || 'all'
  );

  qs.set(
    'chinaSearch',
    $('#chinaSearch')?.value.trim() || ''
  );
}
    const [st, rows] = await Promise.all([
      api('/api/status'),
      api('/api/rankings?' + qs.toString())
    ]);

    $('#trackedCount').textContent =
      Number(st.tracked || 0).toLocaleString();

    $('#countryCount').textContent =
      st.countries || 50;

    status.textContent =
      st.apiConfigured
        ? `현재 ${Number(st.tracked || 0).toLocaleString()}개 영상을 추적 중입니다. 데이터가 쌓일수록 기간별 상승량이 더 정확해집니다.`
        : 'YouTube API 연결을 확인해주세요.';

    render(rows);
  } catch (error) {
    status.textContent =
      '데이터를 불러오지 못했습니다: ' +
      error.message;

    $('#list').innerHTML = `
      <div class="empty">
        잠시 후 다시 시도해주세요.
      </div>
    `;
  }
}
async function loadChannels() {
  const status = $('#status');

  try {
    const limit = $('#limit')?.value || '100';
    const metric = $('#metric').value || 'd24';

    const periodMap = {
      d10: 'd10',
      d1: 'd1',
      d6: 'd6',
      d24: 'd24',
      d7: 'd7'
    };

    const period =
      periodMap[metric] || 'd24';

    const sort =
  `${period}_subscribers`;

const category =
  $('#category')?.value || 'all';

const data = await api(
  `/api/channel-rankings?sort=${encodeURIComponent(sort)}&limit=${encodeURIComponent(limit)}&category=${encodeURIComponent(category)}`
);

    const periodLabels = {
      d10: '10분',
      d1: '1시간',
      d6: '6시간',
      d24: '24시간',
      d7: '7일'
    };

    status.textContent =
      `${periodLabels[period]} 기준 채널 성장 데이터를 분석 중입니다.`;

    renderChannels(
      data.items || [],
      period
    );

  } catch (error) {
    status.textContent =
      '채널 순위를 불러오지 못했습니다: ' +
      error.message;

    $('#list').innerHTML = `
      <div class="empty">
        채널 성장 데이터를 불러오지 못했습니다.
      </div>
    `;
  }
}
function render(rows) {
  const query =
    $('#search').value
      .trim()
      .toLowerCase();

  const filtered = rows.filter(x => {
    const text =
      `${x.title || ''} ${x.channel || ''}`
        .toLowerCase();

    return text.includes(query);
  });

  if (!filtered.length) {
    $('#list').innerHTML = `
      <div class="empty">
        조건에 맞는 영상이 없습니다.
      </div>
    `;
    return;
  }

  $('#list').innerHTML = filtered
    .map((x, index) => {
      const id =
        encodeURIComponent(x.id || '');

      const title =
        escapeHtml(x.title || '제목 없음');

      const channel =
        escapeHtml(x.channel || '');

      const region =
        escapeHtml(x.region || '');

      const thumbnail =
        escapeHtml(x.thumbnail || '');

      return `
        <article class="card">
          <div class="rank">
            ${index + 1}
          </div>

          <a
            class="thumb-link"
            href="https://www.youtube.com/watch?v=${id}"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              class="thumb"
              src="${thumbnail}"
              alt="${title}"
              loading="lazy"
            >
          </a>

          <div class="video-info">
            <a
              class="title"
              href="https://www.youtube.com/watch?v=${id}"
              target="_blank"
              rel="noopener noreferrer"
            >
              ${title}
            </a>

            <div class="sub">
  ${channel}
  · ${region}
  · ${
      {
        music: '🎵 음악',
        entertainment: '🎬 엔터',
        gaming: '🎮 게임',
        sports: '⚽ 스포츠',
        news: '📰 뉴스',
        economy: '💰 경제',
        tech: '🤖 테크/AI',
        education: '📚 교육',
        life: '🏠 라이프',
        beauty: '💄 뷰티/패션',
        food_travel: '🍜 음식/여행'
      }[x.category] || '🎬 엔터'
    }
  · ${x.isShort ? 'Shorts 추정' : 'Video'}
</div>
          </div>

          <div class="num">
            <span class="muted">현재 조회수</span>
            <strong>${fmt(x.views)}</strong>
          </div>

          <div class="num">
            <span class="muted">10분</span>
            <strong>+${fmt(x.d10)}</strong>
          </div>

          <div class="num">
            <span class="muted">1시간</span>
            <strong class="hot">
              +${fmt(x.d1)}
            </strong>
          </div>

          <div class="num">
            <span class="muted">6시간</span>
            <strong>+${fmt(x.d6)}</strong>
          </div>
    
        <div class="num">
  <span class="muted">24시간</span>
  <strong>+${fmt(x.d24)}</strong>
</div>

<div class="num">
  <span class="muted">7일</span>
  <strong>+${fmt(x.d7)}</strong>
</div>
        </article>
      `;
    })
    .join('');
}

  function renderChannels(rows, period = 'd24') {
  const query = $('#search').value
    .trim()
    .toLowerCase();

  const filtered = rows.filter(x =>
    String(x.title || '')
      .toLowerCase()
      .includes(query)
  );

  if (!filtered.length) {
    $('#list').innerHTML = `
      <div class="empty">
        조건에 맞는 채널이 없습니다.
      </div>
    `;
    return;
  }

  const gain = (x, key) =>
    Number(
      x[key]?.subscriberGain || 0
    );

  const available = (x, key) =>
    Boolean(x[key]?.available);

  const gainText = (x, key) =>
    available(x, key)
      ? `+${gain(x, key).toLocaleString()}`
      : '수집 중';

  $('#list').innerHTML = `
    <div class="channel-ranking-table">

      <div class="channel-ranking-row channel-ranking-header">
        <div>순위</div>
        <div>채널</div>
        <div>총 구독자</div>
        <div>10분 ↑</div>
        <div>1시간 ↑</div>
        <div>6시간 ↑</div>
        <div>24시간 ↑</div>
        <div>7일 ↑</div>
        <div>총 조회수</div>
        <div>영상 수</div>
        <div>추정 월수익</div>
        <div>분석</div>
      </div>

      ${filtered.map((x, index) => {
        const title =
          escapeHtml(x.title || '채널명 없음');

        const subscribers =
          Number(x.subscribers || 0);

        const totalViews =
          Number(x.totalViews || 0);

        const videoCount =
          Number(x.videoCount || 0);

        const revenueMin =
          Number(
            x.estimatedMonthlyRevenue?.min || 0
          );

        const revenueMax =
          Number(
            x.estimatedMonthlyRevenue?.max || 0
          );

        return `
          <div class="channel-ranking-row">

            <div class="channel-rank">
              ${index + 1}
            </div>

            <div class="channel-name-cell">
  <strong>${title}</strong>

  <span class="channel-category">
    ${
      ({
        music: '🎵 음악',
        entertainment: '🎬 엔터',
        gaming: '🎮 게임',
        sports: '⚽ 스포츠',
        news: '📰 뉴스',
        economy: '💰 경제',
        tech: '🤖 테크/AI',
        education: '📚 교육',
        life: '🏠 라이프',
        beauty: '💄 뷰티/패션',
        food_travel: '🍜 음식/여행'
      })[x.category] || '🎬 엔터'
    }
  </span>
</div>

            <div class="channel-number">
              ${subscribers.toLocaleString()}
            </div>

            <div class="channel-growth">
              ${gainText(x, 'd10')}
            </div>

            <div class="channel-growth">
              ${gainText(x, 'd1')}
            </div>

            <div class="channel-growth">
              ${gainText(x, 'd6')}
            </div>

            <div class="channel-growth">
              ${gainText(x, 'd24')}
            </div>

            <div class="channel-growth">
              ${gainText(x, 'd7')}
            </div>

            <div class="channel-number">
              ${totalViews.toLocaleString()}
            </div>

            <div class="channel-number">
              ${videoCount.toLocaleString()}
            </div>

            <div class="channel-revenue">
              $${revenueMin.toLocaleString()}
              ~
              $${revenueMax.toLocaleString()}
            </div>

            <div>
              <button
                type="button"
                class="channel-analysis-btn"
                data-channel-id="${escapeHtml(x.channelId || '')}"
              >
                🔎 상세
              </button>
            </div>

          </div>
        `;
      }).join('')}

    </div>
  `;

  document
    .querySelectorAll('.channel-analysis-btn')
    .forEach(button => {
      button.addEventListener('click', () => {
        openChannelAnalysis(
          button.dataset.channelId
        );
      });
    });
}

async function openChannelAnalysis(channelId) {
  const section = $('#channelAnalysis');

  try {
    section.classList.remove('hidden');

    $('#analysisTitle').textContent =
      '🔎 채널 데이터를 불러오는 중...';

    $('#analysisDescription').textContent =
      '성장 기록을 분석하고 있습니다.';

    const data = await api(
      `/api/channel-analysis/${encodeURIComponent(channelId)}`
    );

    $('#analysisTitle').textContent =
      `🔎 ${data.title || '채널 상세 분석'}`;

    $('#analysisDescription').textContent =
      '10분부터 7일까지 채널 성장 데이터를 비교합니다.';

    $('#analysisSubscribers').textContent =
      Number(data.subscribers || 0).toLocaleString();

    $('#analysisViews').textContent =
      Number(data.totalViews || 0).toLocaleString();

    $('#analysisVideos').textContent =
      Number(data.videoCount || 0).toLocaleString();

    $('#analysisMonthlyViews').textContent =
      Number(
        data.estimatedMonthlyViews || 0
      ).toLocaleString();

    const revenueMin =
      Number(
        data.estimatedMonthlyRevenue?.min || 0
      );

    const revenueMax =
      Number(
        data.estimatedMonthlyRevenue?.max || 0
      );

    $('#analysisRevenue').textContent =
      `$${revenueMin.toLocaleString()} ~ $${revenueMax.toLocaleString()}`;

    const labels = {
      d10: '10분',
      d1: '1시간',
      d6: '6시간',
      d24: '24시간',
      d7: '7일'
    };

    $('#analysisPeriods').innerHTML =
      Object.entries(labels)
        .map(([key, label]) => {
          const item =
            data.growth?.[key] || {};

          const subscriberGain =
            Number(item.subscriberGain || 0);

          const growthRate =
            Number(
              item.subscriberGrowthRate || 0
            );

          const viewGain =
            Number(item.viewGain || 0);

          const status =
            item.available
              ? ''
              : '<span class="analysis-pending">데이터 축적 중</span>';

          return `
            <div class="analysis-period">
              <div class="analysis-period-title">
                <strong>${label}</strong>
                ${status}
              </div>

              <div class="analysis-period-value">
                <span>구독자 증가</span>
                <strong>
                  +${subscriberGain.toLocaleString()}
                </strong>
              </div>

              <div class="analysis-period-value">
                <span>구독자 성장률</span>
                <strong>
                  +${growthRate.toFixed(2)}%
                </strong>
              </div>

              <div class="analysis-period-value">
                <span>조회수 증가</span>
                <strong>
                  +${viewGain.toLocaleString()}
                </strong>
              </div>
            </div>
          `;
        })
        .join('');

    section.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

  } catch (error) {
    section.classList.remove('hidden');

    $('#analysisTitle').textContent =
      '채널 분석을 불러오지 못했습니다.';

    $('#analysisDescription').textContent =
      error.message;

    $('#analysisPeriods').innerHTML = '';
  }
}

function closeChannelAnalysis() {
  $('#channelAnalysis').classList.add('hidden');
}
$('#closeAnalysis').addEventListener(
  'click',
  closeChannelAnalysis
);

function scheduleLoad() {
  clearTimeout(loadTimer);

  loadTimer = setTimeout(
    load,
    250
  );
}
$('#videoTab').addEventListener('click', () => {
  rankingMode = 'video';
  $('#chinaControls').classList.add('hidden');
  $('#category').classList.add('hidden');
  $('#category').value = 'all';

  $('#videoTab').classList.add('active');
  $('#categoryTab').classList.remove('active');
  $('#channelTab').classList.remove('active');
  $('#chinaTab').classList.remove('active');

  $('#rankingTitle').textContent =
  '🔥 영상 급상승 랭킹';

$('#rankingDescription').textContent =
  '선택한 기간 동안 조회수가 빠르게 증가한 영상 순위';

  load();
});

$('#channelTab').addEventListener('click', () => {
  rankingMode = 'channel';
  $('#chinaControls').classList.add('hidden');
  $('#category').value = 'all';
  $('#category').classList.add('hidden');

  $('#channelTab').classList.add('active');
  $('#categoryTab').classList.remove('active');
  $('#videoTab').classList.remove('active');
  $('#chinaTab').classList.remove('active');

  $('#rankingTitle').textContent =
  '🚀 채널 급성장 랭킹';

$('#rankingDescription').textContent =
  '10분·1시간·6시간·24시간·7일 채널 성장 데이터를 비교합니다.';

  load();
});

$('#categoryTab').addEventListener('click', () => {
  rankingMode = 'category';
  $('#chinaControls').classList.add('hidden');
  $('#category').classList.remove('hidden');

  $('#categoryTab').classList.add('active');
  $('#videoTab').classList.remove('active');
  $('#channelTab').classList.remove('active');
  $('#chinaTab').classList.remove('active');

  $('#rankingTitle').textContent =
  '📂 카테고리 분석 랭킹';

$('#rankingDescription').textContent =
  '카테고리를 선택해 급상승 YouTube 영상을 분석합니다.';

  load();
});
$('#chinaTab').addEventListener('click', () => {
  rankingMode = 'china';
  $('#chinaControls').classList.remove('hidden');

  $('#category').classList.add('hidden');
  $('#category').value = 'all';

  $('#chinaTab').classList.add('active');
  $('#videoTab').classList.remove('active');
  $('#channelTab').classList.remove('active');
  $('#categoryTab').classList.remove('active');

  $('#rankingTitle').textContent =
    '🇨🇳 중국 관련 콘텐츠 분석';

  $('#rankingDescription').textContent =
    'YouTube에서 수집된 중국 관련 영상의 급상승 데이터를 분석합니다.';

  load();
});
['chinaCategory', 'chinaPlatform'].forEach(id => {
  $('#' + id)?.addEventListener(
    'change',
    load
  );
});

$('#chinaSearch')?.addEventListener(
  'input',
  scheduleLoad
);

els.forEach(id => {
  const element = $('#' + id);

  if (element) {
    element.addEventListener(
      'change',
      load
    );
  }
});
const limitSelect = $('#limit');

if (limitSelect) {
  limitSelect.addEventListener('change', () => {
    const selected = Number(limitSelect.value);

    const isPro =
      currentUser &&
      currentUser.plan !== 'FREE' &&
      currentUser.subscription_status === 'active';

    if (selected > 100 && !isPro) {
      alert(
        'TOP 200~500은 PRO 기능입니다. FREE 회원은 TOP 100까지 이용할 수 있습니다.'
      );

      limitSelect.value = '100';
    }

    load();
  });
}
$('#search').addEventListener(
  'input',
  scheduleLoad
);

$('#refresh').addEventListener(
  'click',
  async () => {
    const button = $('#refresh');

    button.disabled = true;
    button.textContent = '수집 중…';

    try {
      await api('/api/refresh', {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          region:
            $('#region').value === 'ALL'
              ? null
              : $('#region').value
        })
      });

      await load();
    } catch (error) {
      $('#status').textContent =
        '새로고침 실패: ' +
        error.message;
    } finally {
      button.disabled = false;
      button.textContent =
        '데이터 새로고침';
    }
  }
);

$('#loginBtn').addEventListener(
  'click',
  () => openAuth('login')
);

$('#signupBtn').addEventListener(
  'click',
  () => openAuth('register')
);

$('#logoutBtn').addEventListener(
  'click',
  logout
);
$('#specialAdminBtn').addEventListener('click', () => {
  $('#specialModal').classList.remove('hidden');
  $('#specialMessage').textContent = '';
  $('#specialEmail').value = '';
});

$('#closeSpecialModal').addEventListener('click', () => {
  $('#specialModal').classList.add('hidden');
});

$('#specialModal').addEventListener('click', event => {
  if (event.target === $('#specialModal')) {
    $('#specialModal').classList.add('hidden');
  }
});
async function updateSpecialAccess(enabled) {
  const email =
    $('#specialEmail').value
      .trim()
      .toLowerCase();

  const message = $('#specialMessage');

  if (!email || !email.includes('@')) {
    message.textContent =
      '회원 이메일을 입력해주세요.';
    return;
  }

  try {
    const data = await api(
      '/api/admin/special-access',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          email,
          enabled
        })
      }
    );

    message.textContent =
      data.user?.special_access
        ? '✅ SPECIAL 권한을 켰습니다.'
        : '✅ SPECIAL 권한을 해제했습니다.';

  } catch (error) {
    message.textContent =
      error.message;
  }
}

$('#specialEnable').addEventListener(
  'click',
  () => updateSpecialAccess(true)
);

$('#specialDisable').addEventListener(
  'click',
  () => updateSpecialAccess(false)
);
$('#closeModal').addEventListener(
  'click',
  closeAuth
);

$('#authSwitch').addEventListener(
  'click',
  () => {
    authMode =
      authMode === 'login'
        ? 'register'
        : 'login';

    $('#authMessage').textContent = '';
    updateAuthModal();
  }
);

$('#authSubmit').addEventListener(
  'click',
  submitAuth
);

$('#password').addEventListener(
  'keydown',
  event => {
    if (event.key === 'Enter') {
      submitAuth();
    }
  }
);

$('#authModal').addEventListener(
  'click',
  event => {
    if (event.target === $('#authModal')) {
      closeAuth();
    }
  }
);

document.addEventListener(
  'keydown',
  event => {
    if (
      event.key === 'Escape' &&
      !$('#authModal').classList.contains('hidden')
    ) {
      closeAuth();
    }
  }
);

$('#proBtn').addEventListener(
  'click',
  () => {
    if (!currentUser) {
      openAuth('register');
      return;
    }

    alert(
      'PRO 결제 기능은 다음 단계에서 결제대행사와 연결할 예정입니다.'
    );
  }
);

async function start() {
  $('#category')?.classList.add('hidden');

  if ($('#category')) {
    $('#category').value = 'all';
  }

  await loadUser();
  await load();
}

start();
