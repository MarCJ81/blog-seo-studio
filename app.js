/* ============================================================
   블로그 SEO 스튜디오 · app.js
   화면 렌더 · localStorage · 모달 · 클립보드 · 내보내기 · BYOK.
   ============================================================ */
'use strict';

(function () {
  const C = window.SeoCore;
  const D = window.SeoData;
  const CP = window.CopyPsych || null;   // engines/copy-psych-engine.js
  const B = window.AiBridge || null;     // engines/ai-bridge.js
  const P = window.ProConnector || null; // engines/pro-api-connector.js
  const PS = window.ProStudio ? window.ProStudio.create(P) : null; // engines/pro-studio.js
  const FA = window.FreeAI || null;      // engines/free-ai-client.js (무료 AI 맛보기)
  if (FA) FA.configure({ endpoint: 'https://free-ai-taste.goodday810202.workers.dev', app: 'blog-seo-studio' });

  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };
  const esc = function (v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  const fmt = C.formatNumber;
  const fmtC = C.formatCompact;

  const KEY = {
    keywords: 'blogseo.v1.keywords',
    drafts: 'blogseo.v1.drafts',
    settings: 'blogseo.v1.settings',
    theme: 'blogseo.v1.theme',
    diag: 'blogseo.v1.diag',
    builder: 'blogseo.v1.builder',
    seeded: 'blogseo.v1.seeded',
  };

  const state = {
    tab: 'keywords',
    theme: 'light',
    keywords: [],
    drafts: [],
    settings: { endpoint: '', apiKey: '', header: 'Authorization', prefix: 'Bearer ', geminiKey: '', geminiModel: 'gemini-3.5-flash-lite' },
    kwFilter: { category: '전체', grade: '전체', query: '' },
    kwSort: 'score',
    draftFilter: { status: '전체', query: '' },
    draftSort: 'date',
    diag: { keyword: '', title: '', body: '' },
    builder: {
      topic: '', keyword: '', audience: '', tone: 'casual', goalChars: '2000',
      include: { table: true, checklist: true, faq: true, price: true, caution: true },
      intro: { framework: 'PAS', problem: '', outcome: '', proof: '' },
    },
    lastScore: null,
    proxyRows: [],
    geminiBusy: false,
    freeBusy: false,
    pro: { busy: false, last: null, body: '', title: '', meta: '' },
  };

  /* ── storage ─────────────────────────────────────────── */

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('브라우저 저장 공간이 부족해 저장하지 못했어요.', { type: 'warn' }); return false; }
  }

  function normalizeKeywords(list) {
    if (!Array.isArray(list)) return null;
    const clean = list.filter(function (r) { return r && String(r.keyword || '').trim(); })
      .map(function (r) {
        return {
          id: r.id || C.uid('kw'),
          keyword: String(r.keyword).trim().slice(0, 80),
          volume: Math.max(0, C.parseCount(r.volume)),
          docs: Math.max(0, C.parseCount(r.docs)),
          category: r.category,
          custom: !!r.custom,
        };
      });
    return clean.length ? clean : null;
  }

  function demoKeywords() {
    return D.DEMO_KEYWORDS.map(function (r) { return Object.assign({}, r); });
  }

  /* ── toast / modal ───────────────────────────────────── */

  function toast(message, opts) {
    const o = opts || {};
    const root = $('#toastRoot');
    const el = document.createElement('div');
    el.className = 'toast' + (o.type ? ' ' + o.type : '');
    el.innerHTML = '<span>' + esc(message) + '</span>';
    if (o.action) {
      const btn = document.createElement('button');
      btn.className = 'undo';
      btn.type = 'button';
      btn.textContent = o.action.label;
      btn.addEventListener('click', function () {
        o.action.run();
        el.remove();
      });
      el.appendChild(btn);
    }
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, o.duration || 3600);
  }

  let lastFocus = null;

  function openModal(config) {
    const root = $('#modalRoot');
    lastFocus = document.activeElement;
    root.hidden = false;
    root.innerHTML =
      '<div class="modal-backdrop" data-action="close-modal"></div>' +
      '<div class="modal ' + (config.size || '') + '" role="dialog" aria-modal="true" aria-label="' + esc(config.title) + '">' +
        '<div class="modal-head"><h2>' + esc(config.title) + '</h2>' +
        '<button class="modal-close" type="button" data-action="close-modal" aria-label="닫기">✕</button></div>' +
        '<div class="modal-body">' + config.body + '</div>' +
      '</div>';
    const first = root.querySelector('input:not([type=hidden]), textarea, select');
    if (first && config.autofocus !== false) {
      setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
    }
    if (config.onMount) config.onMount(root);
  }

  function closeModal() {
    const root = $('#modalRoot');
    root.hidden = true;
    root.innerHTML = '';
    if (lastFocus && lastFocus.isConnected) { try { lastFocus.focus(); } catch (e) {} }
  }

  /* ── theme / tabs ────────────────────────────────────── */

  function applyTheme(theme) {
    state.theme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', state.theme);
    const btn = $('[data-action="toggle-theme"]');
    if (btn) btn.setAttribute('aria-label', state.theme === 'light' ? '다크 모드로 전환' : '라이트 모드로 전환');
    save(KEY.theme, state.theme);
  }

  function switchTab(tab) {
    state.tab = tab;
    document.body.dataset.tab = tab;
    $$('.tab').forEach(function (b) {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + tab; });

    const search = $('#searchInput');
    if (tab === 'keywords') { search.value = state.kwFilter.query; search.placeholder = '키워드 검색'; }
    if (tab === 'tracker') { search.value = state.draftFilter.query; search.placeholder = '제목·키워드·메모 검색'; }
    updateSearchClear();

    if (tab === 'diagnose') runDiagnosis();
    if (tab === 'builder') renderBuilder();
    if (tab === 'tracker') renderDrafts();
    window.scrollTo(0, 0);
  }

  function updateSearchClear() {
    const input = $('#searchInput');
    const clear = $('[data-action="clear-search"]');
    if (clear) clear.hidden = !input.value;
  }

  /* ── keyword tab ─────────────────────────────────────── */

  function analyzedKeywords() {
    return state.keywords.map(function (r) { return C.analyzeKeyword(r); });
  }

  function filteredKeywords() {
    const q = state.kwFilter.query.trim().toLowerCase();
    const rows = analyzedKeywords().filter(function (r) {
      if (state.kwFilter.category !== '전체' && r.category !== state.kwFilter.category) return false;
      if (state.kwFilter.grade !== '전체' && r.grade !== state.kwFilter.grade) return false;
      if (q && r.keyword.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    return C.sortKeywords(rows, state.kwSort);
  }

  function renderKeywords() {
    const all = analyzedKeywords();
    const stats = C.keywordStats(all);
    $('#kwSummary').innerHTML =
      '<div class="stat"><b>' + fmt(stats.total) + '</b><span>키워드</span></div>' +
      '<div class="stat hot"><b>' + fmt(stats.byGrade.S) + '</b><span>S등급</span></div>' +
      '<div class="stat"><b>' + stats.avgScore + '</b><span>평균 추천도</span></div>' +
      '<div class="stat"><b>' + all.filter(function (r) { return r.custom; }).length + '</b><span>내가 추가</span></div>';

    renderKwChips(all);
    const rows = filteredKeywords();
    const body = $('#kwRows');
    body.innerHTML = rows.map(kwRowHTML).join('');
    $('#kwEmpty').hidden = rows.length > 0;
    $('#kwCount').textContent = rows.length + '개' + (rows.length !== all.length ? ' / 전체 ' + all.length + '개' : '');
    const note = $('#kwVisibleNote');
    if (note) {
      note.textContent = rows.length !== all.length
        ? '필터 적용 · ' + rows.length + '개 표시'
        : '전체 ' + all.length + '개 · 평균 추천도 ' + stats.avgScore;
    }

    const top = C.sortKeywords(all, 'score').slice(0, 3);
    $('#kwTop3').innerHTML = top.length ? top.map(function (r, i) {
      return '<button type="button" class="top3-item" data-action="diagnose-keyword" data-keyword="' + esc(r.keyword) + '">' +
        '<span class="rank">' + (i + 1) + '</span>' +
        '<span class="t-main"><span class="t-name">' + esc(r.keyword) + '</span>' +
        '<span class="t-sub">경쟁률 ' + ratioText(r) + ' · ' + fmtC(r.volume) + '회</span></span>' +
        '<span class="badge grade ' + r.grade.toLowerCase() + '">' + r.grade + '</span>' +
        '<span class="t-score">' + r.score + '</span></button>';
    }).join('') : '<p class="muted" style="font-size:12px">키워드를 추가하면 추천도 순으로 보여 드려요.</p>';

    updateProxyButton();
  }

  function ratioText(r) {
    if (!isFinite(r.ratio)) return '—';
    return r.ratio.toFixed(2);
  }

  function renderKwChips(all) {
    const cats = ['전체'].concat(C.CATEGORIES.filter(function (c) {
      return all.some(function (r) { return r.category === c; });
    }));
    const catHTML = cats.map(function (c) {
      const n = c === '전체' ? all.length : all.filter(function (r) { return r.category === c; }).length;
      return '<button type="button" class="chip' + (state.kwFilter.category === c ? ' is-on' : '') + '" data-kwfilter="category" data-value="' + esc(c) + '">' + esc(c) + ' <span class="muted">' + n + '</span></button>';
    }).join('');
    const grades = ['전체', 'S', 'A', 'B', 'C'].map(function (g) {
      const on = state.kwFilter.grade === g;
      const n = g === '전체' ? all.length : all.filter(function (r) { return r.grade === g; }).length;
      return '<button type="button" class="chip' + (on ? ' is-on' : '') + '" data-kwfilter="grade" data-value="' + g + '">' +
        (g === '전체' ? '등급 전체' : g) + ' <span class="muted">' + n + '</span></button>';
    }).join('');
    $('#kwChips').innerHTML = '<span class="chip-label">분야</span>' + catHTML + '<span class="chip-sep"></span><span class="chip-label">등급</span>' + grades;
  }

  function kwRowHTML(r) {
    const low = r.score < 50 ? ' low' : '';
    return '<div class="kw-row" role="row" data-id="' + esc(r.id) + '">' +
      '<div class="kw-name"><span class="kw-text" title="' + esc(r.keyword) + '">' + esc(r.keyword) + '</span>' +
        '<span class="kw-cat">' + esc(r.category) + '</span></div>' +
      '<div class="kw-num" data-label="월 검색수">' + fmt(r.volume) + '<span class="unit">회</span></div>' +
      '<div class="kw-num" data-label="문서수">' + fmt(r.docs) + '<span class="unit">개</span></div>' +
      '<div class="kw-ratio" data-label="경쟁률">' + ratioText(r) +
        '<span class="sat' + (r.saturation > 80 ? ' hot' : '') + '">포화 ' + (r.saturation >= 999 ? '—' : r.saturation + '%') + '</span></div>' +
      '<div class="kw-grade"><span class="badge grade ' + r.grade.toLowerCase() + '" title="' + esc(r.gradeLabel) + '">' + r.grade + '</span></div>' +
      '<div class="kw-score" title="추천도 ' + r.score + ' · ' + esc(r.recommendLabel) + '">' +
        '<span class="mini-bar"><i class="' + low.trim() + '" style="width:' + r.score + '%"></i></span><b>' + r.score + '</b></div>' +
      '<div class="kw-actions">' +
        '<button type="button" class="btn btn-ghost" data-action="diagnose-keyword" data-keyword="' + esc(r.keyword) + '">진단</button>' +
        '<button type="button" class="icon-mini" data-action="delete-keyword" data-id="' + esc(r.id) + '" aria-label="' + esc(r.keyword) + ' 삭제" title="삭제">✕</button>' +
      '</div></div>';
  }

  function addKeywords(rows) {
    let added = 0, updated = 0;
    rows.forEach(function (row) {
      const kw = String(row.keyword || '').trim();
      if (!kw) return;
      const idx = state.keywords.findIndex(function (r) { return r.keyword.trim().toLowerCase() === kw.toLowerCase(); });
      const clean = {
        id: row.id || C.uid('kw'),
        keyword: kw.slice(0, 80),
        volume: Math.max(0, C.parseCount(row.volume)),
        docs: Math.max(0, C.parseCount(row.docs)),
        category: row.category && C.CATEGORIES.indexOf(row.category) >= 0 ? row.category : '기타',
        custom: true,
      };
      if (idx >= 0) {
        clean.id = state.keywords[idx].id;
        clean.custom = state.keywords[idx].custom;
        state.keywords[idx] = clean;
        updated++;
      } else {
        state.keywords.push(clean);
        added++;
      }
    });
    save(KEY.keywords, state.keywords);
    renderKeywords();
    return { added: added, updated: updated };
  }

  function removeKeyword(id) {
    const idx = state.keywords.findIndex(function (r) { return r.id === id; });
    if (idx < 0) return;
    const removed = state.keywords[idx];
    state.keywords.splice(idx, 1);
    save(KEY.keywords, state.keywords);
    renderKeywords();
    toast('"' + removed.keyword + '"을(를) 목록에서 뺐어요.', {
      action: {
        label: '되돌리기',
        run: function () {
          state.keywords.splice(idx, 0, removed);
          save(KEY.keywords, state.keywords);
          renderKeywords();
        },
      },
    });
  }

  /* ── keyword modals ──────────────────────────────────── */

  function openAddKeyword() {
    const catOptions = C.CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    openModal({
      title: '키워드 추가',
      body:
        '<form id="addKwForm" autocomplete="off">' +
          '<div class="field"><label for="newKeyword">키워드</label>' +
            '<input id="newKeyword" type="text" placeholder="예: 겨울 보일러 온도 설정" maxlength="80" /></div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="newVolume">월 검색수</label><input id="newVolume" type="text" inputmode="numeric" placeholder="18000" /></div>' +
            '<div class="field"><label for="newDocs">블로그 문서수</label><input id="newDocs" type="text" inputmode="numeric" placeholder="640" /></div>' +
          '</div>' +
          '<div class="field"><label for="newCategory">분야</label><select id="newCategory">' + catOptions + '</select></div>' +
          '<p class="form-note">네이버 검색광고에서 확인한 월 검색수와, 검색 결과의 블로그 문서수를 넣으면 경쟁률과 등급이 바로 계산됩니다.</p>' +
          '<div class="form-error" id="addKwError"></div>' +
          '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="close-modal">취소</button>' +
            '<button type="submit" class="btn btn-primary">추가</button></div>' +
        '</form>',
      onMount: function () {
        $('#addKwForm').addEventListener('submit', function (e) {
          e.preventDefault();
          const keyword = $('#newKeyword').value.trim();
          const volume = C.parseCount($('#newVolume').value);
          const docs = C.parseCount($('#newDocs').value);
          const category = $('#newCategory').value;
          const err = $('#addKwError');
          if (!keyword) { err.textContent = '키워드를 입력하세요.'; return; }
          if (state.keywords.some(function (r) { return r.keyword.trim().toLowerCase() === keyword.toLowerCase(); })) {
            err.textContent = '이미 목록에 있는 키워드예요. 값을 바꾸려면 표 붙여넣기로 갱신하세요.';
            return;
          }
          if (!volume && !docs) { err.textContent = '월 검색수나 문서수 중 하나는 넣어 주세요.'; return; }
          addKeywords([{ keyword: keyword, volume: volume, docs: docs, category: category }]);
          closeModal();
          toast('"' + keyword + '" 추가 완료 · ' + C.gradeOf(volume, docs) + '등급');
        });
      },
    });
  }

  function openPaste() {
    openModal({
      title: '표 붙여넣기 (CSV · TSV)',
      size: 'wide',
      body:
        '<form id="pasteForm">' +
          '<p class="form-note">네이버 검색광고·검색 결과 표를 그대로 복사해 붙여넣으세요. 첫 줄에 <code>키워드</code>, <code>검색수</code>, <code>문서수</code>가 있으면 열을 알아서 찾고, PC·모바일 검색량은 합산합니다. 머리글 없는 3열도 됩니다.</p>' +
          '<div class="field" style="margin-top:10px"><label for="pasteInput">붙여넣기</label>' +
            '<textarea id="pasteInput" class="input" rows="9" style="height:auto;font-family:var(--mono);font-size:11.5px" placeholder="키워드&#9;PC 검색량&#9;모바일 검색량&#9;블로그 문서수&#10;겨울 보일러 온도 설정&#9;3,200&#9;14,800&#9;640"></textarea></div>' +
          '<div class="form-error" id="pasteError"></div>' +
          '<div id="pastePreview" class="proxy-status"></div>' +
          '<div class="modal-foot">' +
            '<button type="button" class="link-btn" data-action="fill-paste-sample" style="margin-right:auto">예시 채우기</button>' +
            '<button type="button" class="btn btn-ghost" data-action="close-modal">취소</button>' +
            '<button type="submit" class="btn btn-primary">가져오기</button>' +
          '</div>' +
        '</form>',
      onMount: function () {
        $('#pasteForm').addEventListener('submit', function (e) {
          e.preventDefault();
          const text = $('#pasteInput').value;
          const res = C.parseKeywordTable(text);
          const err = $('#pasteError');
          if (res.error) { err.textContent = res.error; return; }
          const merged = addKeywords(res.rows);
          closeModal();
          toast('표에서 ' + res.rows.length + '개 인식 · 새로 ' + merged.added + '개, 갱신 ' + merged.updated + '개');
        });
      },
    });
  }

  /* ── BYOK / proxy ────────────────────────────────────── */

  function proxyConfigured() {
    return !!(state.settings.endpoint && state.settings.apiKey !== null && state.settings.endpoint.trim());
  }

  function updateProxyButton() {
    const on = proxyConfigured();
    const dot = $('#apiDot');
    if (dot) dot.classList.toggle('on', on);
    const btn = $('#proxySearchBtn');
    if (btn) btn.hidden = !on;
  }

  function openSettings() {
    const s = state.settings;
    openModal({
      title: '프록시 API 연결 (선택)',
      body:
        '<p class="form-note">실시간 검색량을 쓰려면 <b>내 프록시</b>를 연결하세요. 주소에 <code>{keyword}</code>를 넣으면 조회할 때 키워드가 들어갑니다. 응답은 <code>{"keyword":"…","monthlySearch":18000,"documents":640}</code> 또는 그러한 객체의 배열이면 됩니다.</p>' +
        '<div class="field" style="margin-top:12px"><label for="setEndpoint">엔드포인트</label>' +
          '<input id="setEndpoint" type="url" placeholder="https://my-proxy.example.com/keywords?q={keyword}" value="' + esc(s.endpoint) + '" /></div>' +
        '<div class="field"><label for="setApiKey">API 키 (선택)</label>' +
          '<input id="setApiKey" type="password" placeholder="비워 두면 헤더 없이 요청" value="' + esc(s.apiKey) + '" autocomplete="off" /></div>' +
        '<div class="field-row">' +
          '<div class="field"><label for="setHeader">헤더 이름</label><input id="setHeader" type="text" value="' + esc(s.header || 'Authorization') + '" /></div>' +
          '<div class="field"><label for="setPrefix">접두어</label><input id="setPrefix" type="text" value="' + esc(s.prefix || '') + '" /></div>' +
        '</div>' +
        '<p class="form-note">키는 이 브라우저(localStorage)에만 저장되고, 위 주소로만 전송됩니다. 프록시 서버가 CORS를 허용해야 브라우저에서 호출할 수 있어요.</p>' +
        '<div class="proxy-status" id="proxyStatus"></div>' +
        '<div class="proxy-list" id="proxyPreview"></div>' +
        '<div class="modal-foot">' +
          '<button type="button" class="btn btn-ghost danger" data-action="delete-proxy-key" style="margin-right:auto">키 삭제</button>' +
          '<button type="button" class="btn btn-ghost" data-action="test-proxy">연결 테스트</button>' +
          '<button type="button" class="btn btn-primary" data-action="save-settings">저장</button>' +
        '</div>',
    });
  }

  async function queryProxy(cfg, keyword) {
    if (!cfg.endpoint) throw new Error('엔드포인트를 먼저 입력하세요.');
    const kw = keyword || '겨울 가습기 관리법';
    let url = cfg.endpoint.trim();
    url = url.indexOf('{keyword}') >= 0
      ? url.replace(/\{keyword\}/g, encodeURIComponent(kw))
      : url + (url.indexOf('?') >= 0 ? '&' : '?') + 'q=' + encodeURIComponent(kw);
    if (!/^https?:\/\//i.test(url)) throw new Error('http(s) 주소만 사용할 수 있어요.');
    const headers = { 'Accept': 'application/json' };
    if (cfg.apiKey) headers[(cfg.header || 'Authorization').trim() || 'Authorization'] = (cfg.prefix || '') + cfg.apiKey;

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 9000);
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: headers, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      throw new Error('연결하지 못했어요. 주소·CORS 허용·네트워크를 확인하세요.');
    }
    clearTimeout(timer);
    if (!res.ok) throw new Error('서버가 HTTP ' + res.status + '로 응답했어요.');
    let json;
    try { json = await res.json(); } catch (e) { throw new Error('JSON 응답이 아니에요.'); }
    const rows = extractProxyRows(json);
    if (!rows.length) throw new Error('응답에서 키워드·검색수·문서수를 찾지 못했어요.');
    return rows;
  }

  function extractProxyRows(json) {
    let arr = null;
    if (Array.isArray(json)) arr = json;
    else if (json && Array.isArray(json.items)) arr = json.items;
    else if (json && Array.isArray(json.keywords)) arr = json.keywords;
    else if (json && Array.isArray(json.data)) arr = json.data;
    else if (json && json.data && Array.isArray(json.data.items)) arr = json.data.items;
    else if (json && json.keyword) arr = [json];
    if (!arr) return [];
    return arr.map(function (x) {
      if (!x || typeof x !== 'object') return null;
      const keyword = String(x.keyword || x.key || x.term || x.query || '').trim();
      if (!keyword) return null;
      let volume = C.parseCount(firstDefined(x, ['monthlySearch', 'volume', 'searchVolume', 'totalSearch', 'searchVolumeTotal', 'total']));
      if (!volume && (x.pc || x.mobile)) volume = C.parseCount(x.pc) + C.parseCount(x.mobile);
      const docs = C.parseCount(firstDefined(x, ['documents', 'docs', 'documentCount', 'blogCount', 'blogDocuments', 'blog']));
      return { keyword: keyword, volume: volume, docs: docs, category: '기타' };
    }).filter(function (r) { return r && (r.volume || r.docs); });
  }

  function firstDefined(obj, keys) {
    for (let i = 0; i < keys.length; i++) {
      if (obj[keys[i]] != null) return obj[keys[i]];
    }
    return '';
  }

  function readSettingsForm() {
    return {
      endpoint: ($('#setEndpoint') ? $('#setEndpoint').value : state.settings.endpoint).trim(),
      apiKey: $('#setApiKey') ? $('#setApiKey').value : state.settings.apiKey,
      header: ($('#setHeader') ? $('#setHeader').value : state.settings.header) || 'Authorization',
      prefix: $('#setPrefix') ? $('#setPrefix').value : state.settings.prefix,
    };
  }

  function openProxySearch() {
    openModal({
      title: '프록시로 키워드 조회',
      body:
        '<form id="proxySearchForm">' +
          '<div class="field"><label for="proxyKeyword">키워드</label>' +
            '<input id="proxyKeyword" type="text" placeholder="예: 겨울 보일러 온도 설정" /></div>' +
          '<p class="form-note">설정한 프록시에 조회해 검색수·문서수를 가져옵니다. 결과는 확인 후 목록에 추가됩니다.</p>' +
          '<div class="proxy-status" id="proxyStatus"></div>' +
          '<div class="proxy-list" id="proxyPreview"></div>' +
          '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="close-modal">닫기</button>' +
            '<button type="submit" class="btn btn-primary">조회</button></div>' +
        '</form>',
      onMount: function () {
        $('#proxySearchForm').addEventListener('submit', function (e) {
          e.preventDefault();
          const kw = $('#proxyKeyword').value.trim();
          const status = $('#proxyStatus');
          const preview = $('#proxyPreview');
          if (!kw) { status.className = 'proxy-status err'; status.textContent = '키워드를 입력하세요.'; return; }
          status.className = 'proxy-status';
          status.textContent = '조회 중…';
          queryProxy(state.settings, kw).then(function (rows) {
            state.proxyRows = rows;
            status.className = 'proxy-status ok';
            status.textContent = rows.length + '건을 받았어요.';
            preview.innerHTML = rows.map(function (r) {
              return '<div class="proxy-row"><b>' + esc(r.keyword) + '</b><span>검색 ' + fmt(r.volume) + ' · 문서 ' + fmt(r.docs) + '</span></div>';
            }).join('') + '<button type="button" class="btn btn-primary btn-sm" data-action="add-proxy-rows" style="margin-top:6px">목록에 추가</button>';
          }).catch(function (err) {
            status.className = 'proxy-status err';
            status.textContent = err.message;
          });
        });
      },
    });
  }

  /* ── diagnosis ───────────────────────────────────────── */

  let diagSaveTimer = null;

  function runDiagnosis() {
    const kw = $('#diagKeyword'), title = $('#diagTitle'), body = $('#diagBody');
    if (!kw) return;
    const result = C.scorePost({ keyword: state.diag.keyword, title: state.diag.title, body: state.diag.body });
    state.lastScore = result;

    /* counters */
    const m = result.metrics;
    const counters = $('#diagCounters');
    const lenOK = m.charsNoSpace >= 2000;
    counters.innerHTML =
      '<span><b>' + fmt(m.chars) + '</b>자 공백 포함</span>' +
      '<span class="' + (lenOK ? 'ok' : 'warn') + '"><b>' + fmt(m.charsNoSpace) + '</b>자 공백 제외</span>' +
      '<span>문단 <b>' + m.paragraphs + '</b></span>' +
      '<span class="' + (m.keywordCount >= 4 && m.keywordCount <= 8 ? 'ok' : 'warn') + '" title="어절 경계 기준 · 조사가 붙은 형태 포함">키워드 <b>' + m.keywordCount + '</b>회' +
        (m.embeddedCount ? ' <span class="muted">· 복합어 ' + m.embeddedCount + '</span>' : '') + '</span>' +
      '<span class="' + (m.headings >= 3 ? 'ok' : '') + '">소제목 <b>' + m.headings + '</b></span>' +
      '<span class="' + (m.table ? 'ok' : '') + '">표 <b>' + (m.table ? '있음' : '없음') + '</b></span>';

    $('#titleHint').textContent = result.title.length + '자 · 권장 ' + C.TITLE_MIN + '~' + C.TITLE_MAX + '자';
    $('#titleHint').style.color = result.title.recommended ? 'var(--ok)' : 'var(--ink-4)';
    $('#bodyHint').textContent = '공백 제외 ' + fmt(m.charsNoSpace) + '자';

    const idle = !state.diag.keyword && !state.diag.title && !state.diag.body;

    /* score */
    const ring = $('#scoreRing');
    ring.style.setProperty('--p', idle ? 0 : result.total);
    ring.style.setProperty('--ring', ringColor(result.grade));
    $('#scoreTotal').textContent = idle ? 0 : result.total;
    const gradeEl = $('#scoreGrade');
    gradeEl.className = 'badge grade lg ' + (idle ? 'c' : result.grade.toLowerCase());
    gradeEl.textContent = idle ? '—' : result.grade;
    $('#scoreLabel').textContent = idle ? '키워드와 본문을 입력하세요' : result.gradeLabel;
    $('#scoreSub').textContent = idle ? '입력하면 6개 항목을 실시간으로 채점해요'
      : m.charsNoSpace + '자 · 키워드 ' + m.keywordCount + '회 · AI체 ' + m.aiCount + '곳';

    $('#scoreParts').innerHTML = result.parts.map(function (p) {
      const pct = Math.round((p.score / p.max) * 100);
      const cls = pct >= 70 ? '' : pct >= 40 ? 'low' : 'bad';
      return '<div class="part" title="' + esc(p.hint) + '"><span class="p-label">' + esc(p.label) + '</span>' +
        '<span class="p-track"><i class="' + cls + '" style="width:' + pct + '%"></i></span>' +
        '<span class="p-val">' + p.score + '<span>/' + p.max + '</span></span></div>';
    }).join('');

    /* issues & fixes */
    const issueList = $('#issueList');
    if (idle) {
      issueList.innerHTML = '<div class="issue"><strong>아직 진단할 내용이 없어요.</strong>' +
        '<div class="i-detail">타겟 키워드와 제목, 본문을 넣거나 위의 예시 버튼으로 시작해 보세요.</div></div>';
      $('#issueCount').textContent = '0';
      $('#fixList').innerHTML = '<li>타겟 키워드를 정하고 제목에 넣기</li><li>본문 2,000자와 소제목 5개 구성</li><li>키워드 4~8회, AI체 어미 점검</li>';
    } else {
      issueList.innerHTML = result.issues.map(function (i) {
        return '<div class="issue ' + i.level + '"><strong>' + esc(i.title) + '</strong>' +
          (i.detail ? '<div class="i-detail">' + esc(i.detail) + '</div>' : '') +
          (i.fix ? '<div class="i-fix">' + esc(i.fix) + '</div>' : '') + '</div>';
      }).join('');
      $('#issueCount').textContent = result.issues.filter(function (i) { return i.level !== 'good'; }).length + '건';
      $('#fixList').innerHTML = result.suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    }

    /* highlight + hit lists */
    renderHits(result);
    renderPsych();
    renderWordFix();

    $('#diagDot').hidden = !(state.diag.title || state.diag.body);
    $('#diagSaveNote').textContent = state.diag.body ? '작성 중인 원고는 이 브라우저에 자동 저장됩니다.' : '작성 중인 원고는 이 브라우저에 자동 저장됩니다.';
  }

  function ringColor(grade) {
    if (grade === 'S') return 'var(--card-ink-ring)';
    if (grade === 'A') return '#FFFFFF';
    if (grade === 'B') return '#F5C77C';
    return '#FF9A8A';
  }

  function renderHits(result) {
    const body = state.diag.body || '';
    const spans = body ? C.detectSpans(body) : [];
    const box = $('#highlightBox');
    if (!body) {
      box.innerHTML = '<p class="muted">본문을 입력하면 위험 표현과 AI 번역체를 표시해 드려요.</p>';
    } else {
      let html = '', last = 0;
      spans.forEach(function (s) {
        html += esc(body.slice(last, s.index));
        const cls = s.type === 'ai' ? 'ai' : s.type === 'banned' ? 'banned' : 'link';
        html += '<mark class="' + cls + '" title="' + esc(s.label + ' · ' + s.suggestion) + '">' +
          esc(body.slice(s.index, s.index + s.length)) + '</mark>';
        last = s.index + s.length;
      });
      html += esc(body.slice(last));
      box.innerHTML = html.replace(/\n/g, '<br>');
    }

    const banned = result.body.bannedHits;
    const ai = result.body.aiHits;
    const links = C.findLinks(body);
    const riskHits = banned.concat(links);
    $('#bannedCount').textContent = riskHits.length;
    $('#aiCount').textContent = ai.length;

    $('#bannedList').innerHTML = riskHits.length
      ? groupHits(riskHits).slice(0, 12).map(function (h) {
          return '<div class="hit ' + (h.type === 'banned' ? 'banned' : '') + '">' +
            '<div class="h-top"><span class="h-word">' + esc(h.text) + '</span><span class="h-tag">' + esc(h.label) + '</span>' +
            (h.count > 1 ? '<span class="h-tag">' + h.count + '회</span>' : '') + '</div>' +
            '<span class="h-fix">' + esc(h.suggestion) + '</span></div>';
        }).join('')
      : '<div class="hit empty-hit"><span class="h-fix">위험 표현이 없어요.</span></div>';

    $('#aiList').innerHTML = ai.length
      ? groupHits(ai).slice(0, 12).map(function (h) {
          return '<div class="hit ai">' +
            '<div class="h-top"><span class="h-word">' + esc(h.text) + '</span><span class="h-tag">' + esc(h.label) + '</span>' +
            (h.count > 1 ? '<span class="h-tag">' + h.count + '회</span>' : '') + '</div>' +
            '<span class="h-fix">' + esc(h.suggestion) + '</span></div>';
        }).join('')
      : '<div class="hit empty-hit"><span class="h-fix">AI 번역체가 없어요. 사람이 쓴 느낌이에요.</span></div>';
  }

  function groupHits(hits) {
    const map = {};
    hits.forEach(function (h) {
      const key = h.type + '|' + h.text;
      if (!map[key]) map[key] = { text: h.text, label: h.label, suggestion: h.suggestion, type: h.type, count: 0 };
      map[key].count++;
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  /* ── 카피·심리학 8대 트리거 · 추상어 교정 ─────────────── */

  function psychAnalysis() {
    if (!CP || typeof CP.diagnose !== 'function') return null;
    const text = (state.diag.title ? state.diag.title + '\n' : '') + (state.diag.body || '');
    const diag = CP.diagnose(text);
    return { diag: diag, profile: C.psychProfile(diag) };
  }

  function groupOfTrigger(id) {
    for (let i = 0; i < C.PSYCH_GROUPS.length; i++) {
      if (C.PSYCH_GROUPS[i].triggers.indexOf(id) >= 0) return C.PSYCH_GROUPS[i];
    }
    return null;
  }

  function renderPsych() {
    const list = $('#psychTriggers');
    if (!list) return;
    const idle = !state.diag.title && !state.diag.body;

    if (!CP) {
      $('#psychTotal').textContent = '—';
      $('#psychLabel').textContent = '심리학 엔진을 불러오지 못했어요';
      $('#psychGroupChips').innerHTML = '';
      list.innerHTML = '<p class="muted" style="font-size:12px">engines/copy-psych-engine.js 파일이 같은 폴더에 있는지 확인하세요.</p>';
      $('#psychGaps').innerHTML = '';
      return;
    }

    const res = psychAnalysis();
    if (!res) return;
    const p = res.profile;

    $('#psychTotal').textContent = idle ? 0 : p.total;
    const gradeEl = $('#psychGrade');
    gradeEl.className = 'badge grade ' + (idle ? 'c' : p.grade.tone);
    gradeEl.textContent = idle ? '—' : p.grade.id;
    $('#psychLabel').textContent = idle ? '제목과 본문을 입력하세요' : p.grade.title;

    $('#psychGroupChips').innerHTML = p.groups.map(function (g) {
      return '<div class="psy-chip ' + (g.met ? 'met' : '') + '" title="' + esc(g.desc) + ' · 목표 ' + g.target + '">' +
        '<b>' + esc(g.label) + '</b><span>' + (idle ? 0 : g.score) + '</span><em>/ ' + g.target + '</em></div>';
    }).join('');

    list.innerHTML = res.diag.triggers.map(function (t) {
      const g = groupOfTrigger(t.id);
      const pct = idle ? 0 : t.score;
      const cls = pct >= 70 ? '' : pct >= 40 ? 'low' : 'bad';
      const hit = (t.hits || [])[0];
      return '<div class="trig-row" title="' + esc(t.fix || '') + '">' +
        '<span class="t-main"><span class="t-name">' + esc(t.name) + '</span>' +
          (hit && !idle ? '<span class="t-hit">“' + esc(hit.phrase || hit.label) + '”</span>' : '<span class="t-hit muted">—</span>') + '</span>' +
        '<span class="t-group ' + (g ? g.id : '') + '">' + (g ? esc(g.label) : '—') + '</span>' +
        '<span class="t-bar"><i class="' + cls + '" style="width:' + pct + '%"></i></span>' +
        '<b class="t-score">' + pct + '</b></div>';
    }).join('');

    const gaps = p.gaps.filter(function (g) {
      const t = res.diag.triggers.filter(function (x) { return x.id === g.id; })[0];
      return t && t.score < 70;
    });
    $('#psychGaps').innerHTML = idle || !gaps.length
      ? ''
      : '<h3 class="mini-title">먼저 채울 빈틈 <em>' + gaps.length + '</em></h3>' +
        gaps.map(function (g, i) {
          return '<div class="gap"><b>' + (i + 1) + '. ' + esc(g.name) + ' <span>' + g.score + '점</span></b>' +
            '<p>' + esc(g.fix) + '</p>' +
            (g.id === 'authority' && hasHandsOn() ? '<p class="gap-hint">본문에 직접 겪은 기간이 있는데 "써보니·직접" 같은 표현이 없어 엔진이 못 잡았어요. "3년 써보니"로 쓰면 점수가 올라갑니다.</p>' : '') +
            '</div>';
        }).join('');
  }

  /** 블로그 1인칭 경험 신호(엔진의 권위 신호가 놓치는 구간 보완) */
  function hasHandsOn() {
    const t = state.diag.body || '';
    return /(?:저는|제가|나는|내가)[^.!?\n]{0,40}\d+\s*(?:년|개월|주|번|대|곳|명)/.test(t) || /(?:써\s?보니|직접\s?(?:해|써|써보|사용)|겪어\s?보니)/.test(t);
  }

  function renderWordFix() {
    const box = $('#wordFixBody');
    if (!box) return;
    const label = $('#wordFixScore');
    if (!CP) {
      label.textContent = '—';
      box.innerHTML = '<p class="muted" style="font-size:12px">교정 엔진을 불러오지 못했어요.</p>';
      return;
    }
    const body = state.diag.body || '';
    if (!body.trim()) {
      label.textContent = '감점 0';
      box.innerHTML = '<p class="muted" style="font-size:12px">본문을 입력하면 추상어·공급자어를 찾아 대안과 함께 보여 드려요.</p>';
      return;
    }

    const det = CP.detect(body);
    const wf = C.wordFixGroups(det);
    label.textContent = '감점 ' + wf.friction + (wf.primaryTotal ? ' · 추상·공급자 ' + wf.primaryTotal + '건' : '');

    if (!wf.total) {
      const examples = ((CP && CP.RULES) || []).filter(function (r) {
        return (r.type === 'abstract' || r.type === 'supplier') && r.example;
      }).slice(0, 3);
      box.innerHTML = '<div class="wf-clean"><b>추상어·공급자어가 없어요.</b><p>숫자와 독자 언어로 쓰셨네요. 이 상태를 유지하세요.</p></div>' +
        (examples.length
          ? '<div class="wf-group"><h3 class="wf-head">자주 걸리는 표현 <span>이렇게 바꾸면 통과</span></h3><div class="wf-items">' +
            examples.map(function (ex) { return '<div class="wf-item"><div class="wf-ex">' + esc(ex.example) + '</div></div>'; }).join('') +
            '</div></div>'
          : '');
      return;
    }

    const groupHTML = function (g) {
      const shown = g.items.slice(0, 6);
      const more = g.items.length - shown.length;
      return '<div class="wf-group">' +
        '<h3 class="wf-head">' + esc(g.label) + ' <em>' + g.count + '</em><span>' + esc(g.desc) + '</span></h3>' +
        '<div class="wf-items">' + shown.map(function (it) {
          return '<div class="wf-item">' +
            '<div class="wf-top"><b>' + esc(it.phrase) + '</b>' +
              (it.count > 1 ? '<span class="wf-count">×' + it.count + '</span>' : '') +
              (it.canAutoFix ? '<span class="wf-auto">자동 치환</span>' : '') + '</div>' +
            (it.alternative ? '<div class="wf-fix">대안: ' + esc(it.alternative) + '</div>' : '') +
            (it.example ? '<div class="wf-ex">' + esc(it.example) + '</div>' : '') +
          '</div>';
        }).join('') +
        (more > 0 ? '<div class="wf-more">' + more + '건 더 있어요. 본문에서 같은 표현을 찾아 바꿔 주세요.</div>' : '') +
        '</div></div>';
    };

    let html = wf.primary.map(groupHTML).join('');
    if (!wf.primary.length) {
      html += '<div class="wf-clean"><b>추상어·공급자어는 없어요.</b><p>형용사 대신 숫자와 독자 언어로 쓰셨네요. 이 상태를 유지하세요.</p></div>';
    }
    if (wf.secondary.length) {
      const secTotal = wf.secondary.reduce(function (a, g) { return a + g.count; }, 0);
      html += '<details class="wf-etc"><summary>함께 잡은 표현 ' + secTotal + '건 (번역체·모호한 약속·위험 표현)</summary>' +
        wf.secondary.map(groupHTML).join('') + '</details>';
    }
    box.innerHTML = html;
  }

  function setDiagBody(text) {
    state.diag.body = text;
    $('#diagBody').value = text;
    save(KEY.diag, state.diag);
    runDiagnosis();
  }

  function applyWordFix() {
    if (!CP) { toast('교정 엔진을 불러오지 못했어요.', { type: 'warn' }); return; }
    const before = state.diag.body || '';
    if (!before.trim()) { toast('본문을 먼저 입력하세요.', { type: 'warn' }); return; }
    const res = CP.correct(before);
    if (!res.applied.length) {
      toast('자동으로 바꿀 수 있는 표현이 없어요. 위 대안을 참고해 직접 고쳐 주세요.', { type: 'warn' });
      return;
    }
    setDiagBody(res.text);
    toast(res.applied.length + '곳을 안전하게 바꿨어요 · 감점 ' + res.before + ' → ' + res.after.friction, {
      action: { label: '되돌리기', run: function () { setDiagBody(before); } },
    });
  }

  function loadSample(which) {
    const s = D.SAMPLES.find(function (x) { return x.id === (which === 'ai' ? 'sample-ai' : 'sample-good'); });
    if (!s) return;
    state.diag = { keyword: s.keyword, title: s.title, body: s.body };
    $('#diagKeyword').value = s.keyword;
    $('#diagTitle').value = s.title;
    $('#diagBody').value = s.body;
    save(KEY.diag, state.diag);
    runDiagnosis();
    toast(s.label + '를 불러왔어요.');
  }

  function clearDiagnosis() {
    state.diag = { keyword: '', title: '', body: '' };
    $('#diagKeyword').value = '';
    $('#diagTitle').value = '';
    $('#diagBody').value = '';
    save(KEY.diag, state.diag);
    runDiagnosis();
    toast('입력한 원고를 비웠어요.');
  }

  /* ── builder ─────────────────────────────────────────── */

  let builderTimer = null;

  function builderOptions() {
    return {
      topic: state.builder.topic,
      keyword: state.builder.keyword,
      audience: state.builder.audience,
      tone: state.builder.tone,
      goalChars: Number(state.builder.goalChars) || 2000,
      include: state.builder.include,
    };
  }

  function renderBuilder() {
    renderToneSeg();
    renderIncludeChecks();
    renderFwSeg();
    renderBridge();
    const topic = state.builder.topic.trim();
    const keyword = state.builder.keyword.trim();
    if (!topic && !keyword) {
      $('#titleCandidates').innerHTML = '<p class="muted" style="font-size:12px">주제나 키워드를 넣으면 제목 후보가 나옵니다.</p>';
      $('#outlineList').innerHTML = '<p class="muted" style="font-size:12px">왼쪽에서 주제를 입력하세요.</p>';
      $('#builderChecklist').innerHTML = '';
      $('#builderTable').innerHTML = '';
      $('#builderQuestions').innerHTML = '';
      $('#builderTags').innerHTML = '';
      $('#promptBox').textContent = '주제를 입력하면 프롬프트가 생성됩니다.';
      $('#promptLength').textContent = '';
      $('#outlineGoal').textContent = '';
      renderIntro();
      return;
    }

    const o = C.buildOutline(builderOptions());

    $('#titleCandidates').innerHTML = o.titles.map(function (t) {
      const cls = t.length > C.TITLE_MAX ? 'over' : t.ok ? 'ok' : '';
      return '<button type="button" class="title-item" data-action="use-title" data-title="' + esc(t.text) + '">' +
        '<span class="t-formula">' + esc(t.formula) + '</span>' +
        '<span class="t-text">' + esc(t.text) + '</span>' +
        '<span class="t-len ' + cls + '">' + t.length + '자</span></button>';
    }).join('');

    $('#outlineGoal').textContent = fmt(o.goalChars) + '자 · ' + o.toneLabel;
    $('#outlineList').innerHTML = o.h2.map(function (h) {
      return '<div class="outline-item"><div class="outline-head"><span class="h-num">' + h.index + '</span>' +
        '<h3>' + esc(h.title) + '</h3><span class="h-chars">약 ' + fmt(h.targetChars) + '자</span></div>' +
        '<ul class="outline-points">' + h.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul></div>';
    }).join('');

    $('#builderChecklist').innerHTML = o.checklist.map(function (c) { return '<li>' + esc(c) + '</li>'; }).join('');
    $('#builderTable').innerHTML =
      '<thead><tr>' + o.table.columns.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead>' +
      '<tbody>' + o.table.rows.map(function (r) {
        return '<tr>' + r.map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody>';
    $('#builderQuestions').innerHTML = o.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('');
    $('#builderTags').innerHTML = o.tags.map(function (t) {
      return '<button type="button" class="tag" data-action="copy-tag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
    }).join('');

    const prompt = C.buildPrompt(builderOptions());
    $('#promptBox').textContent = prompt;
    $('#promptLength').textContent = prompt.length.toLocaleString('ko-KR') + '자';
    renderIntro(o);
  }

  /* ── 도입부 4종 (PAS · BAB · AIDA · 4U) ──────────────── */

  function renderFwSeg() {
    const seg = $('#fwSeg');
    if (!seg) return;
    const list = (CP && CP.FRAMEWORKS) || [
      { id: 'PAS', name: '문제-자극-해결' }, { id: 'BAB', name: '이전-이후-다리' },
      { id: 'AIDA', name: '주의-흥미-욕구-행동' }, { id: '4U', name: '유용-긴급-독특-구체' },
    ];
    const cur = state.builder.intro.framework || 'PAS';
    seg.innerHTML = list.map(function (f) {
      return '<button type="button" class="' + (cur === f.id ? 'is-on' : '') + '" data-action="set-framework" data-framework="' + esc(f.id) + '" title="' + esc(f.name) + '">' + esc(f.id) + '</button>';
    }).join('');
  }

  function introInput() {
    const kw = state.builder.keyword.trim();
    const topic = state.builder.topic.trim();
    const subject = kw || topic;
    const i = state.builder.intro;
    return {
      product: subject || '이 글의 주제',
      target: state.builder.audience.trim() || '처음 알아보는 분',
      problem: i.problem.trim() || '무엇부터 손대야 할지 몰라 검색만 반복하는 상태',
      solution: i.outcome.trim() || '순서만 바꾸면 30분 안에 끝나는 3단계',
      proof: i.proof.trim(),
      cta: '댓글로 상황 알려주기',
      tone: 'casual',
    };
  }

  function currentIntro() {
    if (!CP || typeof CP.build !== 'function') return null;
    const id = state.builder.intro.framework || 'PAS';
    try { return CP.build(id, introInput()); } catch (e) { return null; }
  }

  function introProfile(fw) {
    if (!fw || !CP) return { total: 0, grade: { id: '—' } };
    return C.psychProfile(CP.diagnose(fw.title + '\n' + fw.body));
  }

  function introText(fw) {
    if (!fw) return '';
    return fw.title + '\n\n' + fw.body;
  }

  function renderIntro() {
    const box = $('#introOut');
    if (!box) return;
    const empty = !state.builder.topic.trim() && !state.builder.keyword.trim();
    if (empty) {
      box.innerHTML = '<p class="muted" style="font-size:12px">주제나 키워드를 넣으면 PAS · BAB · AIDA · 4U 도입부가 바로 나옵니다.</p>';
      $('#introPsych').textContent = '';
      $('#introNote').textContent = '';
      return;
    }
    const fw = currentIntro();
    if (!fw) {
      box.innerHTML = '<p class="muted" style="font-size:12px">도입부 엔진을 불러오지 못했어요.</p>';
      $('#introPsych').textContent = '';
      return;
    }
    const prof = introProfile(fw);
    $('#introPsych').textContent = fw.id + ' · 설득 점수 ' + prof.total + '점 (' + prof.grade.id + ')';
    const i = state.builder.intro;
    const missing = !i.problem.trim() || !i.outcome.trim();
    $('#introNote').textContent = fw.chars + '자 · ' + (missing ? '독자의 문제·얻는 결과를 채우면 문장이 정확해져요' : '그대로 복사해도 됩니다');
    box.innerHTML =
      '<div class="intro-title"><span class="t-formula">' + esc(fw.id) + '</span><b>' + esc(fw.title) + '</b></div>' +
      fw.sections.map(function (s) {
        return '<div class="intro-sec"><span class="i-label">' + esc(s.label) + '</span><p>' + esc(s.text) + '</p></div>';
      }).join('');
  }

  function copyIntro() {
    const fw = currentIntro();
    if (!fw) { toast('주제를 먼저 입력하세요.', { type: 'warn' }); return; }
    copyText(introText(fw), fw.id + ' 도입부를 복사했어요.');
  }

  function introToDiag() {
    const fw = currentIntro();
    if (!fw) { toast('주제를 먼저 입력하세요.', { type: 'warn' }); return; }
    const before = state.diag.body || '';
    const text = introText(fw);
    if (!state.diag.keyword.trim()) {
      state.diag.keyword = state.builder.keyword.trim() || state.builder.topic.trim();
      $('#diagKeyword').value = state.diag.keyword;
    }
    const next = before.trim() && before.indexOf(fw.body) < 0 ? text + '\n\n' + before : text;
    setDiagBody(next);
    switchTab('diagnose');
    toast('도입부를 진단 탭 본문에 넣었어요.', {
      action: { label: '되돌리기', run: function () { setDiagBody(before); } },
    });
  }

  /* ── 내 구독 AI 원클릭 브리지 ─────────────────────────── */

  function builderReady() {
    return !!(state.builder.topic.trim() || state.builder.keyword.trim());
  }

  function renderBridge() {
    const box = $('#bridgeBtns');
    if (!box) return;
    if (!B) {
      box.innerHTML = '<span class="muted" style="font-size:12px">AI 브리지를 불러오지 못했어요. engines/ai-bridge.js를 확인하세요.</span>';
      return;
    }
    const ready = builderReady();
    const prompt = ready ? C.buildPrompt(builderOptions()) : '';
    box.innerHTML = B.listProviders().map(function (p) {
      const link = B.linkFor(p.id, prompt);
      return '<a class="btn btn-ghost btn-sm bridge-btn" href="' + esc(link.url) + '" target="_blank" rel="noopener noreferrer" ' +
        'data-action="bridge-open" data-provider="' + esc(p.id) + '" title="' + esc(link.note) + '">' +
        esc(p.label) + ' 열기<span class="b-tag' + (link.prefilled ? '' : ' paste') + '">' +
        (link.prefilled ? '자동 입력' : '붙여넣기') + '</span></a>';
    }).join('');
    const note = $('#bridgeNote');
    if (note) {
      note.textContent = ready
        ? '버튼을 누르면 프롬프트가 클립보드에 복사되고 새 창이 열립니다. ChatGPT·Claude는 입력창에 채워지고, Gemini는 붙여넣기(Ctrl+V)만 하면 돼요.'
        : '주제나 키워드를 입력하면 세 AI로 보낼 프롬프트가 완성됩니다.';
    }
  }

  function bridgeOpen(id) {
    if (!B) return;
    if (!builderReady()) { toast('주제나 키워드를 먼저 입력하세요.', { type: 'warn' }); return; }
    const prompt = C.buildPrompt(builderOptions());
    const link = B.linkFor(id, prompt);
    copyText(prompt, link.prefilled
      ? link.label + ' 창에 프롬프트를 채웠어요. 그대로 보내면 됩니다.'
      : link.label + ' 창을 열었어요. 프롬프트를 붙여넣으세요(Ctrl+V).');
    window.open(link.url, '_blank', 'noopener');
  }

  function renderAiDraft() {
    const meta = $('#aiDraftMeta');
    const input = $('#aiDraftInput');
    if (!meta || !input) return;
    const raw = input.value;
    if (!raw.trim()) {
      meta.className = 'ai-draft-meta';
      meta.textContent = '붙여넣으면 제목·본문·태그를 나눠서 미리 점수를 계산해요.';
      return;
    }
    if (!B) { meta.textContent = 'AI 브리지를 불러오지 못했어요.'; return; }
    const parsed = B.parseDraft(raw);
    const keyword = parsed.keyword || state.builder.keyword.trim() || state.diag.keyword.trim();
    let score = null;
    if (parsed.title || parsed.body) score = C.scorePost({ keyword: keyword, title: parsed.title, body: parsed.body });

    const chips = [
      '<span class="ai-chip' + (parsed.title ? ' ok' : ' warn') + '">' +
        (parsed.title ? '제목 ' + parsed.stats.titleChars + '자' : '제목 없음') + '</span>',
      '<span class="ai-chip' + (parsed.stats.bodyNoSpace >= 2000 ? ' ok' : '') + '">본문 ' + fmt(parsed.stats.bodyNoSpace) + '자</span>',
      '<span class="ai-chip">태그 ' + parsed.tags.length + '</span>',
      score ? '<span class="ai-chip score ' + (score.total >= 90 ? 'ok' : score.total >= 75 ? '' : 'warn') + '">미리 ' + score.total + '점 · ' + score.grade + '</span>' : '',
    ].filter(Boolean).join('');

    meta.className = 'ai-draft-meta';
    meta.innerHTML = '<div class="ai-chips">' + chips + '</div>' +
      (parsed.warnings.length ? '<ul class="ai-warn">' + parsed.warnings.slice(0, 3).map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' : '');
  }

  function aiDraftToDiag() {
    const input = $('#aiDraftInput');
    if (!input || !B) return;
    const parsed = B.parseDraft(input.value);
    if (!parsed.title && !parsed.body) { toast('AI 원고를 먼저 붙여넣으세요.', { type: 'warn' }); return; }
    const keyword = parsed.keyword || state.builder.keyword.trim() || state.diag.keyword.trim();
    state.diag = { keyword: keyword, title: parsed.title, body: parsed.body };
    $('#diagKeyword').value = state.diag.keyword;
    $('#diagTitle').value = state.diag.title;
    $('#diagBody').value = state.diag.body;
    save(KEY.diag, state.diag);
    switchTab('diagnose');
    const r = state.lastScore;
    const total = r ? r.total : 0;
    toast('AI 원고를 열었어요 · ' + total + '점' + (total >= 90
      ? ' (90점 통과, 그대로 발행할 수 있어요)'
      : ' — 감점 항목부터 고치면 90점에 가까워져요'));
  }

  function saveGemini() {
    const keyEl = $('#geminiKey');
    const modelEl = $('#geminiModel');
    if (keyEl) state.settings.geminiKey = keyEl.value.trim();
    if (modelEl) state.settings.geminiModel = modelEl.value.trim() || (B ? B.GEMINI_DEFAULT_MODEL : 'gemini-3.5-flash-lite');
    save(KEY.settings, state.settings);
  }

  async function geminiGenerate() {
    const status = $('#geminiStatus');
    if (!B || !CP) { if (status) status.textContent = '엔진을 불러오지 못했어요.'; return; }
    if (state.geminiBusy) return;
    if (!builderReady()) { toast('주제나 키워드를 먼저 입력하세요.', { type: 'warn' }); return; }
    const key = ($('#geminiKey').value || '').trim();
    const model = ($('#geminiModel').value || '').trim() || B.GEMINI_DEFAULT_MODEL;
    if (!key) {
      if (status) { status.className = 'form-error'; status.textContent = '키를 넣거나, 위의 ChatGPT·Claude 버튼을 쓰세요.'; }
      return;
    }
    saveGemini();

    const prompt = C.buildPrompt(builderOptions());
    let req;
    try { req = B.buildGeminiRequest({ apiKey: key, model: model, prompt: prompt }); }
    catch (e) { if (status) { status.className = 'form-error'; status.textContent = e.message; } return; }

    state.geminiBusy = true;
    if (status) { status.className = 'form-ok'; status.textContent = '생성 중… (10~30초)'; }
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, 45000);
    try {
      const res = await fetch(req.url, Object.assign({}, req.init, { signal: controller.signal }));
      clearTimeout(timer);
      const rawText = await res.text();
      let json = null;
      try { json = JSON.parse(rawText); } catch (e) { json = null; }
      if (!res.ok) {
        const detail = json && json.error && json.error.message ? json.error.message : rawText;
        if (status) { status.className = 'form-error'; status.textContent = B.explainStatus(res.status, detail); }
        return;
      }
      const out = B.parseGeminiResponse(json);
      if (!out.ok) { if (status) { status.className = 'form-error'; status.textContent = out.error; } return; }
      $('#aiDraftInput').value = out.text;
      renderAiDraft();
      if (status) {
        status.className = 'form-ok';
        status.textContent = '원고를 받았어요. 아래 [진단 탭에서 열기]를 누르세요.' + (out.warnings.length ? ' ' + out.warnings[0] : '');
      }
      toast('Gemini가 원고를 보냈어요. 90점 검수로 넘어가세요.');
    } catch (e) {
      clearTimeout(timer);
      if (status) {
        status.className = 'form-error';
        status.textContent = e && e.name === 'AbortError'
          ? '응답이 늦어 취소했어요. 다시 시도하거나 다른 모델을 골라 보세요.'
          : '연결하지 못했어요. 키·네트워크·브라우저 차단을 확인하세요.';
      }
    } finally {
      state.geminiBusy = false;
    }
  }

  /* ── 무료 AI 맛보기 (Cloudflare Worker) ─────────────────
     키가 없는 방문자가 하루 몇 번 바로 원고를 받아 보는 경로.
     503(모든 제공자 혼잡)은 클라이언트가 1회 자동 재시도하고,
     429(한도 소진)면 내 키·구독 브리지 안내 카드를 띄운다. */

  function freeSystemLine() {
    return '한국어 블로그 원고를 쓴다. 첫 줄은 제목, 그 다음부터 본문. ' +
      '번역체·AI 요약체 금지, 실제로 말하듯 자연스럽게. 표시광고법 위반 표현(최고·유일·100%) 금지.';
  }

  function renderFreeLimit(res) {
    const card = $('#freeLimitCard');
    const status = $('#freeStatus');
    if (status) status.textContent = '오늘 무료 체험을 다 썼어요';
    if (!card) return;
    const cta = (res && res.cta) || {};
    const href = cta.keyUrl || 'https://aistudio.google.com/apikey';
    card.hidden = false;
    card.innerHTML =
      '<b>무료 체험을 다 쓰셨어요</b>' +
      '<div>' + esc((res && res.message) || '오늘 무료 횟수를 모두 썼어요. 내 키나 구독 AI로 이어서 쓸 수 있어요.') + '</div>' +
      '<div class="free-limit-actions">' +
        '<a class="btn btn-primary btn-sm" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" data-action="free-connect-key">내 무료 Gemini 키 연결</a>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="free-open-pro">구독 AI 브리지로 이어서</button>' +
      '</div>';
  }

  function renderFreeRemain(res) {
    const remain = $('#freeRemain');
    const status = $('#freeStatus');
    if (remain) {
      remain.textContent = (res && res.remaining !== null && res.remaining !== undefined)
        ? '남은 무료 ' + res.remaining + '/' + (res.limit || 5) + '회'
        : '';
    }
    if (status) status.textContent = '무료로 받았어요' + (res && res.provider ? ' · ' + res.provider : '');
  }

  async function freeTasteGenerate() {
    const status = $('#freeStatus');
    if (!FA) { if (status) status.textContent = '무료 체험 엔진을 불러오지 못했어요.'; return; }
    if (state.freeBusy) return;
    if (!builderReady()) { toast('주제나 키워드를 먼저 입력하세요.', { type: 'warn' }); return; }

    state.freeBusy = true;
    const btn = $('[data-action="free-generate"]');
    if (btn) btn.setAttribute('aria-busy', 'true');
    const card = $('#freeLimitCard');
    if (card) card.hidden = true;
    if (status) status.textContent = '무료로 생성 중… (5~20초)';

    let res;
    try {
      res = await FA.routeWith(P, {
        task: 'text',
        prompt: C.buildPrompt(builderOptions()),
        system: freeSystemLine(),
        options: { temperature: 0.7, maxTokens: 900 },
      }, { timeoutMs: 45000 });
    } catch (e) {
      res = { ok: false, message: '연결하지 못했어요. 인터넷을 확인하고 다시 시도해 주세요.' };
    } finally {
      state.freeBusy = false;
      if (btn) btn.setAttribute('aria-busy', 'false');
    }

    if (res && res.ok) {
      const input = $('#aiDraftInput');
      if (input) input.value = res.text;
      renderAiDraft();
      renderFreeRemain(res);
      toast('원고를 받았어요. 아래 [진단 탭에서 열기]를 누르세요.');
      return;
    }

    if (FA.isQuota(res)) { renderFreeLimit(res); return; }
    if (status) {
      status.className = 'muted';
      status.textContent = (res && res.message) || '무료 체험 중 문제가 생겼어요. 잠시 뒤 다시 시도해 주세요.';
    }
    if (res && res.reason === 'all_providers_busy') {
      toast('지금 무료 AI가 혼잡해요. 잠시 뒤 다시 눌러 주세요.', { type: 'warn' });
    }
  }

  function renderToneSeg() {
    const seg = $('#toneSeg');
    if (!seg) return;
    seg.innerHTML = C.TONES.map(function (t) {
      return '<button type="button" class="' + (state.builder.tone === t.id ? 'is-on' : '') + '" data-action="set-tone" data-tone="' + t.id + '" title="' + esc(t.desc) + '">' + esc(t.label) + '</button>';
    }).join('');
  }

  function renderIncludeChecks() {
    const box = $('#includeChecks');
    if (!box) return;
    const items = [
      ['table', '비교표'], ['checklist', '체크리스트'], ['faq', 'FAQ'],
      ['price', '가격·비용'], ['caution', '주의사항'],
    ];
    box.innerHTML = items.map(function (pair) {
      return '<label class="check"><input type="checkbox" data-include="' + pair[0] + '"' +
        (state.builder.include[pair[0]] ? ' checked' : '') + ' />' + pair[1] + '</label>';
    }).join('');
  }

  function outlineText() {
    const o = C.buildOutline(builderOptions());
    const lines = ['# ' + (o.topic || o.keyword)];
    o.h2.forEach(function (h) {
      lines.push('');
      lines.push('## ' + h.index + '. ' + h.title);
      h.points.forEach(function (p) { lines.push('- ' + p); });
    });
    lines.push('');
    lines.push('## 발행 전 체크리스트');
    o.checklist.forEach(function (c) { lines.push('- ' + c); });
    lines.push('');
    lines.push('## 댓글 질문');
    o.questions.forEach(function (q) { lines.push('- ' + q); });
    lines.push('');
    lines.push('태그: ' + o.tags.map(function (t) { return '#' + t; }).join(' '));
    return lines.join('\n');
  }

  function sendToDiag() {
    const o = C.buildOutline(builderOptions());
    if (!o.keyword) { toast('키워드를 먼저 입력하세요.', { type: 'warn' }); return; }
    state.diag.keyword = o.keyword;
    state.diag.title = (o.titles[0] && o.titles[0].text) || '';
    $('#diagKeyword').value = state.diag.keyword;
    $('#diagTitle').value = state.diag.title;
    save(KEY.diag, state.diag);
    switchTab('diagnose');
    toast('키워드와 추천 제목을 진단 탭으로 보냈어요.');
  }

  /* ── drafts ──────────────────────────────────────────── */

  function draftStatus(id) {
    return C.DRAFT_STATUSES.find(function (s) { return s.id === id; }) || C.DRAFT_STATUSES[0];
  }

  function filteredDrafts() {
    const q = state.draftFilter.query.trim().toLowerCase();
    let rows = state.drafts.filter(function (d) {
      if (state.draftFilter.status !== '전체' && d.status !== state.draftFilter.status) return false;
      if (q) {
        const hay = (d.title + ' ' + d.keyword + ' ' + d.memo).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    rows = rows.slice().sort(function (a, b) {
      if (state.draftSort === 'score') return (b.score || 0) - (a.score || 0);
      if (state.draftSort === 'title') return a.title.localeCompare(b.title, 'ko');
      return String(b.date || '').localeCompare(String(a.date || ''));
    });
    return rows;
  }

  function renderDrafts() {
    const all = state.drafts;
    const published = all.filter(function (d) { return ['published', 'visible', 'ranked', 'missing'].indexOf(d.status) >= 0; }).length;
    const visible = all.filter(function (d) { return d.status === 'visible' || d.status === 'ranked'; }).length;
    const missing = all.filter(function (d) { return d.status === 'missing'; }).length;
    const scored = all.filter(function (d) { return typeof d.score === 'number'; });
    const avg = scored.length ? Math.round(scored.reduce(function (a, d) { return a + d.score; }, 0) / scored.length) : 0;

    $('#draftSummary').innerHTML =
      '<div class="stat"><b>' + all.length + '</b><span>기록한 글</span></div>' +
      '<div class="stat"><b>' + published + '</b><span>발행+</span></div>' +
      '<div class="stat hot"><b>' + visible + '</b><span>노출·순위권</span></div>' +
      '<div class="stat warn"><b>' + missing + '</b><span>누락 의심</span></div>' +
      '<div class="stat"><b>' + (scored.length ? avg : '—') + '</b><span>평균 점수</span></div>';

    renderDraftChips(all);
    const rows = filteredDrafts();
    $('#draftRows').innerHTML = rows.map(draftRowHTML).join('');
    $('#draftEmpty').hidden = rows.length > 0;
    const note = $('#draftVisibleNote');
    if (note) {
      note.textContent = rows.length !== all.length
        ? '필터 적용 · ' + rows.length + '건 표시'
        : '전체 ' + all.length + '건' + (scored.length ? ' · 평균 ' + avg + '점' : '');
    }
    if (!all.length) {
      $('#draftEmpty').innerHTML = '<p><strong>아직 기록한 글이 없습니다.</strong></p>' +
        '<p class="muted">진단 탭에서 점수를 확인한 뒤 \'발행 목록에 추가\'를 누르면 여기로 들어옵니다.</p>' +
        '<button class="btn btn-ghost" data-action="open-add-draft">첫 글 추가</button>';
    } else if (!rows.length) {
      $('#draftEmpty').innerHTML = '<p><strong>조건에 맞는 글이 없습니다.</strong></p>' +
        '<p class="muted">상태 필터나 검색어를 바꿔 보세요.</p>' +
        '<button class="btn btn-ghost" data-action="reset-draft-filters">필터 초기화</button>';
    }
    const count = all.length;
    const badge = $('#draftCount');
    badge.textContent = count;
    badge.hidden = count === 0;
  }

  function renderDraftChips(all) {
    const items = [{ id: '전체', label: '전체' }].concat(C.DRAFT_STATUSES.map(function (s) { return { id: s.id, label: s.label }; }));
    $('#draftChips').innerHTML = items.map(function (it) {
      const n = it.id === '전체' ? all.length : all.filter(function (d) { return d.status === it.id; }).length;
      return '<button type="button" class="chip' + (state.draftFilter.status === it.id ? ' is-on' : '') + '" data-draftfilter="' + esc(it.id) + '">' +
        esc(it.label) + ' <span class="muted">' + n + '</span></button>';
    }).join('');
  }

  function draftRowHTML(d) {
    const st = draftStatus(d.status);
    const score = typeof d.score === 'number' ? d.score : null;
    const low = score != null && score < 75 ? ' low' : '';
    const title = d.url
      ? '<a href="' + esc(d.url) + '" target="_blank" rel="noopener noreferrer">' + esc(d.title) + '</a>'
      : esc(d.title);
    return '<div class="draft-row" data-id="' + esc(d.id) + '">' +
      '<div><select class="status-select" data-action="set-draft-status" data-id="' + esc(d.id) + '" aria-label="상태 변경">' +
        C.DRAFT_STATUSES.map(function (s) { return '<option value="' + s.id + '"' + (s.id === d.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="draft-main"><span class="draft-title">' + title + '</span>' +
        '<span class="draft-sub"><span class="kw">' + esc(d.keyword || '키워드 없음') + '</span></span></div>' +
      '<div class="draft-date">' + esc(C.formatDateKR(d.date)) + '</div>' +
      '<div class="draft-score">' + (score == null ? '<span class="muted" style="font-size:11px">—</span>' :
        '<span class="mini-bar"><i class="' + low.trim() + '" style="width:' + score + '%"></i></span><b>' + score + '</b>') + '</div>' +
      '<div class="draft-memo" title="' + esc(d.memo) + '">' + (d.memo ? esc(d.memo) : '<span class="muted">메모 없음</span>') + '</div>' +
      '<div class="draft-actions">' +
        '<button type="button" class="btn btn-ghost" data-action="edit-draft" data-id="' + esc(d.id) + '">수정</button>' +
        '<button type="button" class="icon-mini" data-action="delete-draft" data-id="' + esc(d.id) + '" aria-label="삭제" title="삭제">✕</button>' +
      '</div></div>';
  }

  function openDraftForm(draft) {
    const d = draft || {
      id: '', title: state.diag.title || '', keyword: state.diag.keyword || '', date: C.todayISO(),
      score: state.lastScore && state.lastScore.total ? state.lastScore.total : '', status: 'draft', url: '', memo: '',
    };
    const editing = !!draft;
    openModal({
      title: editing ? '글 수정' : '발행 글 추가',
      body:
        '<form id="draftForm" autocomplete="off">' +
          '<div class="field"><label for="dTitle">제목</label><input id="dTitle" type="text" maxlength="200" value="' + esc(d.title) + '" placeholder="발행한 글 제목" /></div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="dKeyword">타겟 키워드</label><input id="dKeyword" type="text" maxlength="100" value="' + esc(d.keyword) + '" placeholder="예: 겨울 가습기 관리법" /></div>' +
            '<div class="field"><label for="dDate">발행일</label><input id="dDate" type="date" value="' + esc(d.date) + '" /></div>' +
          '</div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="dStatus">상태</label><select id="dStatus">' +
              C.DRAFT_STATUSES.map(function (s) { return '<option value="' + s.id + '"' + (s.id === d.status ? ' selected' : '') + '>' + esc(s.label) + '</option>'; }).join('') +
            '</select></div>' +
            '<div class="field"><label for="dScore">점수 (0~100)</label><input id="dScore" type="number" min="0" max="100" value="' + (d.score === '' || d.score == null ? '' : esc(d.score)) + '" placeholder="진단 점수" /></div>' +
          '</div>' +
          '<div class="field"><label for="dUrl">글 주소 (선택)</label><input id="dUrl" type="url" maxlength="500" value="' + esc(d.url) + '" placeholder="https://blog.naver.com/…" /></div>' +
          '<div class="field"><label for="dMemo">메모</label><textarea id="dMemo" class="input" rows="3" maxlength="500" placeholder="예: 3일 뒤 노출 확인, 첫 댓글 달기">' + esc(d.memo) + '</textarea></div>' +
          '<div class="form-error" id="draftError"></div>' +
          '<div class="modal-foot"><button type="button" class="btn btn-ghost" data-action="close-modal">취소</button>' +
            '<button type="submit" class="btn btn-primary">' + (editing ? '저장' : '추가') + '</button></div>' +
        '</form>',
      onMount: function () {
        $('#draftForm').addEventListener('submit', function (e) {
          e.preventDefault();
          const title = $('#dTitle').value.trim();
          const err = $('#draftError');
          if (!title) { err.textContent = '제목을 입력하세요.'; return; }
          const url = $('#dUrl').value.trim();
          if (url && !/^https?:\/\//i.test(url)) { err.textContent = '주소는 http:// 또는 https://로 시작해야 해요.'; return; }
          const scoreRaw = $('#dScore').value;
          const item = {
            id: editing ? draft.id : C.uid('draft'),
            title: title,
            keyword: $('#dKeyword').value.trim(),
            date: $('#dDate').value || C.todayISO(),
            status: $('#dStatus').value,
            score: scoreRaw === '' ? null : C.clamp(Math.round(Number(scoreRaw)), 0, 100),
            url: url,
            memo: $('#dMemo').value.trim(),
          };
          if (editing) {
            const i = state.drafts.findIndex(function (x) { return x.id === item.id; });
            if (i >= 0) state.drafts[i] = item;
          } else {
            state.drafts.unshift(item);
          }
          save(KEY.drafts, state.drafts);
          renderDrafts();
          closeModal();
          toast(editing ? '수정했어요.' : '발행 목록에 추가했어요.');
        });
      },
    });
  }

  function deleteDraft(id) {
    const idx = state.drafts.findIndex(function (d) { return d.id === id; });
    if (idx < 0) return;
    const removed = state.drafts.splice(idx, 1)[0];
    save(KEY.drafts, state.drafts);
    renderDrafts();
    toast('"' + removed.title.slice(0, 24) + '"을(를) 지웠어요.', {
      action: {
        label: '되돌리기',
        run: function () {
          state.drafts.splice(idx, 0, removed);
          save(KEY.drafts, state.drafts);
          renderDrafts();
        },
      },
    });
  }

  function setDraftStatus(id, status) {
    const d = state.drafts.find(function (x) { return x.id === id; });
    if (!d) return;
    d.status = status;
    save(KEY.drafts, state.drafts);
    renderDrafts();
    toast('상태를 "' + draftStatus(status).label + '"(으)로 바꿨어요.');
  }

  /* ── export / import ─────────────────────────────────── */

  function download(filename, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function exportCSV() {
    if (!state.drafts.length) { toast('내보낼 글이 없어요.', { type: 'warn' }); return; }
    const csv = C.draftsToCSV(state.drafts);
    download('blog-seo-drafts-' + C.todayISO() + '.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
    toast(state.drafts.length + '건을 CSV로 내보냈어요.');
  }

  function exportJSON() {
    if (!state.drafts.length) { toast('내보낼 글이 없어요.', { type: 'warn' }); return; }
    const payload = {
      app: 'blog-seo-studio',
      version: C.VERSION,
      exportedAt: new Date().toISOString(),
      count: state.drafts.length,
      items: state.drafts,
    };
    download('blog-seo-drafts-' + C.todayISO() + '.json', JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
    toast(state.drafts.length + '건을 JSON으로 내보냈어요.');
  }

  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label || '복사했어요.');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        const ok = document.execCommand('copy');
        toast(ok ? (label || '복사했어요.') : '복사하지 못했어요. 직접 선택해 주세요.', ok ? undefined : { type: 'warn' });
      } catch (err) {
        toast('복사하지 못했어요. 직접 선택해 주세요.', { type: 'warn' });
      }
      ta.remove();
    }
  }

  /* ── Pro AI (완성 원고) ──────────────────────────────────
     무료 모드에서는 버튼이 연결 안내만 열고, 어떤 요청도 보내지 않는다.
     연결 뒤에는 buildProPrompt('blog') → generate → JSON → 진단 탭 삽입. */

  function proToneLine() {
    const t = C.TONES.filter(function (x) { return x.id === state.builder.tone; })[0];
    if (!t) return '친근한 구어체. 실제로 말하듯, 존댓말이되 딱딱하지 않게.';
    return t.label + ' — ' + t.desc + '. 실제로 말하듯 자연스럽게, 번역체·AI 요약체 금지.';
  }

  function proInput() {
    const b = state.builder;
    const memo = [
      b.intro.problem ? '독자가 겪는 문제: ' + b.intro.problem : '',
      b.intro.outcome ? '얻고 싶은 결과: ' + b.intro.outcome : '',
      b.intro.proof ? '내 근거·수치: ' + b.intro.proof : '',
      b.audience ? '읽는 사람: ' + b.audience : '',
    ].filter(Boolean).join(' / ');
    return {
      topic: (b.topic || b.keyword || '').trim(),
      target: (b.audience || '검색해서 들어온 사람').trim(),
      goal: '네이버 블로그 상위노출. 검색으로 들어온 사람이 끝까지 읽고 저장하게.',
      experience: memo,
      keywords: (b.keyword || '').trim(),
      length: fmt(Number(b.goalChars) || 2000) + '자',
      tone: proToneLine(),
    };
  }

  function proBodyText(data) {
    const lines = [];
    if (data.intro) lines.push(String(data.intro).trim());
    (Array.isArray(data.sections) ? data.sections : []).forEach(function (s) {
      if (!s) return;
      if (s.h2) lines.push('## ' + String(s.h2).trim());
      (Array.isArray(s.paragraphs) ? s.paragraphs : []).forEach(function (p) {
        if (String(p || '').trim()) lines.push(String(p).trim());
      });
    });
    if (data.cta) lines.push(String(data.cta).trim());
    const tags = (Array.isArray(data.hashtags) ? data.hashtags : [])
      .map(function (t) { return '#' + String(t).replace(/^#/, '').trim(); }).filter(function (t) { return t.length > 1; });
    if (tags.length) lines.push(tags.join(' '));
    return lines.join('\n\n').trim();
  }

  function setProBusy(on) {
    state.pro.busy = !!on;
    const btn = $('[data-action="pro-generate"]');
    if (!btn) return;
    btn.setAttribute('aria-busy', on ? 'true' : 'false');
    const label = btn.querySelector('.pro-label');
    if (label) label.textContent = on ? 'Pro AI가 쓰는 중…' : 'Pro AI로 완성 원고 생성';
  }

  function updateProUi() {
    if (!PS) return;
    const s = PS.sync($('#proBox') || document);
    const stateEl = $('#proState');
    if (stateEl && !state.pro.busy) {
      stateEl.textContent = s.connected
        ? s.providerName + ' 연결됨 · 주제·키워드·메모로 완성 원고를 쓰고 원고 진단까지 바로 돌립니다.'
        : '무료 모드 · 지금 만든 뼈대와 프롬프트는 그대로 씁니다. Pro를 연결하면 완성 원고가 바로 들어옵니다.';
    }
  }

  function showProResult(result, input) {
    const data = result.data || {};
    const panel = $('#proResult');
    if (!panel) return;
    panel.hidden = false;
    const titles = Array.isArray(data.titleCandidates) ? data.titleCandidates : [];
    $('#proTitle').textContent = titles[0] || state.pro.title || '';
    const sub = [];
    if (data.metaDescription) sub.push(data.metaDescription);
    sub.push('본문 ' + fmt(C.countChars ? C.countChars(state.pro.body) : state.pro.body.length) + '자');
    if (result.meta) sub.push([result.meta.provider, result.meta.model].filter(Boolean).join(' '));
    $('#proSub').textContent = sub.join(' · ');
    $('#proMeta').textContent = result.meta && result.meta.latencyMs ? Math.round(result.meta.latencyMs) + 'ms' : '';
    state.pro.last = { titles: titles, data: data, input: input };
  }

  function runPro() {
    if (!PS || !P) {
      toast('Pro 연결 엔진을 불러오지 못했어요. 새로고침해 주세요.', { type: 'warn' });
      return;
    }
    if (state.pro.busy) return;
    const input = proInput();
    if (!input.topic) {
      toast('주제나 타깃 키워드를 먼저 입력하세요.', { type: 'warn' });
      $('#bTopic').focus();
      return;
    }
    if (!PS.connected()) {
      updateProUi();
      toast('무료 모드예요. Pro API를 연결하면 완성 원고가 바로 들어옵니다.');
      PS.openConnect();
      return;
    }

    setProBusy(true);
    const stateEl = $('#proState');
    if (stateEl) stateEl.textContent = 'Pro AI가 원고를 쓰는 중… (보통 10~40초) 창을 닫지 마세요.';

    PS.run('blog', input).then(function (res) {
      setProBusy(false);
      if (!res.ok) {
        updateProUi();
        if (stateEl) stateEl.textContent = res.message;
        toast(res.message, { type: 'warn' });
        return;
      }
      const data = res.data || {};
      const titles = (Array.isArray(data.titleCandidates) ? data.titleCandidates : []).map(function (t) { return String(t || '').trim(); }).filter(Boolean);
      const body = proBodyText(data);
      if (!body) {
        toast('응답에 본문이 비어 있어요. 다시 시도해 주세요.', { type: 'warn' });
        return;
      }
      state.pro.body = body;
      state.pro.title = titles[0] || '';
      state.pro.meta = PS.describe(res);

      const keyword = input.keywords || state.builder.keyword || state.builder.topic || '';
      state.diag.keyword = keyword;
      state.diag.title = state.pro.title;
      state.diag.body = body;
      save(KEY.diag, state.diag);
      if ($('#diagKeyword')) $('#diagKeyword').value = keyword;
      if ($('#diagTitle')) $('#diagTitle').value = state.diag.title;
      if ($('#diagBody')) $('#diagBody').value = body;

      showProResult(res, input);
      updateProUi();
      if (stateEl) stateEl.textContent = (res.meta && res.meta.provider ? res.meta.provider + ' ' : '') + '완성 원고를 진단 탭에 넣었습니다. 점수와 걸리는 표현을 확인하세요.';
      runDiagnosis();
      switchTab('diagnose');
      toast('완성 원고 ' + fmt(body.length) + '자를 넣고 진단을 돌렸어요.', { type: 'ok' });
    });
  }

  /* 연결 버튼·모달은 처음 눌렀을 때 만든다.
     시작하자마자 만들면 쓰지 않는 화면(제공자 키 안내 링크)이 DOM에 남는다. */
  function hookProConnect() {
    const btn = $('#proConnect');
    if (!btn || btn.getAttribute('data-pro-hooked') === '1') return;
    btn.setAttribute('data-pro-hooked', '1');
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (P && typeof P.mountModal === 'function') P.mountModal(btn);
      PS.openConnect();
    });
  }

  function initPro() {
    if (!PS) return;
    PS.badge('#proBadge');
    hookProConnect();
    PS.onConnectChange(function () { updateProUi(); });
    updateProUi();
  }

  /* ── delegated events ────────────────────────────────── */

  const ACTIONS = {
    'close-modal': function () { closeModal(); },
    'pro-generate': function () { runPro(); },
    'pro-copy-body': function () {
      if (!state.pro.body) { toast('복사할 원고가 없어요.', { type: 'warn' }); return; }
      copyText(state.pro.body, '완성 원고 본문을 복사했어요.');
    },
    'toggle-theme': function () { applyTheme(state.theme === 'light' ? 'dark' : 'light'); },
    'open-settings': function () { openSettings(); },
    'go-keywords': function (el, e) { if (e) e.preventDefault(); switchTab('keywords'); },
    'go-diagnose': function () { switchTab('diagnose'); },
    'open-add-keyword': function () { openAddKeyword(); },
    'open-paste': function () { openPaste(); },
    'open-proxy-search': function () { openProxySearch(); },
    'clear-search': function () {
      const input = $('#searchInput');
      input.value = '';
      if (state.tab === 'tracker') state.draftFilter.query = '';
      else state.kwFilter.query = '';
      updateSearchClear();
      state.tab === 'tracker' ? renderDrafts() : renderKeywords();
      input.focus();
    },
    'reset-kw-filters': function () {
      state.kwFilter = { category: '전체', grade: '전체', query: '' };
      $('#searchInput').value = '';
      updateSearchClear();
      renderKeywords();
    },
    'reset-draft-filters': function () {
      state.draftFilter = { status: '전체', query: '' };
      $('#searchInput').value = '';
      updateSearchClear();
      renderDrafts();
    },
    'reset-demo': function () {
      state.keywords = demoKeywords();
      save(KEY.keywords, state.keywords);
      renderKeywords();
      toast('예시 키워드 32개로 되돌렸어요.');
    },
    'diagnose-keyword': function (el) {
      state.diag.keyword = el.dataset.keyword;
      $('#diagKeyword').value = state.diag.keyword;
      save(KEY.diag, state.diag);
      switchTab('diagnose');
      $('#diagTitle').focus();
    },
    'delete-keyword': function (el) { removeKeyword(el.dataset.id); },
    'fill-paste-sample': function () {
      const ta = $('#pasteInput');
      if (ta) { ta.value = D.PASTE_SAMPLE; ta.focus(); }
    },
    'load-sample': function (el) { loadSample(el.dataset.sample); },
    'clear-diag': function () { clearDiagnosis(); },
    'add-draft-from-diag': function () {
      if (!state.diag.title.trim()) { toast('제목을 먼저 입력하세요.', { type: 'warn' }); return; }
      openDraftForm(null);
    },
    'copy-prompt': function () {
      if (!builderReady()) { toast('주제를 먼저 입력하세요.', { type: 'warn' }); return; }
      const text = C.buildPrompt(builderOptions());
      copyText(text, 'SEO 프롬프트를 복사했어요. ChatGPT에 붙여넣으세요.');
    },
    'set-framework': function (el) {
      state.builder.intro.framework = el.dataset.framework;
      save(KEY.builder, state.builder);
      renderFwSeg();
      renderIntro();
    },
    'copy-intro': function () { copyIntro(); },
    'intro-to-diag': function () { introToDiag(); },
    'apply-wordfix': function () { applyWordFix(); },
    'bridge-open': function (el) { bridgeOpen(el.dataset.provider); },
    'ai-draft-to-diag': function () { aiDraftToDiag(); },
    'clear-ai-draft': function () {
      const input = $('#aiDraftInput');
      if (input) input.value = '';
      renderAiDraft();
      toast('붙여넣은 원고를 비웠어요.');
    },
    'save-gemini': function () {
      saveGemini();
      const s = $('#geminiStatus');
      if (s) { s.className = 'form-ok'; s.textContent = '키를 이 브라우저에만 저장했어요.'; }
    },
    'gemini-generate': function () { geminiGenerate(); },
    'free-generate': function () { freeTasteGenerate(); },
    'free-connect-key': function () {
      const key = $('#geminiKey');
      if (key) { key.focus(); key.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      const s = $('#freeStatus');
      if (s) s.textContent = 'AI Studio에서 키를 발급해 아래 칸에 넣으면 같은 화면에서 이어서 생성합니다.';
    },
    'free-open-pro': function () {
      if (PS && PS.openConnect) { PS.openConnect(); return; }
      const btn = document.querySelector('[data-action="pro-generate"]');
      if (btn) btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
    },
    'copy-outline': function () {
      if (!state.builder.topic && !state.builder.keyword) { toast('주제를 먼저 입력하세요.', { type: 'warn' }); return; }
      copyText(outlineText(), '아웃라인을 복사했어요.');
    },
    'copy-tags': function () {
      const o = C.buildOutline(builderOptions());
      copyText(o.tags.map(function (t) { return '#' + t; }).join(' '), '태그 10개를 복사했어요.');
    },
    'copy-tag': function (el) { copyText(el.dataset.tag, '태그를 복사했어요.'); },
    'use-title': function (el) {
      state.diag.title = el.dataset.title;
      $('#diagTitle').value = state.diag.title;
      save(KEY.diag, state.diag);
      toast('제목을 진단 탭에 넣었어요. 본문을 채워 보세요.');
    },
    'set-tone': function (el) {
      state.builder.tone = el.dataset.tone;
      save(KEY.builder, state.builder);
      renderBuilder();
    },
    'send-to-diag': function () { sendToDiag(); },
    'open-add-draft': function () { openDraftForm(null); },
    'edit-draft': function (el) {
      const d = state.drafts.find(function (x) { return x.id === el.dataset.id; });
      if (d) openDraftForm(d);
    },
    'delete-draft': function (el) { deleteDraft(el.dataset.id); },
    'export-csv': function () { exportCSV(); },
    'export-json': function () { exportJSON(); },
    'import-json': function () { $('#importFile').click(); },
    'save-settings': function () {
      const cfg = readSettingsForm();
      if (cfg.endpoint && !/^https?:\/\//i.test(cfg.endpoint)) {
        const s = $('#proxyStatus'); s.className = 'proxy-status err'; s.textContent = 'http(s) 주소만 사용할 수 있어요.';
        return;
      }
      state.settings = Object.assign({}, state.settings, cfg);
      save(KEY.settings, state.settings);
      updateProxyButton();
      closeModal();
      toast(cfg.endpoint ? '프록시 설정을 저장했어요.' : '프록시 설정을 비웠어요.');
    },
    'delete-proxy-key': function () {
      state.settings = Object.assign({}, state.settings, { endpoint: '', apiKey: '', header: 'Authorization', prefix: 'Bearer ' });
      save(KEY.settings, state.settings);
      updateProxyButton();
      const k = $('#setApiKey'); if (k) k.value = '';
      const s = $('#proxyStatus'); s.className = 'proxy-status'; s.textContent = '키와 주소를 지웠어요.';
    },
    'test-proxy': function () {
      const cfg = readSettingsForm();
      const status = $('#proxyStatus');
      const preview = $('#proxyPreview');
      status.className = 'proxy-status';
      status.textContent = '테스트 중…';
      preview.innerHTML = '';
      queryProxy(cfg, '겨울 가습기 관리법').then(function (rows) {
        state.proxyRows = rows;
        status.className = 'proxy-status ok';
        status.textContent = '연결 성공 · ' + rows.length + '건 응답';
        preview.innerHTML = rows.slice(0, 5).map(function (r) {
          return '<div class="proxy-row"><b>' + esc(r.keyword) + '</b><span>검색 ' + fmt(r.volume) + ' · 문서 ' + fmt(r.docs) + '</span></div>';
        }).join('') + '<button type="button" class="btn btn-primary btn-sm" data-action="add-proxy-rows" style="margin-top:6px">목록에 추가</button>';
      }).catch(function (err) {
        status.className = 'proxy-status err';
        status.textContent = err.message;
      });
    },
    'add-proxy-rows': function () {
      if (!state.proxyRows.length) return;
      if ($('#setEndpoint')) {
        state.settings = readSettingsForm();
        save(KEY.settings, state.settings);
        updateProxyButton();
      }
      const merged = addKeywords(state.proxyRows);
      closeModal();
      toast('프록시 결과 ' + state.proxyRows.length + '건 중 ' + merged.added + '개 추가, ' + merged.updated + '개 갱신');
      state.proxyRows = [];
    },
  };

  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (ACTIONS[action]) {
      e.preventDefault();
      ACTIONS[action](el, e);
      return;
    }
    if (action === 'set-draft-status') return;
  });

  document.addEventListener('change', function (e) {
    const sel = e.target.closest('[data-action="set-draft-status"]');
    if (sel) { setDraftStatus(sel.dataset.id, sel.value); return; }
    const chk = e.target.closest('[data-include]');
    if (chk) {
      state.builder.include[chk.dataset.include] = chk.checked;
      save(KEY.builder, state.builder);
      renderBuilder();
    }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$('#modalRoot').hidden) { closeModal(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const tab = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains('tab');
      if (!tab) return;
      const tabs = $$('.tab');
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      next.focus();
      switchTab(next.dataset.tab);
    }
  });

  /* chip filters */
  $('#kwChips').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-kwfilter]');
    if (!btn) return;
    state.kwFilter[btn.dataset.kwfilter] = btn.dataset.value;
    renderKeywords();
  });
  $('#draftChips').addEventListener('click', function (e) {
    const btn = e.target.closest('[data-draftfilter]');
    if (!btn) return;
    state.draftFilter.status = btn.dataset.draftfilter;
    renderDrafts();
  });

  /* search */
  $('#searchInput').addEventListener('input', function (e) {
    const q = e.target.value;
    updateSearchClear();
    if (state.tab === 'tracker') { state.draftFilter.query = q; renderDrafts(); }
    else { state.kwFilter.query = q; renderKeywords(); }
  });

  /* diagnosis inputs */
  function onDiagInput(which, value) {
    state.diag[which] = value;
    runDiagnosis();
    clearTimeout(diagSaveTimer);
    diagSaveTimer = setTimeout(function () { save(KEY.diag, state.diag); }, 350);
  }
  $('#diagKeyword').addEventListener('input', function (e) { onDiagInput('keyword', e.target.value); });
  $('#diagTitle').addEventListener('input', function (e) { onDiagInput('title', e.target.value); });
  $('#diagBody').addEventListener('input', function (e) { onDiagInput('body', e.target.value); });

  /* builder inputs */
  function onBuilderInput(key, value) {
    state.builder[key] = value;
    clearTimeout(builderTimer);
    builderTimer = setTimeout(function () {
      save(KEY.builder, state.builder);
      renderBuilder();
    }, 180);
    renderBuilder();
  }
  $('#bTopic').addEventListener('input', function (e) { onBuilderInput('topic', e.target.value); });
  $('#bKeyword').addEventListener('input', function (e) { onBuilderInput('keyword', e.target.value); });
  $('#bAudience').addEventListener('input', function (e) { onBuilderInput('audience', e.target.value); });
  $('#bGoal').addEventListener('change', function (e) { onBuilderInput('goalChars', e.target.value); });

  /* 도입부 입력 */
  function onIntroInput(key, value) {
    state.builder.intro[key] = value;
    clearTimeout(builderTimer);
    builderTimer = setTimeout(function () { save(KEY.builder, state.builder); }, 250);
    renderIntro();
  }
  ['iProblem', 'iOutcome', 'iProof'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    const key = id === 'iProblem' ? 'problem' : id === 'iOutcome' ? 'outcome' : 'proof';
    el.addEventListener('input', function (e) { onIntroInput(key, e.target.value); });
  });

  /* AI 원고 붙여넣기 */
  const aiDraftInput = document.getElementById('aiDraftInput');
  if (aiDraftInput) aiDraftInput.addEventListener('input', renderAiDraft);

  /* selects */
  $('#kwSort').addEventListener('change', function (e) { state.kwSort = e.target.value; renderKeywords(); });
  $('#draftSort').addEventListener('change', function (e) { state.draftSort = e.target.value; renderDrafts(); });

  /* tab clicks */
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(tab.dataset.tab); });
  });

  /* import */
  $('#importFile').addEventListener('change', function (e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      const res = C.parseDraftImport(String(reader.result || ''));
      if (res.error) { toast(res.error, { type: 'warn' }); return; }
      const existing = {};
      state.drafts.forEach(function (d) { existing[d.title.trim().toLowerCase()] = true; });
      let added = 0;
      res.items.forEach(function (d) {
        if (existing[d.title.trim().toLowerCase()]) return;
        state.drafts.push(d);
        existing[d.title.trim().toLowerCase()] = true;
        added++;
      });
      save(KEY.drafts, state.drafts);
      renderDrafts();
      toast(res.items.length + '건 중 ' + added + '건 가져왔어요.');
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  });

  /* ── init ────────────────────────────────────────────── */

  function init() {
    const storedTheme = load(KEY.theme, null);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(storedTheme || (prefersDark ? 'dark' : 'light'));

    const storedKw = normalizeKeywords(load(KEY.keywords, null));
    state.keywords = storedKw || demoKeywords();
    save(KEY.keywords, state.keywords);

    const storedDrafts = load(KEY.drafts, []);
    state.drafts = Array.isArray(storedDrafts) ? storedDrafts.filter(function (d) { return d && d.title; }) : [];

    const settings = load(KEY.settings, null);
    if (settings && typeof settings === 'object') {
      state.settings = Object.assign({
        endpoint: '', apiKey: '', header: 'Authorization', prefix: 'Bearer ',
        geminiKey: '', geminiModel: B ? B.GEMINI_DEFAULT_MODEL : 'gemini-3.5-flash-lite',
      }, settings);
    }

    const diag = load(KEY.diag, null);
    if (diag && typeof diag === 'object') {
      state.diag = { keyword: String(diag.keyword || ''), title: String(diag.title || ''), body: String(diag.body || '') };
    }
    $('#diagKeyword').value = state.diag.keyword;
    $('#diagTitle').value = state.diag.title;
    $('#diagBody').value = state.diag.body;

    const builder = load(KEY.builder, null);
    if (builder && typeof builder === 'object') {
      state.builder = Object.assign(state.builder, builder, {
        include: Object.assign({ table: true, checklist: true, faq: true, price: true, caution: true }, builder.include || {}),
        intro: Object.assign({ framework: 'PAS', problem: '', outcome: '', proof: '' }, builder.intro || {}),
      });
    }
    $('#bTopic').value = state.builder.topic || '';
    $('#bKeyword').value = state.builder.keyword || '';
    $('#bAudience').value = state.builder.audience || '';
    $('#bGoal').value = String(state.builder.goalChars || '2000');
    if ($('#iProblem')) $('#iProblem').value = state.builder.intro.problem || '';
    if ($('#iOutcome')) $('#iOutcome').value = state.builder.intro.outcome || '';
    if ($('#iProof')) $('#iProof').value = state.builder.intro.proof || '';
    if ($('#geminiKey')) $('#geminiKey').value = state.settings.geminiKey || '';
    if ($('#geminiModel')) $('#geminiModel').value = state.settings.geminiModel || (B ? B.GEMINI_DEFAULT_MODEL : '');
    if ($('#geminiModels') && B) {
      $('#geminiModels').innerHTML = B.GEMINI_MODELS.map(function (m) { return '<option value="' + esc(m) + '"></option>'; }).join('');
    }

    renderKeywords();
    renderBuilder();
    runDiagnosis();
    renderDrafts();
    updateProxyButton();
    updateSearchClear();
    initPro();
    switchTab('keywords');
    save(KEY.seeded, D.SEED_VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* expose a tiny handle for UI tests */
  window.__studio = {
    state: state, switchTab: switchTab, renderKeywords: renderKeywords, runDiagnosis: runDiagnosis,
    renderBuilder: renderBuilder, renderIntro: renderIntro, renderBridge: renderBridge,
    C: C, CopyPsych: CP, AiBridge: B,
    ProConnector: P, ProStudio: PS, runPro: runPro,
  };
})();
