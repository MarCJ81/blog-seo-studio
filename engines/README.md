# engines/ — 이 앱에 그대로 들어 있는 독립 모듈 2개

`apps/blog-seo-studio/`를 폴더째 복사하면 이 두 파일도 함께 가서 바로 동작합니다.
빌드·번들러·npm 설치가 필요 없는 의존성 0의 UMD 모듈이라, `file://`이 아닌 정적 서버에서
`<script>` 두 줄만 넣으면 됩니다. (브라우저는 `window.CopyPsych` · `window.AiBridge`, node는 `require()`)

| 파일 | 역할 | 크기 |
| --- | --- | --- |
| `copy-psych-engine.js` | 8대 심리 트리거 진단, PAS·BAB·AIDA·4U 생성, 추상어·공급자어 탐지·교정 | ~54KB |
| `ai-bridge.js` | ChatGPT·Claude·Gemini 새 창 링크, AI 답변 → 제목·본문·태그 분리, Gemini API 요청/응답 | ~13KB |

`copy-psych-engine.js`는 `packages/copy-psych-engine.js`와 **바이트 단위로 같은 사본**입니다.
공용 엔진을 고치면 이 파일도 함께 복사해 주세요(앱 하나만 배포할 때도 이 폴더만 있으면 됩니다).

```html
<script src="engines/copy-psych-engine.js"></script>
<script src="engines/ai-bridge.js"></script>
<script src="core.js"></script>
```

## 1. 8대 트리거

```js
const CP = window.CopyPsych;
const d = CP.diagnose(title + '\n' + body);
d.total;      // 0~100 (가중 평균)
d.triggers;   // 8개 { id, name, weight, score, hits, level, fix }
d.gaps;       // 빈틈 (가중치 × 부족분 순)
```

| id | 이름 | 가중치 | 보는 신호 |
| --- | --- | --- | --- |
| `loss` | 손실 회피 | 15 | 놓치면·그대로 두면·되돌릴 수 없음 |
| `anchor` | 구체적 숫자 | 15 | 단위 숫자, 정가→판매가, 배수, 시간 약속 |
| `curiosity` | 호기심 갭 | 12 | 질문, 왜, 아무도 모르는, 알고 보니 |
| `interrupt` | 인지 반전 | 10 | ~하지 마세요, 반대로, 상식 깨기 |
| `social` | 사회적 증거 | 13 | 후기, N명 선택, 재구매, 평점 |
| `scarcity` | 희소성·기한 | 12 | 한정, 선착순, 마감, 잔여 |
| `authority` | 권위·실측 | 13 | 실측, 데이터, 인증, 직접 써봄 |
| `cta` | 초저마찰 CTA | 10 | 클릭, 무료, 3초, 가입 없이 |

블로그 글은 구매 페이지가 아니어서 `scarcity`·`cta`가 낮은 것이 정상입니다.
그래서 이 앱은 `core.js`의 `psychProfile()`에서 **블로그형 가중치**로 한 번 더 묶습니다.
(클릭 40 · 체류 43 · 전환 17, 합 100)

- **클릭** `curiosity` · `interrupt` · `loss` — 제목과 첫 문장
- **체류** `anchor` · `authority` · `social` — 읽는 동안 쌓이는 신뢰
- **전환** `scarcity` · `cta` — 댓글·저장·구매로 이어지는 행동

## 2. 도입부 4종

```js
const fw = CP.build('PAS', {
  product: '겨울 가습기 관리법',       // 글의 주제(키워드)
  target: '원룸 사는 20대',            // 독자
  problem: '가습기 물때와 냄새',       // 독자가 겪는 문제
  solution: '주 1회 20분이면 끝나는 루틴', // 얻는 결과
  proof: '3년 사용, 기기 2대',          // 근거(선택)
  cta: '댓글로 상황 알려주기'
});
fw.title; fw.sections; fw.body; fw.psych;
```

`PAS`(문제·자극·해결) · `BAB`(이전·이후·다리) · `AIDA`(주의·흥미·욕구·행동) · `4U`(유용·긴급·독특·구체).
한국어 조사(은/는, 이/가, 을/를, 으로/로)를 받침으로 자동 선택합니다.

## 3. 추상어·공급자어 교정

```js
CP.detect(text);   // { friction, issues, groups }  규칙 30여 개
CP.correct(text);  // { text, applied, before, after, improved }
```

`correct()`는 **문법·군더더기만** 바꿉니다(예: `매우 ` 삭제, `저희는 … 제공합니다` → `지금 바로 받아보세요`).
`최고의`, `다양한`처럼 사실을 새로 만들어야 하는 표현은 자동 치환하지 않고 대안만 제시합니다.
이 앱의 `[안전 치환 적용]` 버튼이 `correct()`를 호출하고, 되돌리기는 토스트에서 할 수 있습니다.

## 4. AI 브리지

```js
const B = window.AiBridge;
B.linkFor('chatgpt', prompt);  // { url:'https://chatgpt.com/?q=…', prefilled:true }
B.linkFor('claude', prompt);   // { url:'https://claude.ai/new?q=…', prefilled:true }
B.linkFor('gemini', prompt);   // { url:'https://gemini.google.com/app', prefilled:false }
```

- ChatGPT·Claude는 주소의 `q` 파라미터로 입력창을 채웁니다(각 서비스가 공식 문서로 보장하지는 않는 기능).
  로그인이 안 되어 있으면 로그인 후 빈 창이 열리므로, 앱은 **항상 클립보드에도 복사**합니다.
- Gemini는 주소 자동 입력을 지원하지 않아 클립보드 + 새 창으로 안내합니다.
- 프롬프트가 6,000자(ChatGPT) / 10,000자(Claude)를 넘으면 주소에 담지 않고 기본 주소만 엽니다.

```js
B.parseDraft(aiAnswer);  // { title, body, tags, keyword, stats, warnings }
B.quickStats(aiAnswer);  // 미리보기용 요약
```

`parseDraft`는 ```코드블록``` 표시, `제목:`/`#` 표시, `태그:` 줄, 마지막 해시태그 줄을 걷어내고
원고 진단에 바로 넣을 수 있는 제목·본문을 만듭니다.

```js
const req = B.buildGeminiRequest({ apiKey, model:'gemini-3.5-flash-lite', prompt });
const res = await fetch(req.url, req.init);
const out = B.parseGeminiResponse(await res.json());
```

키는 이 브라우저(localStorage)에만 저장되고 Google 주소로만 전송됩니다. 키가 비어 있으면
앱은 외부 요청을 **한 건도** 보내지 않습니다.

## 키·개인정보

이 폴더의 두 파일에는 **API 키도, 개인 블로그 주소도 들어 있지 않습니다**(단위 테스트가 검사합니다).
키는 사용자가 화면에서 넣는 값이며 저장소에 커밋되지 않습니다.
