const $ = s => document.querySelector(s);

const fmt = n => {
  if (n == null) return '수집 중';

  return new Intl.NumberFormat('ko-KR', {
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number(n));
};

const els = ['region', 'type', 'metric', 'limit'];

let currentUser = null;
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
  } else {
    planBadge.textContent = 'FREE';
    planBadge.classList.remove('pro');

    userName.textContent = '';

    loginBtn.classList.remove('hidden');
    signupBtn.classList.remove('hidden');
    logoutBtn.classList.add('hidden');
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
    const qs = new URLSearchParams(
      Object.fromEntries(
        els.map(id => [
          id,
          $('#' + id).value
        ])
      )
    );

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
        </article>
      `;
    })
    .join('');
}

function scheduleLoad() {
  clearTimeout(loadTimer);

  loadTimer = setTimeout(
    load,
    250
  );
}

els.forEach(id => {
  $('#' + id).addEventListener(
    'change',
    load
  );
});

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
  await loadUser();
  await load();
}

start();
