/* ============================================================
   블로그 SEO 스튜디오 · core.js
   DOM 없는 순수 로직: 경쟁률·등급, 제목/본문 진단, 점수 산출,
   위험 표현·AI 번역체 탐지, 아웃라인/프롬프트 생성, 표 파싱·내보내기.
   브라우저(window.SeoCore)와 node test.js가 함께 쓴다.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SeoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.1.0';

  /* 영어 UI 모드에서는 영어 데모 문구·탐지 사전을 쓴다(한국어 모드 동작은 그대로). */
  const IS_EN = (typeof window !== 'undefined' && window.ONETAP_LANG === 'en');

  /* 한국어 어절·조사 정밀 분석 엔진(engines/korean-text.js).
     브라우저에서는 window.KoreanText, node 테스트에서는 require 로 읽는다.
     없으면 예전 정규식 방식으로 조용히 돌아간다. */
  function loadKoreanText() {
    const g = typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : {});
    if (g && g.KoreanText) return g.KoreanText;
    if (typeof require === 'function') {
      try { return require('./engines/korean-text.js'); } catch (e) { /* noop */ }
    }
    return null;
  }
  const KT = loadKoreanText();

  const CATEGORIES = ['생활', '금융', 'IT', '맛집', '육아', '여행', '뷰티', '자기계발', '기타'];

  const GRADES = [
    { id: 'S', label: 'S', title: '황금 키워드', tone: 's' },
    { id: 'A', label: 'A', title: '공략 가능', tone: 'a' },
    { id: 'B', label: 'B', title: '경쟁 보통', tone: 'b' },
    { id: 'C', label: 'C', title: '고경쟁', tone: 'c' },
  ];

  const TONES = [
    { id: 'casual', label: '구어체', desc: '친구에게 말하듯' },
    { id: 'expert', label: '전문가', desc: '기준과 근거 중심' },
    { id: 'review', label: '체험후기', desc: '직접 겪은 순서대로' },
  ];

  const DRAFT_STATUSES = [
    { id: 'draft', label: '작성 중', tone: 'neutral' },
    { id: 'temp', label: '임시저장', tone: 'neutral' },
    { id: 'published', label: '발행', tone: 'info' },
    { id: 'visible', label: '노출 확인', tone: 'ok' },
    { id: 'ranked', label: '순위권', tone: 'brand' },
    { id: 'missing', label: '누락 의심', tone: 'danger' },
  ];

  /* ── 숫자·표기 ───────────────────────────────────────────── */

  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

  function formatNumber(n) {
    const v = Number(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('ko-KR');
  }

  function formatCompact(n) {
    const v = Number(n);
    if (!isFinite(v) || v <= 0) return '0';
    if (v >= 100000000) return trimZero((v / 100000000).toFixed(1)) + '억';
    if (v >= 10000) return trimZero((v / 10000).toFixed(1)) + '만';
    if (v >= 1000) return v.toLocaleString('ko-KR');
    return String(Math.round(v));
  }

  function trimZero(s) { return s.replace(/\.0$/, ''); }

  /** "12,400", "1.2만", "3천", "1억" 같은 표기를 숫자로. */
  function parseCount(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    let s = String(value == null ? '' : value).trim();
    if (!s) return 0;
    s = s.replace(/,/g, '').replace(/\s/g, '');
    let mult = 1;
    if (/억$/.test(s)) { mult = 100000000; s = s.replace(/억$/, ''); }
    else if (/만$/.test(s)) { mult = 10000; s = s.replace(/만$/, ''); }
    else if (/천$/.test(s)) { mult = 1000; s = s.replace(/천$/, ''); }
    const n = Number(s.replace(/[^0-9.\-]/g, ''));
    if (!isFinite(n)) return 0;
    return Math.round(n * mult);
  }

  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    const h = String(haystack).toLowerCase();
    const w = String(needle).toLowerCase();
    let i = 0, n = 0;
    while ((i = h.indexOf(w, i)) !== -1) { n++; i += Math.max(1, w.length); }
    return n;
  }

  /**
   * 키워드 카운터.
   * 한국어 엔진이 있으면 **어절 경계 + 조사 변형**을 인정해 센다.
   *   "가습기" → "가습기를/가습기가/가습기에서" = 1회 (조사)
   *   "가습기" → "가습기살균제" = 0회(복합어로 따로 집계)
   * 엔진이 없을 때만 예전 정규식으로 돌아간다.
   */
  function keywordMatcher(keyword) {
    const kw = String(keyword || '').trim();
    if (!kw) return { count: function () { return 0; }, detail: function () { return { exact: 0, embedded: 0, withJosa: 0, positions: [], embeddedWords: [] }; } };
    if (KT && typeof KT.matcher === 'function') return KT.matcher(kw);
    const re = new RegExp(kw.split(/\s+/).map(escapeReg).join('\\s*'), 'gi');
    return {
      count: function (text) { return (String(text).match(re) || []).length; },
      detail: function (text) { return { exact: (String(text).match(re) || []).length, embedded: 0, withJosa: 0, positions: [], embeddedWords: [] }; },
    };
  }

  function codePoints(s) { return Array.from(String(s || '')).length; }

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function todayISO(now) {
    const d = now ? new Date(now) : new Date();
    const p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function formatDateKR(iso) {
    if (!iso) return '—';
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso);
    return m[1] + '.' + m[2] + '.' + m[3];
  }

  /* ── 키워드 경쟁률·등급 ──────────────────────────────────── */

  function competitionRatio(docs, volume) {
    const d = Number(docs) || 0;
    const v = Number(volume) || 0;
    if (v <= 0) return d > 0 ? Infinity : 0;
    return d / v;
  }

  /** 포화도 % = 문서수 ÷ 검색량 × 100 (블라이 방식) */
  function saturation(docs, volume) {
    const r = competitionRatio(docs, volume);
    if (!isFinite(r)) return 999;
    return Math.round(r * 1000) / 10;
  }

  /** 추천도 0~100: 수요 40% + 경쟁 여유 60% */
  function opportunityScore(volume, docs) {
    const v = Math.max(0, Number(volume) || 0);
    const r = competitionRatio(docs, volume);
    const volScore = clamp((Math.log10(Math.max(1, v)) - 2) / 3, 0, 1); // 100회 0 → 10만회 1
    const ratioScore = isFinite(r) ? clamp(1 - r / 1.2, 0, 1) : 0;
    return Math.round(clamp((volScore * 0.4 + ratioScore * 0.6) * 100, 0, 100));
  }

  function gradeOf(volume, docs) {
    const v = Number(volume) || 0;
    const r = competitionRatio(docs, volume);
    if (v < 300) return 'C';
    if (r <= 0.15) return 'S';
    if (r <= 0.35) return 'A';
    if (r <= 0.8) return 'B';
    return 'C';
  }

  function gradeInfo(id) {
    return GRADES.find(function (g) { return g.id === id; }) || GRADES[3];
  }

  function recommendLabel(score) {
    if (score >= 80) return '지금 쓰기 좋음';
    if (score >= 65) return '도전 가능';
    if (score >= 50) return '경쟁 있음';
    return '롱테일 권장';
  }

  /** 거친 추정: 월 검색량 ÷ 30 × 등급별 클릭률 */
  function expectedVisits(volume, grade) {
    const ctr = grade === 'S' ? 0.09 : grade === 'A' ? 0.06 : grade === 'B' ? 0.04 : 0.02;
    return Math.round((Number(volume) || 0) / 30 * ctr);
  }

  function analyzeKeyword(row) {
    const volume = Math.max(0, parseCount(row.volume));
    const docs = Math.max(0, parseCount(row.docs));
    const grade = gradeOf(volume, docs);
    const score = opportunityScore(volume, docs);
    return {
      id: row.id || uid('kw'),
      keyword: String(row.keyword || '').trim(),
      volume: volume,
      docs: docs,
      category: row.category && CATEGORIES.indexOf(row.category) >= 0 ? row.category : '기타',
      ratio: competitionRatio(docs, volume),
      saturation: saturation(docs, volume),
      grade: grade,
      gradeLabel: gradeInfo(grade).title,
      score: score,
      recommendLabel: recommendLabel(score),
      expectedVisits: expectedVisits(volume, grade),
      custom: !!row.custom,
    };
  }

  function sortKeywords(rows, sort) {
    const list = rows.slice();
    const key = sort || 'score';
    list.sort(function (a, b) {
      if (key === 'volume') return b.volume - a.volume || b.score - a.score;
      if (key === 'docs') return a.docs - b.docs || b.score - a.score;
      if (key === 'ratio') {
        const ar = isFinite(a.ratio) ? a.ratio : 99;
        const br = isFinite(b.ratio) ? b.ratio : 99;
        return ar - br || b.score - a.score;
      }
      if (key === 'keyword') return a.keyword.localeCompare(b.keyword, 'ko');
      return b.score - a.score || a.docs - b.docs;
    });
    return list;
  }

  function keywordStats(rows) {
    const total = rows.length;
    const byGrade = { S: 0, A: 0, B: 0, C: 0 };
    let sumScore = 0, sumVolume = 0;
    rows.forEach(function (r) {
      byGrade[r.grade] = (byGrade[r.grade] || 0) + 1;
      sumScore += r.score;
      sumVolume += r.volume;
    });
    return {
      total: total,
      byGrade: byGrade,
      avgScore: total ? Math.round(sumScore / total) : 0,
      avgVolume: total ? Math.round(sumVolume / total) : 0,
      golden: rows.filter(function (r) { return r.grade === 'S' || (r.grade === 'A' && r.score >= 70); }).length,
    };
  }

  /* ── 위험 표현 사전 ─────────────────────────────────────── */

  const BANNED_GROUPS_KO = [
    {
      id: 'hype', label: '과장·최상급', tone: 'danger',
      reason: '근거 없는 최상급은 표시광고법상 거짓·과장 광고가 될 수 있어요.',
      fix: '내 경험 범위로 낮춰 쓰기 — "제가 써 본 3개 중 가장 좋았어요"',
      words: ['최고', '최강', '최상급', '완벽', '유일무이', '유일한', '넘버원', '최저가', '무조건', '100% 보장',
        '확실 보장', '반값', '초특가', '파격', '대박', '역대급', '비교불가', '압도적', '독보적', '세상에 하나뿐'],
    },
    {
      id: 'medical', label: '의료·건강', tone: 'danger',
      reason: '식품·화장품·의료 광고에서 질병 치료·예방 효과를 표방하면 법령 위반이에요.',
      fix: '개인 사용감으로 범위를 좁히기 — "저는 써 보니 촉촉했어요"',
      words: ['완치', '치료 효과', '만병통치', '부작용 없음', '부작용 제로', '특효', '항암', '면역력 급상승',
        '다이어트 보장', '살 빠지는', '키 크는', '통증 완화 보장'],
    },
    {
      id: 'finance', label: '금융·투자', tone: 'danger',
      reason: '수익·원금 보장 표현은 금융소비자 보호 법령에서 금지하는 오인 표현이에요.',
      fix: '사실과 조건만 쓰기 — "금리는 가입 시점에 따라 달라져요"',
      words: ['원금보장', '원금 보장', '고수익', '확정수익', '확정 수익', '수익 보장', '손실 없음', '무위험',
        '주식 리딩', '급등주', '대출 보장', '금리 0%'],
    },
    {
      id: 'commerce', label: '상업·유도', tone: 'warn',
      reason: '구매 유도·연락처 나열이 본문보다 많으면 홍보성 문서로 평가될 수 있어요.',
      fix: '정보 8 : 홍보 2 비율로 줄이고, 대가성은 첫 부분에 표시',
      words: ['카톡 문의', '카카오톡 문의', '오픈채팅', '텔레그램', '구매 링크', '제휴 링크', '리딩방',
        '디엠 주세요', 'DM 주세요', '선착순 마감', '오늘만 할인', '지금 구매'],
    },
  ];


  const BANNED_GROUPS_EN = [
    {
      id: 'hype', label: 'Hype & superlatives', tone: 'danger',
      reason: 'Unsupported superlatives can count as false or exaggerated advertising.',
      fix: 'Lower it to your own experience — "best of the three I tried"',
      words: ['best in the world', 'number one', '#1', 'perfect', 'guaranteed', '100% guaranteed', 'unbeatable',
        'lowest price ever', 'miracle', 'revolutionary', 'world-class', 'flawless'],
    },
    {
      id: 'medical', label: 'Health claims', tone: 'danger',
      reason: 'Claiming to cure or prevent disease in food, cosmetics or medical ads breaks health-advertising rules.',
      fix: 'Narrow it to how it felt for you — "it felt moisturising to me"',
      words: ['cures', 'miracle cure', 'no side effects', 'detox', 'boosts immunity', 'burns fat', 'pain-free for life'],
    },
    {
      id: 'finance', label: 'Investment claims', tone: 'danger',
      reason: 'Promising returns or principal protection is a prohibited misleading claim under financial consumer law.',
      fix: 'State facts and conditions only — "rates depend on when you sign up"',
      words: ['guaranteed returns', 'risk-free profit', 'double your money', 'high-yield guaranteed', 'no risk', 'sure profit'],
    },
    {
      id: 'commerce', label: 'Sales pressure', tone: 'warn',
      reason: 'Heavy purchase pressure or contact lists can get the post judged as promotional.',
      fix: 'Aim for 8 parts information to 2 parts promotion, and disclose paid ties up front',
      words: ['dm me', 'link in bio', 'limited spots', 'today only', 'buy now', 'click the link below'],
    },
  ];

  const BANNED_GROUPS = IS_EN ? BANNED_GROUPS_EN : BANNED_GROUPS_KO;

  const BANNED_WORDS = BANNED_GROUPS.reduce(function (acc, g) {
    g.words.forEach(function (w) {
      acc.push({ word: w, group: g.id, label: g.label, tone: g.tone, reason: g.reason, fix: g.fix });
    });
    return acc;
  }, []);

  /** AI 요약체·번역체 패턴. 문장 끝 어미까지 포함해 하이라이트한다. */
  const AI_PATTERNS_KO = [
    {
      id: 'announce', label: 'AI 안내체',
      re: /(?:살펴보겠습니다|알아보겠습니다|정리해\s?보겠습니다|소개해\s?드리겠습니다|말씀드리겠습니다|확인해\s?보겠습니다|안내해\s?드리겠습니다)/g,
      suggestion: '"~봤어요"로 바로 말하기',
    },
    {
      id: 'copula', label: '번역체 서술',
      re: /(?:인\s?것입니다|라는\s?것입니다|라는\s?점입니다|된\s?것입니다|는\s?것입니다)/g,
      suggestion: '"~거예요 / ~는 거죠"로 바꾸기',
    },
    {
      id: 'possibility', label: '가능형 상투구',
      re: /(?:할\s?수\s?있습니다|될\s?수\s?있습니다|라고\s?할\s?수\s?있습니다|수\s?있습니다)/g,
      suggestion: '"~할 수 있어요 / ~인 셈이에요"',
    },
    {
      id: 'passive', label: '이중 피동',
      re: /(?:되어집니다|보여집니다|만들어집니다|나타납니다|여겨집니다)/g,
      suggestion: '"돼요 / 보여요 / 만들어요 / 나와요"',
    },
    {
      id: 'formal', label: '합니다체 어미',
      re: /(?:습니다|입니다)(?=[.!?\n]|$)/g,
      suggestion: '"~어요 / ~예요" 구어체로 끊기',
    },
    {
      id: 'vague', label: '추상 형용',
      re: /(?:다양한|다양하게|다채로운|폭넓은)/g,
      suggestion: '"여러 / 여러 가지"로 구체화',
    },
    {
      id: 'connector', label: '접속사 남용',
      re: /(?:또한|따라서|그러나|한편|더불어)(?=[,\s])/g,
      suggestion: '"그리고 / 그래서 / 근데" 또는 문장 분리',
    },
    {
      id: 'intensifier', label: '불필요한 강조',
      re: /(?:매우|상당히|정말로|극히|무척)/g,
      suggestion: '"꽤 / 진짜" 또는 삭제',
    },
    {
      id: 'about', label: '번역투 전치사',
      re: /(?:에\s?대해|에\s?관하여|에\s?대한)/g,
      suggestion: '목적어를 바로 쓰기 ("~을/를")',
    },
    {
      id: 'conclude', label: '요약 상투구',
      re: /(?:결론적으로|요약하자면|마지막으로\s?정리하면|이상으로)/g,
      suggestion: '"결론부터 말하면 / 정리하면"',
    },
    {
      id: 'hedge', label: '판단 회피',
      re: /(?:것으로\s?보입니다|판단됩니다|사료됩니다|여겨집니다)/g,
      suggestion: '"~인 것 같아요 / ~로 보여요"',
    },
    {
      id: 'emphasis', label: 'AI 강조구',
      re: /(?:시사하는\s?바가\s?큽니다|중요성을\s?강조하고\s?싶습니다|주목할\s?만합니다)/g,
      suggestion: '"여기서 중요한 건 ~예요"',
    },
  ];


  const AI_PATTERNS_EN = [
    { id: 'announce', label: 'AI announcement', re: /(?:in this (?:article|post),? we(?:'| w)ill|let'?s (?:take a look|dive in)|we(?:'| w)ill explore)/gi,
      suggestion: 'Say what you found instead — "after 3 years, here is what stuck"' },
    { id: 'copula', label: 'Importance filler', re: /(?:it is (?:important|worth) (?:to note|noting)|it'?s (?:important|worth) (?:to note|noting))/gi,
      suggestion: 'Cut it and state the fact' },
    { id: 'possibility', label: 'Possibility cliché', re: /(?:can (?:help|be a great way)|may (?:help|be)|plays? a (?:crucial|vital|key) role)/gi,
      suggestion: 'Say what actually happened for you' },
    { id: 'passive', label: 'Double passive', re: /(?:is (?:designed|crafted|engineered) to|are (?:designed|crafted) to)/gi,
      suggestion: 'Use the active voice — "it does X"' },
    { id: 'formal', label: 'Summary ending', re: /(?:in conclusion|to sum up|overall,|all in all)/gi,
      suggestion: 'End with your own take — "here is what I would do"' },
    { id: 'connector', label: 'Connector overuse', re: /\b(?:moreover|furthermore|additionally|that being said)\b/gi,
      suggestion: 'Use "and / so / but", or split the sentence' },
    { id: 'vague', label: 'Vague quantifier', re: /\b(?:various|a wide range of|numerous|a variety of)\b/gi,
      suggestion: 'Give the real count — "12 kinds"' },
    { id: 'intensifier', label: 'Needless intensifier', re: /\b(?:extremely|incredibly|truly|absolutely)\b/gi,
      suggestion: 'Cut the intensifier' },
    { id: 'buzzword', label: 'Buzzword', re: /\b(?:delve into|unlock|seamless|leverage|elevate|game-changer|look no further|robust solution)\b/gi,
      suggestion: 'Say it plainly' },
    { id: 'hedge', label: 'Hedging', re: /(?:it can be seen as|it goes without saying|needless to say)/gi,
      suggestion: 'Take a position' },
  ];

  const AI_PATTERNS = IS_EN ? AI_PATTERNS_EN : AI_PATTERNS_KO;

  const SHORT_LINK_RE = /(?:bit\.ly|me2\.do|vo\.la|han\.gl|url\.kr|buly\.kr|t\.co|is\.gd|tinyurl\.com)\/[^\s)]*/gi;
  const PHONE_RE = /(?:01[016789]|0[2-6][0-9]?)[-.\s]?\d{3,4}[-.\s]?\d{4}/g;

  function findAll(re, text, make) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push(make(m));
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  function findBanned(text) {
    const t = String(text || '');
    const hits = [];
    BANNED_WORDS.forEach(function (b) {
      const re = new RegExp(escapeReg(b.word), 'gi');
      findAll(re, t, function (m) {
        return {
          type: 'banned', group: b.group, label: b.label, tone: b.tone,
          text: m[0], index: m.index, length: m[0].length,
          reason: b.reason, suggestion: b.fix, word: b.word,
        };
      }).forEach(function (h) { hits.push(h); });
    });
    return hits;
  }

  function findLinks(text) {
    const t = String(text || '');
    const out = [];
    findAll(SHORT_LINK_RE, t, function (m) {
      return {
        type: 'link', group: 'link', label: '단축 URL', tone: 'warn',
        text: m[0], index: m.index, length: m[0].length,
        reason: '목적지가 보이지 않는 단축 URL은 홍보성 문서 신호가 될 수 있어요.',
        suggestion: '전체 주소로 바꾸거나 링크 수를 줄이기',
      };
    }).forEach(function (h) { out.push(h); });
    findAll(PHONE_RE, t, function (m) {
      return {
        type: 'contact', group: 'contact', label: '연락처', tone: 'warn',
        text: m[0], index: m.index, length: m[0].length,
        reason: '본문 연락처 노출은 개인정보·광고성 문서로 읽힐 수 있어요.',
        suggestion: '프로필이나 공지로 옮기기',
      };
    }).forEach(function (h) { out.push(h); });
    return out;
  }

  function findAiTone(text) {
    const t = String(text || '');
    const out = [];
    AI_PATTERNS.forEach(function (p) {
      const re = new RegExp(p.re.source, 'gi');
      findAll(re, t, function (m) {
        return {
          type: 'ai', group: p.id, label: p.label, tone: 'info',
          text: m[0], index: m.index, length: m[0].length,
          reason: 'AI가 쓴 글에서 자주 나오는 요약체·번역체 어미예요.',
          suggestion: p.suggestion,
        };
      }).forEach(function (h) { out.push(h); });
    });
    return out;
  }

  /** 겹치는 구간은 긴 쪽을 남기고 정리한다. */
  function mergeSpans(spans) {
    const sorted = spans.slice().sort(function (a, b) {
      return a.index - b.index || b.length - a.length;
    });
    const out = [];
    let end = -1;
    sorted.forEach(function (s) {
      if (s.index < end) return;
      out.push(s);
      end = s.index + s.length;
    });
    return out;
  }

  function detectSpans(text, opts) {
    const o = opts || {};
    let spans = findBanned(text).concat(findAiTone(text)).concat(findLinks(text));
    if (o.types) spans = spans.filter(function (s) { return o.types.indexOf(s.type) >= 0; });
    return mergeSpans(spans);
  }

  /** 복붙 반복: 20자 이상 문장이 두 번 이상 나오는 경우 */
  function repeatedSentences(text) {
    const sentences = String(text || '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return codePoints(s) >= 20; });
    const seen = {};
    const dup = [];
    sentences.forEach(function (s) {
      const key = s.replace(/\s+/g, ' ').toLowerCase();
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] === 2) dup.push(s);
    });
    return dup;
  }

  /* ── 제목 진단 ──────────────────────────────────────────── */

  const TITLE_MIN = 28;
  const TITLE_MAX = 42;

  function analyzeTitle(title, keyword) {
    const t = String(title || '').trim();
    const kw = String(keyword || '').trim();
    const len = codePoints(t);
    const noSpace = codePoints(t.replace(/\s+/g, ''));
    const matcher = keywordMatcher(kw);
    const count = kw ? matcher.count(t) : 0;
    const inFirst20 = kw ? matcher.count(t.slice(0, 20)) > 0 : false;
    const specials = (t.match(/[★☆◆◇■□▶▷◀◁♤♡@#$%^&*_+=|\\<>~`]/g) || []);
    const repeatedPunct = /[!?]{2,}|[~]{2,}/.test(t);
    const issues = [];
    let score = 0;

    if (len >= TITLE_MIN && len <= TITLE_MAX) {
      score += 8;
    } else if (len >= 20 && len < TITLE_MIN) {
      score += 5;
      issues.push({ level: 'warn', code: 'title-short', title: '제목이 조금 짧아요', detail: len + '자 — 검색 결과에서 담긴 정보가 덜 보여요.', fix: '핵심 키워드 + 구체적 조건을 붙여 ' + TITLE_MIN + '~' + TITLE_MAX + '자로.' });
    } else if (len > TITLE_MAX && len <= 55) {
      score += 5;
      issues.push({ level: 'warn', code: 'title-long', title: '제목이 길어요', detail: len + '자 — 모바일 검색 결과에서 잘려 보일 수 있어요.', fix: '수식어를 덜어내 ' + TITLE_MAX + '자 이하로.' });
    } else {
      score += 0;
      issues.push({ level: 'danger', code: 'title-extreme', title: '제목 길이가 권장 범위를 크게 벗어났어요', detail: len + '자 (권장 ' + TITLE_MIN + '~' + TITLE_MAX + '자).', fix: '제목 한 줄로 다시 쓰고, 부가 설명은 본문 도입부로.' });
    }

    if (!kw) {
      issues.push({ level: 'warn', code: 'no-keyword', title: '타겟 키워드가 비어 있어요', detail: '키워드를 넣어야 제목·본문 진단이 정확해져요.', fix: '이 글에서 노리는 검색어 1개를 정하세요.' });
    } else if (inFirst20) {
      score += 6;
    } else if (count > 0) {
      score += 3;
      issues.push({ level: 'warn', code: 'kw-back', title: '키워드가 제목 뒤쪽에 있어요', detail: '모바일에서 앞부분만 보이는 경우가 많아요.', fix: '앞 20자 안에 "' + kw + '"를 배치하세요.' });
    } else {
      issues.push({ level: 'danger', code: 'kw-missing-title', title: '제목에 타겟 키워드가 없어요', detail: '검색어와 제목의 연결이 약해집니다.', fix: '제목 앞쪽에 "' + kw + '"를 자연스럽게 넣으세요.' });
    }

    if (kw && count === 0) {
      /* 이미 위에서 감점 */
    } else if (count <= 2) {
      score += 3;
    } else if (count === 3) {
      score += 1;
      issues.push({ level: 'warn', code: 'kw-repeat-title', title: '제목에 키워드가 3번 나와요', detail: '검색어 반복은 어뷰징 신호로 읽힐 수 있어요.', fix: '한 번만 남기고 나머지는 동의어로.' });
    } else {
      issues.push({ level: 'danger', code: 'kw-spam-title', title: '제목 키워드 반복이 과해요', detail: count + '회 — 네이버는 검색어 인위적 반복을 스팸 유형으로 안내해요.', fix: '키워드는 1~2회만.' });
    }

    if (!specials.length && !repeatedPunct) {
      score += 3;
    } else {
      score += 1;
      issues.push({
        level: 'warn', code: 'title-symbol', title: '특수문자·반복 부호가 있어요',
        detail: (specials.join(' ') || '!!') + ' — 네이버는 의미 없는 특수문자를 어뷰징으로 봐요.',
        fix: '부호를 빼고 내용으로 눈길을 끄세요.',
      });
    }

    return {
      length: len,
      noSpaceLength: noSpace,
      keywordCount: count,
      inFirst20: inFirst20,
      specials: specials,
      score: clamp(score, 0, 20),
      max: 20,
      issues: issues,
      recommended: len >= TITLE_MIN && len <= TITLE_MAX,
    };
  }

  /* ── 본문 진단 ──────────────────────────────────────────── */

  function splitParagraphs(body) {
    const text = String(body || '').trim();
    if (!text) return [];
    let blocks = text.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (blocks.length <= 1) blocks = text.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    return blocks;
  }

  function countHeadings(body) {
    let n = 0;
    String(body || '').split(/\n/).forEach(function (line) {
      const l = line.trim();
      if (!l) return;
      if (/^#{1,4}\s+\S/.test(l)) { n++; return; }
      if (l.length <= 34 && !/[.!?]$/.test(l) && /^(?:#{1,3}\s|[■▶◆◇□▪◦]|[①-⑳]|[가-힣A-Za-z0-9 ]{2,20}\s*[:：])/.test(l)) n++;
      else if (/^\d+[.)]\s*\S/.test(l) && l.length <= 26 && !/다\.$|요\.$/.test(l)) n++;
    });
    return n;
  }

  function countListItems(body) {
    let n = 0;
    String(body || '').split(/\n/).forEach(function (line) {
      if (/^\s*(?:[-*•✅☑✔]|\d+[.)])\s+\S/.test(line)) n++;
    });
    return n;
  }

  function hasTable(body) {
    const lines = String(body || '').split(/\n/);
    let pipeLines = 0;
    let hasSeparator = false;
    lines.forEach(function (line) {
      const pipes = (line.match(/\|/g) || []).length;
      if (pipes >= 2) pipeLines++;
      if (/^\s*\|?[\s:-]*-{2,}[\s:|-]*\|/.test(line)) hasSeparator = true;
    });
    return pipeLines >= 3 && (hasSeparator || pipeLines >= 4);
  }

  function analyzeBody(body, keyword) {
    const text = String(body || '');
    const chars = codePoints(text);
    const charsNoSpace = codePoints(text.replace(/\s+/g, ''));
    const paragraphs = splitParagraphs(text);
    const matcher = keywordMatcher(keyword);
    const kwDetail = keyword ? matcher.detail(text) : { exact: 0, embedded: 0, withJosa: 0, positions: [], embeddedWords: [] };
    const keywordCount = num(kwDetail.exact);
    const embeddedCount = num(kwDetail.embedded);
    const josaCount = num(kwDetail.withJosa);
    const kwLen = codePoints(String(keyword || '').replace(/\s+/g, ''));
    const density = charsNoSpace ? Math.round((keywordCount * kwLen / charsNoSpace) * 1000) / 10 : 0;
    const words = KT && typeof KT.tokens === 'function' ? KT.tokens(text).length : 0;
    const densityByWord = words && keyword ? Math.round((keywordCount / words) * 1000) / 10 : 0;
    const headings = countHeadings(text);
    const lists = countListItems(text);
    const table = hasTable(text);
    const lengths = paragraphs.map(function (p) { return codePoints(p); });
    const longWalls = lengths.filter(function (n) { return n > 300; }).length;
    const longest = lengths.length ? Math.max.apply(null, lengths) : 0;
    const avgParagraph = lengths.length ? Math.round(lengths.reduce(function (a, b) { return a + b; }, 0) / lengths.length) : 0;
    const dupSentences = repeatedSentences(text);
    const banned = findBanned(text);
    const ai = findAiTone(text);
    const links = findLinks(text);
    const issues = [];

    /* 분량 20 */
    let lengthScore;
    if (charsNoSpace >= 2000) lengthScore = 12;
    else if (charsNoSpace >= 1500) { lengthScore = 9; issues.push({ level: 'warn', code: 'len', title: '분량이 조금 부족해요', detail: charsNoSpace + '자(공백 제외) — 2,000자 이상을 권장해요.', fix: '경험·수치·비교 항목을 한 단락씩 보강하세요.' }); }
    else if (charsNoSpace >= 1000) { lengthScore = 6; issues.push({ level: 'warn', code: 'len', title: '분량이 부족해요', detail: charsNoSpace + '자(공백 제외) — 정보성 글은 2,000자 이상이 안전해요.', fix: '소제목 5개로 나누고 각 2~3문단씩 채우세요.' }); }
    else if (charsNoSpace >= 600) { lengthScore = 3; issues.push({ level: 'danger', code: 'len', title: '글이 너무 짧아요', detail: charsNoSpace + '자 — 검색 결과에서 얻을 정보가 부족해 보여요.', fix: '2,000자 목표로 다시 구성하세요.' }); }
    else { lengthScore = 0; issues.push({ level: 'danger', code: 'len', title: '본문이 거의 비어 있어요', detail: charsNoSpace + '자.', fix: '소제목 뼈대부터 잡고 채우세요.' }); }

    let paraScore;
    if (paragraphs.length >= 6) paraScore = 4;
    else if (paragraphs.length >= 3) { paraScore = 2; issues.push({ level: 'warn', code: 'para', title: '문단이 적어요', detail: paragraphs.length + '개 — 소제목마다 2~3문단으로 나누면 읽기 쉬워져요.', fix: '문단 6개 이상으로 쪼개세요.' }); }
    else { paraScore = 0; }

    let wallScore;
    if (longWalls === 0) wallScore = 4;
    else if (longWalls <= 2) { wallScore = 2; issues.push({ level: 'warn', code: 'wall', title: '장문 벽이 있어요', detail: '300자를 넘는 문단 ' + longWalls + '개 (가장 긴 문단 ' + longest + '자).', fix: '3줄(약 200자)마다 문단을 끊으세요.' }); }
    else { wallScore = 0; issues.push({ level: 'danger', code: 'wall', title: '긴 문단이 많아 이탈 위험이 커요', detail: '300자 초과 문단 ' + longWalls + '개.', fix: '한 문단 = 한 생각. 2~3문장마다 줄바꿈.' }); }

    const lengthPart = lengthScore + paraScore + wallScore; // max 20

    /* 키워드 15 */
    let kwScore;
    if (!keyword) {
      kwScore = 0;
      issues.push({ level: 'warn', code: 'no-keyword-body', title: '타겟 키워드가 없어 반복 수를 셀 수 없어요', detail: '키워드 1개를 정하면 4~8회 적정 구간을 계산해 드려요.', fix: '위쪽 타겟 키워드 칸을 채우세요.' });
    } else if (keywordCount >= 4 && keywordCount <= 8) kwScore = 15;
    else if (keywordCount === 9) { kwScore = 11; issues.push({ level: 'warn', code: 'kw-many', title: '키워드가 9회 나와요', detail: '적정은 4~8회예요. 10회부터는 어뷰징으로 읽힐 수 있어요.', fix: '2회 정도를 동의어·대명사로 바꾸세요.' }); }
    else if (keywordCount >= 10) { kwScore = keywordCount >= 13 ? 2 : 6; issues.push({ level: 'danger', code: 'kw-spam', title: '키워드 반복이 과해요', detail: keywordCount + '회 — 네이버는 동일 키워드 의도적 반복을 스팸 유형으로 안내해요.', fix: '4~8회로 줄이고, 나머지는 문맥으로 설명하세요.' }); }
    else if (keywordCount >= 2) { kwScore = 11; issues.push({ level: 'warn', code: 'kw-few', title: '키워드 노출이 적어요', detail: keywordCount + '회 — 검색어와 글의 연결이 약해요.', fix: '도입부·소제목·마무리에 자연스럽게 2~4회 더.' }); }
    else if (keywordCount === 1) { kwScore = 6; issues.push({ level: 'warn', code: 'kw-few', title: '키워드가 1회만 나와요', detail: '본문에서 주제가 드러나지 않아요.', fix: '소제목 2~3개에 키워드를 포함하세요.' }); }
    else { kwScore = 0; issues.push({ level: 'danger', code: 'kw-zero', title: '본문에 키워드가 없어요', detail: '제목과 본문이 다른 주제로 읽힐 수 있어요.', fix: '첫 문단과 소제목에 키워드를 넣으세요.' }); }

    if (density > 3) {
      issues.push({ level: 'warn', code: 'density', title: '키워드 밀도가 높아요', detail: density + '% — 3%를 넘으면 도배로 보일 수 있어요.', fix: '반복을 줄이고 구체적 사례를 늘리세요.' });
      kwScore = Math.max(2, kwScore - 4);
    }

    /* 어절 기준 정밀 집계(한국어 엔진이 있을 때만) */
    if (KT && keyword && embeddedCount > 0) {
      issues.push({
        level: 'info', code: 'kw-compound',
        title: '더 긴 단어 안에 들어간 키워드 ' + embeddedCount + '곳',
        detail: (kwDetail.embeddedWords || []).slice(0, 3).join(', ') + (embeddedCount > 3 ? ' 외' : '') + ' — 반복 수에는 넣지 않았어요.',
        fix: '복합어로만 쓰고 있다면, 키워드를 단독으로 한 번은 써 주세요.',
      });
    }

    /* 구조 20 */
    let structScore = 0;
    if (headings >= 3) structScore += 7;
    else { issues.push({ level: headings === 0 ? 'danger' : 'warn', code: 'heading', title: headings ? '소제목이 ' + headings + '개예요' : '소제목이 없어요', detail: 'H2 소제목 3개 이상이면 구조가 잡혀요.', fix: '"## 소제목" 또는 "1. 소제목" 형태로 5개를 만드세요.' }); }
    if (lists >= 3) structScore += 4;
    else { issues.push({ level: 'warn', code: 'list', title: '리스트가 부족해요', detail: '불릿·번호 목록 ' + lists + '개.', fix: '준비물·주의사항을 3줄 목록으로.' }); }
    if (table) structScore += 4;
    else { issues.push({ level: 'warn', code: 'table', title: '비교표가 없어요', detail: '표는 체류시간과 정보 밀도를 함께 올려요.', fix: '"| 항목 | A | B |" 형태의 4행 표를 넣으세요.' }); }
    if (longWalls === 0) structScore += 5;

    /* 위험 표현 15 */
    const linkHits = links.filter(function (h) { return h.type === 'link'; }).length;
    const contactHits = links.filter(function (h) { return h.type === 'contact'; }).length;
    let riskScore = 15 - banned.length * 4 - linkHits * 3 - contactHits * 3 - dupSentences.length * 3;
    riskScore = clamp(riskScore, 0, 15);
    if (banned.length) {
      const names = Array.from(new Set(banned.map(function (b) { return b.word; }))).slice(0, 4).join(', ');
      issues.push({ level: 'danger', code: 'banned', title: '위험 표현 ' + banned.length + '건', detail: names + (banned.length > 4 ? ' 외' : ''), fix: '근거 없는 보장·최상급을 경험 범위 표현으로 바꾸세요.' });
    }
    if (linkHits) issues.push({ level: 'warn', code: 'shortlink', title: '단축 URL ' + linkHits + '건', detail: '목적지가 보이지 않는 링크예요.', fix: '전체 주소로 바꾸거나 삭제.' });
    if (contactHits) issues.push({ level: 'warn', code: 'contact', title: '연락처가 본문에 있어요', detail: '개인정보 노출로 읽힐 수 있어요.', fix: '프로필·공지로 옮기기.' });
    if (dupSentences.length) issues.push({ level: 'warn', code: 'dup', title: '같은 문장이 반복돼요', detail: '"' + dupSentences[0].slice(0, 26) + '…" 외 ' + (dupSentences.length - 1) + '건', fix: '복붙 문단을 지우고 다른 근거로 바꾸세요.' });

    /* AI 번역체 10 */
    const per1000 = charsNoSpace ? (ai.length / (charsNoSpace / 1000)) : 0;
    let aiScore;
    if (ai.length === 0) aiScore = 10;
    else if (per1000 <= 2) aiScore = 8;
    else if (per1000 <= 4) aiScore = 6;
    else if (per1000 <= 7) aiScore = 4;
    else aiScore = 2;
    if (ai.length) {
      issues.push({
        level: per1000 <= 4 ? 'warn' : 'danger', code: 'ai-tone',
        title: 'AI 번역체·요약체 ' + ai.length + '곳',
        detail: '1,000자당 ' + (Math.round(per1000 * 10) / 10) + '회 — "' + ai[0].text + '" 같은 어미가 반복돼요.',
        fix: '아래 제안대로 "~어요 / ~예요"로 바꾸면 사람이 쓴 느낌이 살아요.',
      });
    }

    if (!issues.length) {
      issues.push({ level: 'good', code: 'clean', title: '감점 항목이 없어요', detail: '제목·분량·구조·표현이 모두 권장 범위예요.', fix: '이 상태로 발행하고 24시간 뒤 노출을 확인하세요.' });
    }

    return {
      chars: chars,
      charsNoSpace: charsNoSpace,
      paragraphs: paragraphs.length,
      sentences: (text.match(/[.!?](\s|$)/g) || []).length,
      keywordCount: keywordCount,
      embeddedCount: embeddedCount,
      josaCount: josaCount,
      embeddedWords: kwDetail.embeddedWords || [],
      words: words,
      density: density,
      densityByWord: densityByWord,
      headings: headings,
      lists: lists,
      hasTable: table,
      longWalls: longWalls,
      longestParagraph: longest,
      avgParagraph: avgParagraph,
      bannedCount: banned.length,
      aiCount: ai.length,
      linkCount: linkHits,
      contactCount: contactHits,
      duplicateSentences: dupSentences.length,
      bannedHits: banned,
      aiHits: ai,
      issues: issues,
      parts: { length: lengthPart, keyword: kwScore, structure: structScore, risk: riskScore, ai: aiScore },
    };
  }

  /* ── 종합 점수 ──────────────────────────────────────────── */

  function scorePost(input) {
    const keyword = String((input && input.keyword) || '').trim();
    const title = String((input && input.title) || '');
    const body = String((input && input.body) || '');
    const t = analyzeTitle(title, keyword);
    const b = analyzeBody(body, keyword);
    const parts = [
      { id: 'title', label: '제목', score: t.score, max: 20, hint: t.length + '자 · 키워드 ' + t.keywordCount + '회' },
      { id: 'length', label: '본문 분량·문단', score: b.parts.length, max: 20, hint: b.charsNoSpace.toLocaleString('ko-KR') + '자 · 문단 ' + b.paragraphs + '개' },
      { id: 'keyword', label: '키워드 반복', score: b.parts.keyword, max: 15, hint: b.keywordCount + '회 · 밀도 ' + b.density + '%' },
      { id: 'structure', label: '구조·가독성', score: b.parts.structure, max: 20, hint: '소제목 ' + b.headings + ' · 리스트 ' + b.lists + ' · 표 ' + (b.hasTable ? '있음' : '없음') },
      { id: 'risk', label: '위험 표현', score: b.parts.risk, max: 15, hint: '위험 ' + b.bannedCount + ' · 단축URL ' + b.linkCount },
      { id: 'ai', label: 'AI 번역체', score: b.parts.ai, max: 10, hint: b.aiCount + '곳' },
    ];
    const total = clamp(parts.reduce(function (a, p) { return a + p.score; }, 0), 0, 100);
    let grade, gradeLabel, gradeTone;
    if (total >= 90) { grade = 'S'; gradeLabel = '발행 준비 완료'; gradeTone = 's'; }
    else if (total >= 75) { grade = 'A'; gradeLabel = '좋아요, 조금만 다듬기'; gradeTone = 'a'; }
    else if (total >= 60) { grade = 'B'; gradeLabel = '보완 필요'; gradeTone = 'b'; }
    else { grade = 'C'; gradeLabel = '발행 전 손보세요'; gradeTone = 'c'; }

    const issues = t.issues.concat(b.issues).sort(function (x, y) {
      const rank = { danger: 0, warn: 1, good: 2 };
      return rank[x.level] - rank[y.level];
    });

    return {
      total: total,
      grade: grade,
      gradeLabel: gradeLabel,
      gradeTone: gradeTone,
      parts: parts,
      issues: issues,
      title: t,
      body: b,
      metrics: {
        titleLength: t.length,
        chars: b.chars,
        charsNoSpace: b.charsNoSpace,
        paragraphs: b.paragraphs,
        keywordCount: b.keywordCount,
        embeddedCount: b.embeddedCount,
        josaCount: b.josaCount,
        embeddedWords: b.embeddedWords,
        words: b.words,
        density: b.density,
        densityByWord: b.densityByWord,
        headings: b.headings,
        lists: b.lists,
        table: b.hasTable,
        bannedCount: b.bannedCount,
        aiCount: b.aiCount,
      },
      suggestions: buildFixes(t, b),
    };
  }

  function buildFixes(t, b) {
    const out = [];
    if (t.length < TITLE_MIN) out.push('제목에 조건·숫자를 붙여 ' + TITLE_MIN + '~' + TITLE_MAX + '자로 늘리기');
    if (t.length > TITLE_MAX) out.push('제목 수식어를 덜어 ' + TITLE_MAX + '자 이하로');
    if (!t.inFirst20) out.push('제목 앞 20자에 타겟 키워드 배치');
    if (b.charsNoSpace < 2000) out.push('공백 제외 2,000자까지 ' + (2000 - b.charsNoSpace).toLocaleString('ko-KR') + '자 보강');
    if (b.headings < 3) out.push('H2 소제목 3개 이상 만들기');
    if (!b.hasTable) out.push('비교표 1개 추가');
    if (b.lists < 3) out.push('체크리스트·준비물을 3줄 목록으로');
    if (b.keywordCount < 4) out.push('키워드를 본문에 ' + (4 - b.keywordCount) + '회 더 자연스럽게');
    if (b.keywordCount > 8) out.push('키워드 반복을 ' + (b.keywordCount - 8) + '회 줄이기');
    if (b.bannedCount) out.push('위험 표현 ' + b.bannedCount + '건을 경험 범위 표현으로');
    if (b.aiCount) out.push('AI 번역체 ' + b.aiCount + '곳을 "~어요"체로');
    if (!out.length) out.push('지금 구성 그대로 발행하고, 24시간 뒤 노출을 확인하세요.');
    return out;
  }

  /* ── 아웃라인·프롬프트 빌더 ─────────────────────────────── */

  function toneMeta(id) {
    return TONES.find(function (t) { return t.id === id; }) || TONES[0];
  }

  function titleCandidates(topic, keyword, audience) {
    const kw = String(keyword || topic || '이 주제').trim();
    const who = String(audience || '처음 시작하는 분').trim();
    if (IS_EN) {
      const k2 = String(keyword || topic || 'this topic').trim();
      const w2 = String(audience || 'first-time readers').trim();
      const en = [
        ['Numeric list', '3 things to check first: ' + k2],
        ['Question', k2 + ' — how should ' + w2 + ' choose?'],
        ['Comparison', k2 + ': A vs B after two weeks'],
        ['Experience', 'What I changed after trying ' + k2],
        ['Loss aversion', 'What ' + k2 + ' costs you if you skip it'],
      ];
      return en.map(function (pair) {
        const len = codePoints(pair[1]);
        return { formula: pair[0], text: pair[1], length: len, ok: len >= TITLE_MIN && len <= TITLE_MAX };
      });
    }
    const raw = [
      ['숫자·목록형', kw + ' 3가지, ' + who + '가 먼저 확인할 것'],
      ['질문형', kw + ', ' + who + '는 어떻게 고를까'],
      ['비교형', kw + ' A vs B — 2주 써보고 남은 결론'],
      ['경험·과정형', kw + ' 해보고 바꾼 것 3가지'],
      ['손실회피형', kw + ' 놓치면 손해 보는 이유'],
    ];
    return raw.map(function (pair) {
      const len = codePoints(pair[1]);
      return { formula: pair[0], text: pair[1], length: len, ok: len >= TITLE_MIN && len <= TITLE_MAX };
    });
  }

  function buildOutline(options) {
    if (IS_EN) return buildOutlineEN(options);
    const o = options || {};
    const topic = String(o.topic || o.keyword || '').trim();
    const keyword = String(o.keyword || o.topic || '').trim();
    const audience = String(o.audience || '처음 알아보는 분').trim();
    const tone = toneMeta(o.tone).id;
    const goal = Math.max(800, Math.round(Number(o.goalChars) || 2200));
    const include = Object.assign({ table: true, checklist: true, faq: true, price: true, caution: true }, o.include || {});
    const kw = keyword || '이 주제';

    const skeletons = {
      casual: [
        { title: kw + ' 때문에 고민이면, 결론부터 말할게요', points: [audience + '가 실제로 겪는 상황 1문장', '이 글에서 얻을 결론을 먼저', '왜 이걸 직접 확인했는지 한 줄'] },
        { title: audience + '가 가장 많이 하는 실수 3가지', points: ['실수 1 + 그때 생긴 일', '실수 2 + 바로 고친 방법', '실수 3은 짧게, 대신 기준 제시'] },
        { title: '제가 해본 순서 — ' + topic + ' 3단계', points: ['준비물·조건', '실제 순서와 걸린 시간', '중간에 막혔던 지점과 해결'] },
        { title: kw + ' 비교표: A vs B', points: ['무엇을 비교했는지 기준 먼저', '표 아래에 내 선택과 이유', '돈·시간이 얼마나 차이 나는지'] },
        { title: '자주 묻는 질문 3개 (+ 마무리)', points: ['검색에서 많이 나오는 질문 2개', '내 상황 기준 답', '댓글 질문 1개로 끝내기'] },
      ],
      expert: [
        { title: kw + ', 무엇부터 확인해야 할까', points: ['판단 기준 3개를 먼저 제시', '기준별로 왜 중요한지 근거', '이 글의 범위와 전제'] },
        { title: '핵심 기준 1 — ' + audience + '가 놓치는 부분', points: ['흔한 오해와 실제', '확인 방법(수치·공식 자료)', '예외 상황'] },
        { title: '핵심 기준 2 — 비용과 대안 비교', points: ['대안 A·B의 조건', '장단점을 같은 기준으로', '선택 매트릭스'] },
        { title: kw + ' 실행 체크리스트', points: ['순서대로 할 일 5개', '각 단계 소요 시간', '실패 신호와 대응'] },
        { title: '정리 — 어떤 경우에 추천하나', points: ['추천 대상 / 비추천 대상', '남는 리스크', '추가로 볼 자료'] },
      ],
      review: [
        { title: '2주 써보고 남은 결론: ' + kw, points: ['사게 된 계기와 조건', '첫인상 1문장', '결론 먼저'] },
        { title: '사기 전에 봤던 스펙 vs 실제 체감', points: ['스펙에서 기대한 것', '실제로 달랐던 점', '사진·수치로 보여주기'] },
        { title: '좋았던 점 3, 아쉬웠던 점 2', points: ['좋았던 점은 상황과 함께', '아쉬운 점은 숨기지 않기', '누구에게는 괜찮은지'] },
        { title: kw + ' 대안 비교표', points: ['가격·소모품·AS 비교', '내가 다시 고른다면', '중고·대안 옵션'] },
        { title: '이런 사람에게 추천 (+ 총평)', points: ['추천 대상 2가지', '비추천 대상 1가지', '댓글로 상황 물어보기'] },
      ],
    };

    const ratio = [0.15, 0.25, 0.25, 0.2, 0.15];
    const h2 = skeletons[tone].map(function (s, i) {
      return {
        index: i + 1,
        title: s.title,
        points: s.points.slice(),
        targetChars: Math.round(goal * ratio[i] / 10) * 10,
      };
    });

    if (!include.faq) h2[4].points[0] = '검색에서 많이 나오는 질문 대신 핵심 요약';
    if (!include.price) h2[3].points[2] = '시간·노력이 얼마나 차이 나는지';

    const checklist = [
      '제목 ' + TITLE_MIN + '~' + TITLE_MAX + '자, 앞 20자에 "' + kw + '"',
      '공백 제외 ' + goal.toLocaleString('ko-KR') + '자 이상',
      '"' + kw + '"를 본문에 4~8회, 문장 안에서 자연스럽게',
      'H2 소제목 5개, 한 문단 3줄(200자) 이내',
      include.table ? '비교표 1개 — 항목·A안·B안·내 선택' : '핵심을 3줄 요약 박스로',
      include.caution ? '주의사항·단점 1개 이상 (신뢰도에 도움)' : '내 경험에서 걸린 시간·비용 수치',
      '단축 URL·전화번호·근거 없는 최상급 표현 제거',
      include.checklist ? '발행 전 체크리스트로 셀프 점검' : '마지막 문단에 댓글 질문 1개',
    ];

    const table = {
      caption: kw + ' 비교표 (발행 전 채우기)',
      columns: ['항목', 'A안', 'B안', '내 선택'],
      rows: [
        ['가격·비용', '', '', ''],
        ['준비·사용 난이도', '', '', ''],
        ['장점', '', '', ''],
        ['단점·주의', '', '', ''],
        ['추천 대상', '', '', ''],
      ],
    };

    const questions = [
      kw + ' 하면서 제일 헷갈렸던 건 뭐였나요?',
      audience + '라면 A안과 B안 중 어느 쪽을 고르시겠어요?',
      '제가 놓친 방법이 있으면 댓글로 알려주세요. 다음 글에 반영할게요.',
    ];

    const tags = tagSet(kw, topic, audience);
    const titles = titleCandidates(topic, keyword, audience);

    return {
      topic: topic,
      keyword: kw,
      audience: audience,
      tone: tone,
      toneLabel: toneMeta(tone).label,
      goalChars: goal,
      include: include,
      h2: h2,
      checklist: checklist,
      table: table,
      questions: questions,
      tags: tags,
      titles: titles,
    };
  }

  function buildOutlineEN(options) {
    const o = options || {};
    const topic = String(o.topic || o.keyword || '').trim();
    const keyword = String(o.keyword || o.topic || '').trim();
    const audience = String(o.audience || 'first-time readers').trim();
    const tone = toneMeta(o.tone).id;
    const goal = Math.max(800, Math.round(Number(o.goalChars) || 2200));
    const include = Object.assign({ table: true, checklist: true, faq: true, price: true, caution: true }, o.include || {});
    const kw = keyword || 'this topic';

    const skeletons = {
      casual: [
        { title: 'If ' + kw + ' is the problem, here is the answer first', points: ['One line on what ' + audience + ' actually face', 'The conclusion up front', 'Why I checked this myself'] },
        { title: 'The 3 mistakes ' + audience + ' make most', points: ['Mistake 1 and what it cost', 'Mistake 2 and the fix', 'Mistake 3, short, with the rule of thumb'] },
        { title: 'The order I did it in — ' + topic + ' in 3 steps', points: ['What you need', 'The real order and how long it took', 'Where I got stuck and how I got out'] },
        { title: kw + ' compared: A vs B', points: ['The criteria first', 'My pick and why, under the table', 'How much money and time differ'] },
        { title: '3 questions I get (+ closing)', points: ['2 questions that show up in search', 'Answers for my situation', 'Close with one question for comments'] },
      ],
      expert: [
        { title: kw + ': what to check first', points: ['The three criteria up front', 'Why each one matters', 'Scope and assumptions of this post'] },
        { title: 'Criterion 1 — what ' + audience + ' miss', points: ['The common belief vs reality', 'How to verify (numbers, official data)', 'Exceptions'] },
        { title: 'Criterion 2 — cost and alternatives', points: ['Terms of option A and B', 'Pros and cons on the same scale', 'A selection matrix'] },
        { title: kw + ' action checklist', points: ['5 tasks in order', 'Time per step', 'Failure signals and responses'] },
        { title: 'Wrap-up — when this is worth it', points: ['Who it suits / who it does not', 'Remaining risk', 'Further reading'] },
      ],
      review: [
        { title: 'Two weeks in: my verdict on ' + kw, points: ['Why I bought it and on what terms', 'First impression in one line', 'The verdict first'] },
        { title: 'Spec sheet vs what it felt like', points: ['What the specs promised', 'Where reality differed', 'Show it with photos and numbers'] },
        { title: '3 things I liked, 2 I did not', points: ['Likes with the situation', 'Do not hide the dislikes', 'Who would still be fine with it'] },
        { title: kw + ' alternatives table', points: ['Price, consumables, support', 'What I would pick again', 'Used and alternative options'] },
        { title: 'Who this is for (+ overall)', points: ['2 good fits', '1 bad fit', 'Ask readers about their case'] },
      ],
    };

    const ratio = [0.15, 0.25, 0.25, 0.2, 0.15];
    const h2 = skeletons[tone].map(function (s, i) {
      return {
        index: i + 1,
        title: s.title,
        points: s.points.slice(),
        targetChars: Math.round(goal * ratio[i] / 10) * 10,
      };
    });

    if (!include.faq) h2[4].points[0] = 'A short summary instead of common questions';
    if (!include.price) h2[3].points[2] = 'How much time and effort differ';

    const checklist = [
      'Title ' + TITLE_MIN + '–' + TITLE_MAX + ' characters, keyword within the first 20',
      goal.toLocaleString('en-US') + ' characters or more (no spaces)',
      'Use "' + kw + '" 4–8 times, naturally inside sentences',
      '5 H2 subheads, no paragraph over 3 lines (about 200 characters)',
      include.table ? 'One comparison table — item, A, B, my pick' : 'A 3-line summary box instead',
      include.caution ? 'At least one caution or downside (it builds trust)' : 'The time and cost numbers from your own run',
      'No short links, phone numbers or unsupported superlatives',
      include.checklist ? 'Run the pre-publish checklist on yourself' : 'One question for comments at the end',
    ];

    const table = {
      caption: kw + ' comparison (fill before publishing)',
      columns: ['Item', 'Option A', 'Option B', 'My pick'],
      rows: [['Price', '', '', ''], ['Setup and use', '', '', ''], ['Pros', '', '', ''], ['Cons and cautions', '', '', ''], ['Best for', '', '', '']],
    };

    const questions = [
      'What confused you most about ' + kw + '?',
      'If you are ' + audience + ', which would you pick, A or B?',
      'Tell me a method I missed and I will add it to the next post.',
    ];

    return {
      topic: topic,
      keyword: kw,
      audience: audience,
      tone: tone,
      toneLabel: toneMeta(tone).label,
      goalChars: goal,
      include: include,
      h2: h2,
      checklist: checklist,
      table: table,
      questions: questions,
      tags: tagSet(kw, topic, audience),
      titles: titleCandidates(topic, keyword, audience),
    };
  }


  function buildPromptEN(outline) {
    const lines = [];
    lines.push('You are a working writer who gets Korean Naver blog posts into the top results.');
    lines.push('Follow the conditions below exactly and write a post that can be published as is.');
    lines.push('');
    lines.push('[Topic] ' + (outline.topic || '(no topic yet)'));
    lines.push('[Target keyword] ' + outline.keyword);
    lines.push('[Reader] ' + outline.audience);
    const toneEn = { casual: 'Casual', expert: 'Expert', review: 'Hands-on review' }[outline.tone] || 'Casual';
    lines.push('[Tone] ' + toneEn + ' — the way someone who actually did it would talk, in short sentences.');
    lines.push('[Length] ' + outline.goalChars.toLocaleString('en-US') + ' characters or more (excluding spaces)');
    lines.push('');
    lines.push('[Structure] Use these 5 H2s exactly, with 2–3 paragraphs under each');
    outline.h2.forEach(function (s) {
      lines.push('H2 ' + s.index + '. ' + s.title + '  (about ' + s.targetChars + ' characters)');
    });
    lines.push('');
    lines.push('[Required]');
    lines.push('- Put the conclusion or the key number in the first three sentences.');
    lines.push('- Use "' + outline.keyword + '" once in the first 20 characters of the title, then 4–8 times in the body, naturally.');
    lines.push('- No paragraph longer than 3 lines (about 200 characters). Every subhead gets a list or a table.');
    if (outline.include.table) lines.push('- One comparison table (markdown: item, option A, option B, my pick).');
    if (outline.include.checklist) lines.push('- A 5-item pre-publish checklist.');
    lines.push('- End with one question for comments and 10 tags.');
    lines.push('- Do not invent facts. Use only numbers and experiences you can verify.');
    lines.push('');
    lines.push('[Avoid]');
    lines.push('- AI summary phrasing such as "Let us take a look", "It is important to note", "In conclusion".');
    lines.push('- Unsupported superlatives (best, number one, perfect) and health or finance guarantees.');
    lines.push('- Short links, phone numbers, account numbers, pasted duplicate sentences.');
    lines.push('- A title or first paragraph that promises something the post does not deliver.');
    lines.push('');
    lines.push('[Output] One title → body with subheads → 10 tags. No preamble or sign-off, just the draft.');
    return lines.join('\n');
  }

  function tagSet(keyword, topic, audience) {
    const kw = String(keyword || '').trim();
    const out = [];
    const push = function (v) {
      const s = String(v || '').trim().replace(/^#/, '');
      if (s && out.indexOf(s) === -1 && out.length < 10) out.push(s);
    };
    push(kw);
    push(kw.replace(/\s+/g, ''));
    if (IS_EN) {
      ['tips', 'review', 'how to', 'comparison', 'guide', 'checklist'].forEach(function (s) { if (kw) push(kw + ' ' + s); });
      push(audience);
      push(String(topic || '').split(/\s+/)[0]);
      ['beginner', 'guide', 'notes', 'daily'].forEach(push);
      return out.slice(0, 10);
    }
    ['추천', '후기', '방법', '비교', '정리', '꿀팁'].forEach(function (s) { if (kw) push(kw + ' ' + s); });
    push(audience);
    push(String(topic || '').split(/\s+/)[0]);
    ['초보', '정보', '기록', '일상'].forEach(push);
    return out.slice(0, 10);
  }

  function buildPrompt(options) {
    const o = options || {};
    const outline = buildOutline(o);
    if (IS_EN) return buildPromptEN(outline);
    const lines = [];
    lines.push('너는 한국 네이버 블로그에서 상위노출되는 원고를 쓰는 실무 작가다.');
    lines.push('아래 조건을 그대로 지켜서 바로 발행 가능한 원고를 써라.');
    lines.push('');
    lines.push('[주제] ' + (outline.topic || '(주제 미입력)'));
    lines.push('[타겟 키워드] ' + outline.keyword);
    lines.push('[독자] ' + outline.audience);
    lines.push('[톤] ' + outline.toneLabel + ' — 실제로 겪은 사람이 말하듯, 짧은 문장으로.');
    lines.push('[분량] 공백 제외 ' + outline.goalChars.toLocaleString('ko-KR') + '자 이상');
    lines.push('');
    lines.push('[구조] 아래 H2 5개를 그대로 사용하고, 각 소제목 아래 문단 2~3개');
    outline.h2.forEach(function (s) {
      lines.push('H2 ' + s.index + '. ' + s.title + '  (약 ' + s.targetChars + '자)');
    });
    lines.push('');
    lines.push('[필수]');
    lines.push('- 첫 3문장 안에 결론 또는 핵심 수치를 먼저 쓴다.');
    lines.push('- "' + outline.keyword + '"를 제목 앞 20자에 1회, 본문에 4~8회 자연스럽게.');
    lines.push('- 한 문단은 3줄(약 200자) 이내. 소제목마다 리스트나 표 중 하나.');
    if (outline.include.table) lines.push('- 비교표 1개(마크다운, 항목·A안·B안·내 선택).');
    if (outline.include.checklist) lines.push('- 발행 전 체크리스트 5개.');
    lines.push('- 마지막에 댓글 유도 질문 1개와 태그 10개.');
    lines.push('- 없는 사실을 만들지 말고, 확인한 수치·경험만 쓴다.');
    lines.push('');
    lines.push('[금지]');
    lines.push('- "살펴보겠습니다 / ~인 것입니다 / ~할 수 있습니다 / 결론적으로" 같은 AI 요약체·번역체.');
    lines.push('- 근거 없는 최상급(최고·1위·완벽), 의료·금융 보장 표현(완치·원금보장·수익 보장).');
    lines.push('- 단축 URL, 전화번호, 계좌번호, 같은 문장 복붙.');
    lines.push('- 제목·첫 문단에서 내용과 다른 낚시.');
    lines.push('');
    lines.push('[출력 형식]');
    lines.push('제목 1개 → 본문(소제목 포함) → 태그 10개. 설명이나 인사말 없이 원고만 출력.');
    return lines.join('\n');
  }

  /* ── 표 파싱·내보내기 ───────────────────────────────────── */

  function detectDelimiter(lines) {
    const sample = lines.filter(function (l) { return l.trim(); }).slice(0, 5);
    const has = function (ch) { return sample.some(function (l) { return l.indexOf(ch) >= 0; }); };
    if (has('\t')) return '\t';
    if (has(',')) return ',';
    if (has(';')) return ';';
    return null;
  }

  function splitCells(line, delim) {
    if (delim) {
      return line.split(delim).map(function (c) { return c.trim().replace(/^"|"$/g, ''); });
    }
    return line.trim().split(/\s{2,}/).map(function (c) { return c.trim(); });
  }

  const HEADER_KW = /^(?:키워드|검색어|keyword|query)$/i;
  const HEADER_VOL = /(?:검색수|검색량|월간\s?검색|volume|search)/i;
  const HEADER_PC = /(?:^pc$|pc\s?검색)/i;
  const HEADER_MOBILE = /모바일|mobile/i;
  const HEADER_DOCS = /(?:문서수|블로그\s?수|발행량|document|경쟁|포화)/i;
  const HEADER_CAT = /(?:카테고리|분야|주제|category)/i;

  /**
   * 붙여넣은 표를 키워드 행으로 바꾼다.
   * - 탭/쉼표/세미콜론/2칸 이상 공백 구분
   * - 헤더가 있으면 이름으로 열을 찾고, PC+모바일 검색량은 합산
   * - 헤더가 없으면 키워드 · 첫 숫자(검색량) · 둘째 숫자(문서수)
   */
  function parseKeywordTable(text) {
    const rawLines = String(text || '').replace(/\r\n?/g, '\n').split('\n')
      .filter(function (l) { return l.trim() && !/^\s*#/.test(l); });
    if (!rawLines.length) return { rows: [], skipped: 0, header: false, error: '붙여넣은 내용이 비어 있어요.' };

    const delim = detectDelimiter(rawLines);
    const grid = rawLines.map(function (l) { return splitCells(l, delim); });
    const first = grid[0];
    const hasHeader = first.some(function (c) { return HEADER_KW.test(c); }) &&
      first.some(function (c) { return HEADER_VOL.test(c) || HEADER_DOCS.test(c); });

    let idx = { keyword: 0, volume: -1, pc: -1, mobile: -1, docs: -1, category: -1 };
    if (hasHeader) {
      idx.keyword = first.findIndex(function (c) { return HEADER_KW.test(c); });
      idx.pc = first.findIndex(function (c) { return HEADER_PC.test(c); });
      idx.mobile = first.findIndex(function (c) { return HEADER_MOBILE.test(c); });
      idx.volume = first.findIndex(function (c) {
        return HEADER_VOL.test(c) && !HEADER_PC.test(c) && !HEADER_MOBILE.test(c);
      });
      idx.docs = first.findIndex(function (c) { return HEADER_DOCS.test(c); });
      idx.category = first.findIndex(function (c) { return HEADER_CAT.test(c); });
      if (idx.keyword < 0) idx.keyword = 0;
    }

    const rows = [];
    let skipped = 0;
    grid.forEach(function (cells, i) {
      if (i === 0 && hasHeader) return;
      const keyword = String(cells[idx.keyword] || '').trim();
      if (!keyword || HEADER_KW.test(keyword)) { skipped++; return; }

      let volume = -1;
      let docs = -1;
      if (hasHeader) {
        if (idx.pc >= 0 || idx.mobile >= 0) {
          volume = (idx.pc >= 0 ? parseCount(cells[idx.pc]) : 0) + (idx.mobile >= 0 ? parseCount(cells[idx.mobile]) : 0);
        } else if (idx.volume >= 0) {
          volume = parseCount(cells[idx.volume]);
        }
        if (idx.docs >= 0) docs = parseCount(cells[idx.docs]);
      }

      if (volume < 0 || docs < 0) {
        const nums = cells.filter(function (c, ci) {
          if (ci === idx.keyword) return false;
          return /^[\d,.]+(?:만|천|억)?$/.test(String(c).trim());
        }).map(parseCount);
        if (volume < 0 && nums.length) volume = nums[0];
        if (docs < 0 && nums.length >= 2) docs = nums[1];
      }

      volume = Math.max(0, volume || 0);
      docs = Math.max(0, docs || 0);
      if (!volume && !docs) { skipped++; return; }

      let category = '기타';
      if (idx.category >= 0 && cells[idx.category]) {
        const c = String(cells[idx.category]).trim();
        if (CATEGORIES.indexOf(c) >= 0) category = c;
      } else if (!hasHeader && cells.length >= 4) {
        const c = String(cells[3] || '').trim();
        if (CATEGORIES.indexOf(c) >= 0) category = c;
      }
      rows.push({ id: uid('kw'), keyword: keyword, volume: volume, docs: docs, category: category, custom: true });
    });

    if (!rows.length) {
      return { rows: [], skipped: skipped, header: hasHeader, error: '키워드·숫자를 찾지 못했어요. 첫 줄에 키워드, 검색수, 문서수를 넣어 주세요.' };
    }
    return { rows: rows.slice(0, 200), skipped: skipped, header: hasHeader, error: null };
  }

  function toCSV(headers, rows) {
    const esc = function (v) {
      const s = String(v == null ? '' : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [headers.map(esc).join(',')];
    rows.forEach(function (r) { lines.push(r.map(esc).join(',')); });
    return lines.join('\r\n');
  }

  function draftsToCSV(drafts) {
    const headers = ['순번', '제목', '타겟 키워드', '발행일', '점수', '상태', 'URL', '메모'];
    const rows = drafts.map(function (d, i) {
      const st = DRAFT_STATUSES.find(function (s) { return s.id === d.status; });
      return [i + 1, d.title, d.keyword, d.date || '', d.score == null || d.score === '' ? '' : d.score, st ? st.label : d.status || '', d.url || '', d.memo || ''];
    });
    return toCSV(headers, rows);
  }

  function parseDraftImport(text) {
    let data;
    try { data = JSON.parse(String(text || '')); } catch (e) { return { items: [], error: 'JSON 형식이 아니에요.' }; }
    const items = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : null);
    if (!items) return { items: [], error: 'items 배열을 찾지 못했어요.' };
    const clean = [];
    items.forEach(function (d) {
      if (!d || !d.title) return;
      clean.push({
        id: uid('draft'),
        title: String(d.title).slice(0, 200),
        keyword: String(d.keyword || '').slice(0, 100),
        date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : todayISO(),
        score: d.score == null || d.score === '' ? null : clamp(Math.round(Number(d.score) || 0), 0, 100),
        status: DRAFT_STATUSES.some(function (s) { return s.id === d.status; }) ? d.status : 'draft',
        url: /^https?:\/\//.test(d.url || '') ? String(d.url).slice(0, 500) : '',
        memo: String(d.memo || '').slice(0, 500),
      });
    });
    return { items: clean, error: clean.length ? null : '가져올 항목이 없어요.' };
  }

  /* ── 카피·심리학 8대 트리거 (블로그형 묶음) ────────────── */

  /**
   * 엔진(packages/copy-psych-engine.js)은 구매 페이지 기준이다.
   * 블로그 글은 읽히고 저장되는 글이므로 같은 트리거를 클릭·체류·전환으로 묶고
   * 가중치를 다시 준다(합 100). 트리거 점수 자체는 엔진 값을 그대로 쓴다.
   */
  const PSYCH_GROUPS = [
    { id: 'click', label: '클릭', desc: '제목과 첫 문장에서 스크롤을 멈추게 하는 힘', target: 60,
      triggers: ['curiosity', 'interrupt', 'loss'] },
    { id: 'dwell', label: '체류', desc: '읽는 동안 신뢰를 쌓는 힘 — 숫자·근거·사례', target: 55,
      triggers: ['anchor', 'authority', 'social'] },
    { id: 'conv', label: '전환', desc: '댓글·저장·다음 글로 이어지는 행동', target: 40,
      triggers: ['scarcity', 'cta'] },
  ];

  /** 블로그형 가중치: 클릭 40 · 체류 43 · 전환 17 */
  const PSYCH_WEIGHTS = {
    loss: 10, anchor: 15, curiosity: 18, interrupt: 12,
    social: 12, scarcity: 5, authority: 16, cta: 12,
  };

  function psychGrade(total) {
    const s = Number(total) || 0;
    if (s >= 75) return { id: 'S', label: 'S', title: '설득 설계 좋음', tone: 's', desc: '클릭·체류·전환이 함께 살아 있어요. 이대로 발행해도 됩니다.' };
    if (s >= 60) return { id: 'A', label: 'A', title: '거의 다 됐어요', tone: 'a', desc: '한두 축만 채우면 됩니다. 아래 빈틈부터 보세요.' };
    if (s >= 45) return { id: 'B', label: 'B', title: '한두 곳 보완', tone: 'b', desc: '정보는 있지만 감정·근거 축이 비어 있어요.' };
    return { id: 'C', label: 'C', title: '약한 축이 있어요', tone: 'c', desc: '제목 또는 본문 한쪽이 설명문에 가깝습니다.' };
  }

  /**
   * 엔진의 diagnose() 결과를 블로그 화면용으로 묶는다.
   * @param {{triggers:Array, total:number, gaps:Array, flags:object}} diag
   */
  function psychProfile(diag) {
    const d = diag || {};
    const list = Array.isArray(d.triggers) ? d.triggers : [];
    if (!list.length) return { total: 0, rawTotal: 0, grade: psychGrade(0), groups: [], gaps: [], empty: true, coverage: 0 };

    const byId = {};
    list.forEach(function (t) { byId[t.id] = t; });

    let sum = 0, weightSum = 0;
    list.forEach(function (t) {
      const w = PSYCH_WEIGHTS[t.id] == null ? 0 : PSYCH_WEIGHTS[t.id];
      sum += t.score * w;
      weightSum += w;
    });
    const total = weightSum ? Math.round(sum / weightSum) : 0;

    const groups = PSYCH_GROUPS.map(function (g) {
      let gs = 0, gw = 0;
      const triggers = g.triggers.map(function (id) {
        const t = byId[id];
        if (!t) return null;
        const w = PSYCH_WEIGHTS[id] == null ? 1 : PSYCH_WEIGHTS[id];
        gs += t.score * w;
        gw += w;
        return {
          id: t.id, name: t.name, score: t.score, weight: w,
          level: t.level, hits: (t.hits || []).slice(0, 3), fix: t.fix || '',
        };
      }).filter(Boolean);
      const score = gw ? Math.round(gs / gw) : 0;
      return { id: g.id, label: g.label, desc: g.desc, target: g.target, score: score, met: score >= g.target, triggers: triggers };
    });

    const gaps = list.filter(function (t) { return t.score < 70; })
      .map(function (t) {
        const w = PSYCH_WEIGHTS[t.id] == null ? 0 : PSYCH_WEIGHTS[t.id];
        return {
          id: t.id, name: t.name, score: t.score, weight: w,
          impact: Math.round(w * (100 - t.score) / 100),
          fix: t.fix || '',
        };
      })
      .sort(function (a, b) { return b.impact - a.impact; })
      .slice(0, 3);

    const coverage = list.filter(function (t) { return t.score >= 50; }).length;

    return {
      total: clamp(total, 0, 100),
      rawTotal: clamp(Math.round(Number(d.total) || 0), 0, 100),
      grade: psychGrade(total),
      groups: groups,
      gaps: gaps,
      coverage: coverage,
      empty: !!(d.flags && d.flags.empty),
    };
  }

  /* ── 추상어·공급자어 교정 묶음 ─────────────────────────── */

  const WORD_FIX_PRIMARY = ['abstract', 'supplier'];
  const WORD_FIX_SECONDARY = ['risk', 'passive', 'vague', 'weak'];

  const WORD_FIX_META = {
    abstract: { label: '추상어', desc: '형용사를 숫자·조건·소재로 바꾸세요' },
    supplier: { label: '공급자어', desc: '회사가 아니라 독자를 주어로 세우세요' },
    risk: { label: '표시광고 위험', desc: '근거를 붙이거나 표현을 낮추세요' },
    passive: { label: '피동·번역체', desc: '짧은 능동문으로 끊으세요' },
    vague: { label: '모호한 약속', desc: '기준 시각·수치를 붙이세요' },
    weak: { label: '군더더기', desc: '강조 부사는 지우세요' },
  };

  /** 탐지 결과(detect)를 추상어·공급자어 우선으로 묶는다. */
  function wordFixGroups(det) {
    const d = det || {};
    const issues = Array.isArray(d.issues) ? d.issues : [];
    const make = function (type) {
      const seen = {};
      const items = [];
      issues.forEach(function (is) {
        if (is.type !== type) return;
        const key = is.phrase;
        if (seen[key]) { seen[key].count++; return; }
        const item = {
          phrase: is.phrase, count: 1,
          alternative: is.alternative || '',
          example: is.example || '',
          canAutoFix: !!is.canAutoFix,
          severity: is.severity || 0,
        };
        seen[key] = item;
        items.push(item);
      });
      const total = items.reduce(function (a, b) { return a + b.count; }, 0);
      return {
        type: type,
        label: (WORD_FIX_META[type] || {}).label || type,
        desc: (WORD_FIX_META[type] || {}).desc || '',
        count: total, items: items,
      };
    };
    const primary = WORD_FIX_PRIMARY.map(make).filter(function (g) { return g.count; });
    const secondary = WORD_FIX_SECONDARY.map(make).filter(function (g) { return g.count; });
    return {
      primary: primary,
      secondary: secondary,
      total: primary.concat(secondary).reduce(function (a, g) { return a + g.count; }, 0),
      primaryTotal: primary.reduce(function (a, g) { return a + g.count; }, 0),
      friction: Number(d.friction) || 0,
      grade: d.grade || null,
    };
  }

  /* ── 내보내기 ───────────────────────────────────────────── */

  return {
    VERSION: VERSION,
    CATEGORIES: CATEGORIES,
    GRADES: GRADES,
    TONES: TONES,
    DRAFT_STATUSES: DRAFT_STATUSES,
    BANNED_GROUPS: BANNED_GROUPS,
    BANNED_WORDS: BANNED_WORDS,
    PSYCH_GROUPS: PSYCH_GROUPS,
    PSYCH_WEIGHTS: PSYCH_WEIGHTS,
    WORD_FIX_PRIMARY: WORD_FIX_PRIMARY,
    WORD_FIX_SECONDARY: WORD_FIX_SECONDARY,
    AI_PATTERNS: AI_PATTERNS,
    TITLE_MIN: TITLE_MIN,
    TITLE_MAX: TITLE_MAX,
    clamp: clamp,
    uid: uid,
    parseCount: parseCount,
    formatNumber: formatNumber,
    formatCompact: formatCompact,
    formatDateKR: formatDateKR,
    todayISO: todayISO,
    countOccurrences: countOccurrences,
    keywordMatcher: keywordMatcher,
    competitionRatio: competitionRatio,
    saturation: saturation,
    opportunityScore: opportunityScore,
    gradeOf: gradeOf,
    gradeInfo: gradeInfo,
    recommendLabel: recommendLabel,
    expectedVisits: expectedVisits,
    analyzeKeyword: analyzeKeyword,
    sortKeywords: sortKeywords,
    keywordStats: keywordStats,
    analyzeTitle: analyzeTitle,
    analyzeBody: analyzeBody,
    findBanned: findBanned,
    findAiTone: findAiTone,
    findLinks: findLinks,
    detectSpans: detectSpans,
    repeatedSentences: repeatedSentences,
    scorePost: scorePost,
    psychProfile: psychProfile,
    psychGrade: psychGrade,
    wordFixGroups: wordFixGroups,
    buildOutline: buildOutline,
    buildPrompt: buildPrompt,
    titleCandidates: titleCandidates,
    tagSet: tagSet,
    toneMeta: toneMeta,
    parseKeywordTable: parseKeywordTable,
    toCSV: toCSV,
    draftsToCSV: draftsToCSV,
    parseDraftImport: parseDraftImport,
  };
});
