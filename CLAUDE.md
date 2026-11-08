# 공동구매 캘린더 & AI 스터디 플랫폼

## 프로젝트 개요
친한스토어 어드민 REST API에서 공동구매 데이터를 실시간으로 읽어와, 인스타그램용 월간 캘린더 이미지(1080x1350, 4:5비율)를 생성하는 정적 웹페이지. AI 그룹 스터디 신청 및 관리 기능 포함.

## 기술 스택
- 순수 HTML + CSS + JavaScript (프레임워크/빌드 도구 없음)
- 친한스토어 어드민 REST API (캘린더 + 대시보드 공유)
- Google Apps Script (스터디 폼 → 스프레드시트 연동)
- html2canvas (DOM → PNG 변환)
- Cloudflare Pages 정적 배포

## 프로젝트 구조
```
influencer/
├── index.html                ← 공동구매 캘린더 (메인 앱)
├── event.html                ← 이벤트 당첨자 배송지 입력 폼
├── event-admin.html          ← 이벤트 당첨자 관리자 대시보드
├── study.html                ← AI 스터디 신청 폼
├── study-admin.html          ← 스터디 관리자 대시보드
├── study-raffle.html         ← 스터디 그룹 추첨 룰렛
├── study-curriculum.html     ← 스터디 커리큘럼 안내 페이지
├── study-skills-practice.html← 스킬 실습 가이드 (수업 자료)
├── dashboard.html            ← 공구 매출 대시보드 (API 직접 호출)
├── inbox.html                ← 고객 응대 인박스 (인스타 댓글/DM 응대, 자료 DM 발송)
├── privacy.html, data-deletion.html ← 인박스(Meta 앱 '약사피셜 CS') 개인정보처리방침·데이터 삭제 안내 (앱 게시 필수 URL)
├── db/schema.sql             ← 인박스용 Cloudflare D1 스키마
├── wrangler.toml             ← Pages 설정 + D1 바인딩(DB)
├── functions/
│   ├── api/[[path]].js       ← Cloudflare Pages CORS 프록시
│   └── api/ig/               ← 인박스 백엔드 (Instagram API with Instagram Login)
│       ├── _lib.js           ← 공용: 세션, 비밀번호 해시, IG API 클라이언트, 토큰 갱신
│       ├── _middleware.js    ← 세션 검사 (webhook/callback/login 제외)
│       ├── webhook.js        ← Meta 웹훅 수신 (서명 검증, comments/messages → D1)
│       ├── connect.js, callback.js ← Business Login OAuth (장기 토큰, 웹훅 구독)
│       ├── status.js         ← 헬스체크 (토큰 만료, API, DM 접근, 웹훅 수신)
│       ├── media.js, comments.js, comments/reply.js, comments/private-reply.js
│       ├── conversations.js, messages/send.js
│       └── kits.js, staff.js, log.js, auth/*
├── event-prompt.md           ← 당첨자폼 상세 스펙 (참조용)
├── CLAUDE.md                 ← 이 파일
├── PLAN.md                   ← 프로젝트 플랜
├── README.md                 ← 프로젝트 소개
└── .claude/
    └── commands/             ← Claude Code 커스텀 명령어 (스킬)
```

## 커스텀 스킬 (슬래시 명령어)
| 명령어 | 설명 |
|--------|------|
| `/공구캘린더` | 공동구매 캘린더(index.html) 생성/수정 |
| `/당첨자폼` | 이벤트 당첨자 배송지 폼(event.html, event-admin.html) 생성/수정 |
| `/커리큘럼` | AI 스터디 커리큘럼(study-curriculum.html) 생성/수정 |
| `/공구대시보드` | 공구 매출 대시보드(dashboard.html) 수정 |
| `/프록시` | Cloudflare Pages Functions CORS 프록시 생성/수정 |
| `/deploy` | Cloudflare Pages 배포 |
| `/add-product` | 캘린더에 새 제품 매핑 추가 |
| `/setup` | 프로젝트 설정 상태 점검 |

## 핵심 규칙
- **단일 파일 유지**: 각 페이지는 HTML 하나에 CSS + JS 포함. 외부 파일 분리 금지.
- **빌드 없음**: 정적 호스팅. Cloudflare Pages 배포.
- **토큰/키 하드코딩 금지**: 사용자가 UI에서 로그인 또는 직접 입력. localStorage에 저장.
  - 예외: `inbox.html` 은 직원과 데이터를 공유해야 하므로 서버(Pages Functions + D1)를 사용. 비밀값은 Cloudflare 환경변수(`IG_APP_SECRET`, `IG_WEBHOOK_VERIFY_TOKEN`, `INBOX_ADMIN_PASSWORD`, `CS_SSO_SECRET`)에만 둔다.
- **CSS 변수 사용**: 테마 색상은 `--accent` (RGB), `--accent-hex` (HEX) 변수 사용.
- **pseudo-element 사용 금지**: html2canvas 호환성 문제로 실제 DOM 요소 사용 (`.calendar-bg`, `.week-line`, `.date-circle`).

## 페이지별 설명

### index.html (공동구매 캘린더)
- 친한스토어 REST API로 공구 데이터 실시간 연동 (대시보드와 인증 공유)
- Bearer JWT 토큰 인증 (ID/PW + 2FA), `dashboard_bearer_token` localStorage 키 공유
- 상태 코드 필터: T4(확정), T6(진행중), T8(진행완료), Y0(정산대기)만 표시
- 인스타그램 4:5 비율 캘린더 자동 생성
- 제품명/설명/배지 인라인 편집, 테마 색상 변경, PNG 다운로드

### study.html (스터디 신청 폼)
- AI 그룹 스터디 참가 신청서
- Google Apps Script를 통해 Google Sheets에 데이터 저장
- Apps Script URL은 localStorage(`study_script_url`)에 저장

### study-admin.html (관리자 대시보드)
- 스터디 신청자 목록 조회 및 관리
- Apps Script 코드 템플릿 제공
- 설정 탭에서 Apps Script URL 관리

### study-raffle.html (그룹 추첨 룰렛)
- 신청자를 2개 스터디 그룹(A/B)으로 나누는 룰렛 추첨 페이지
- localStorage(`study_submissions`)에서 신청자 자동 로드, 또는 직접 명단 입력
- SVG 기반 룰렛 회전 애니메이션 (5~6바퀴 cubic-bezier ease-out)
- 화살표가 가리키는 사람을 A/B에 번갈아 배정 (배정 후 룰렛에서 제거)
- 결과를 PNG 저장 / 클립보드 복사 가능

### study-curriculum.html (커리큘럼 페이지)
- 4주 AI 스터디 커리큘럼 안내
- 호스트 3명 + 게스트 6명 (최대 9명)
- 오프라인 1시간 미팅 + 과제 수행 방식
- 하단 CTA로 신청 폼(study.html) 연결

### inbox.html (고객 응대 인박스)
- Instagram API with Instagram Login (Facebook 페이지 불필요). 권한: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages`
- 댓글 인박스: 게시물별 댓글 조회, 공개 답글, 숨기기, 처리 상태. 웹훅 실시간 + [동기화] 버튼
- 자료 DM: 댓글 작성자에게 Private Reply 로 자료(킷) 발송. **댓글당 1회, 작성 후 7일 이내** (Meta 강제). 첨부 시도 후 실패하면 본문(링크)으로 대체
- DM 인박스: 대화 목록/스레드/전송. 인스타 앱의 1차/일반/요청 폴더는 API가 제공하지 않으므로 자체 필터(안 읽음·24h 답장 가능·팔로워·담당) 사용. 24시간 윈도우 타이머 표시
- 로그인: `owner`(환경변수 비밀번호) + 직원 계정(D1, PBKDF2). 세션 쿠키 14일. 모든 행동은 activity_log 에 기록
- 계정 연결: **신규 Meta 앱은 통합 로그인(Unified login)만 지원**. 대시보드 '2. 액세스 토큰 생성'에서 받은 토큰을 inbox 설정 › [토큰으로 연결]에 붙여넣음 (`functions/api/ig/token.js`). 토큰 접두어로 호스트 판별: `EAA…` → graph.facebook.com(`api_host='facebook'`, 만료 없음), `IGAA…` → graph.instagram.com(구 Instagram 로그인, 60일·자동 갱신)
- 모든 IG 호출은 `/{ig_user_id}/...` 경로 + `igFetch(env, account, …)` 로 호스트 자동 선택. `IG_APP_SECRET` 은 Meta 앱 시크릿(웹훅 서명 검증)
- 과거 응대 검색: 댓글·DM 상단 검색란 / [검색] 탭 → `GET /api/ig/search?q=&scope=all|comments|dm` (띄어쓰기 단어 AND, LIKE 부분 일치). 댓글은 원 댓글+답글 묶음, DM은 일치 메시지 앞2·뒤3 맥락. 우리 답변에 [복사]
- 과거 기록 채우기: DM [이전 대화 더 불러오기] (`conversations?sync=1&older=1`, 커서 settings.dm_list_after, 20개씩). 댓글 동기화는 저장 수 < 인스타 댓글 수인 게시물을 최신순 12개, 게시물당 최대 3페이지(Meta 호출 36회 한도)
- 근무앱 자동 로그인: `GET /api/ig/sso?u=이름&ts=초&sig=HMAC-SHA256(CS_SSO_SECRET, "이름.초")` (유효 10분) → 세션 생성 후 /inbox.html. 기본 권한 명훈약사=owner, 지우약사=staff (`CS_SSO_USERS` 로 변경). 근무앱(yaksa-work-app) `lib/sso.py` 가 같은 방식으로 서명
- D1 적용: `wrangler d1 execute influencer-inbox --remote --file=db/schema.sql`

### dashboard.html (공구 매출 대시보드)
- 친한스토어 어드민 REST API 직접 호출 (캘린더와 인증 토큰 공유)
- Bearer JWT 토큰 인증 (ID/PW + Slack 2FA)
- 셀러 목록, 공구 플랜 상세, 상품/옵션/커미션 시각화
- 통계 카드, CSS 바 차트, 정렬/검색/필터 테이블, 상세 모달
- 엑셀/CSV 내보내기

## 친한스토어 API 데이터 매핑
| API 필드 | 캘린더 product 객체 |
|----------|-------------------|
| `group_purchase_plan_idx` | `id` |
| `group_purchase_title` | `title` |
| `start_date` | `startDate` (+ `startDay`, `startYear`, `startMonth` 파싱) |
| `end_date` | `endDate` |
| `image_url` | `thumbnail` |
| (없음) | `salesLink` (빈 문자열) |
| `group_purchase_plan_step_code` | 필터링용 (T4, T6, T8, Y0만 표시) |

## 배포
- **자동 배포**: `main` 에 push 하면 GitHub Actions(`.github/workflows/deploy.yml`)가 Cloudflare Pages 프로젝트 `influencer` 운영(https://influencer-6d1.pages.dev)으로 배포. 다른 브랜치 push 는 미리보기(`https://<브랜치>.influencer-6d1.pages.dev`)로만 배포. 저장소 시크릿 `CLOUDFLARE_API_TOKEN` 필요.
- D1 데이터베이스: `influencer-inbox` (wrangler.toml 의 database_id). 스키마 변경 시 `wrangler d1 execute influencer-inbox --remote --file=db/schema.sql`
- Pages 비밀값(환경변수)은 `wrangler pages secret put <이름> --project-name=influencer` 로 등록
- 수동 배포:
```bash
# Cloudflare Pages (전체 배포)
CLOUDFLARE_API_TOKEN=<토큰> wrangler pages deploy . --project-name=<your-project> --commit-dirty=true
```
- 프로덕션 URL은 본인 Cloudflare Pages 프로젝트명에 따라 달라집니다 (예: `https://<your-project>.pages.dev`)
- 프로젝트명: (예: `influencer`, 본인 환경에 맞게 변경)

## 인박스 운영 주의 (중요)
- **운영 = `main`** (2026-11-09 인박스 작업 브랜치 병합). 오래된 체크아웃(인박스·functions/api/ig 가 없는 상태)에서 `wrangler pages deploy` 를 실행하면 **운영 인박스가 사라진다** → 수동 배포 전 `git pull` 로 최신 main 인지 확인. 보통은 main push 자동 배포만 쓴다.
- Meta 호출 한도(code 4 등)는 시간당. 동기화 버튼은 '바뀐 것만' 조회하고 한도 시 즉시 중단하도록 되어 있음 — 루프·자동 동기화 추가 금지.
- Cloudflare 무료 플랜: D1 하루 읽기 500만·쓰기 10만 행(2026-09부터 초과 시 쿼리 실패, 매일 09:00 KST 초기화), 요청당 쿼리 수 제한. 대량 저장은 '바뀐 행만 쓰기'(ON CONFLICT … WHERE) + 요청당 상한(댓글 동기화 600건) 유지.
- 화면 자동 갱신은 `/api/ig/pulse`(D1 2행) 10초 + 전체 5분. 짧은 주기로 무거운 API 를 부르지 말 것.
- 만료/점검 일정: Cloudflare API 토큰(GitHub 시크릿 `CLOUDFLARE_API_TOKEN`, 권한 Pages·D1 Edit) — 만료 없음 (2026-11-09 변경 확인). Meta 앱 '약사피셜 CS'는 연 1회 '데이터 사용 점검' 요청이 오면 개발자 대시보드에서 완료해야 앱이 제한되지 않음. Meta 토큰은 시스템 사용자 토큰(만료 없음).
- 아직 미해결: DM 실시간 수신·고객 대상 DM 발송은 Meta 고급 액세스(앱 검수) 필요 가능성. privacy.html 의 '최대 1년 보관' 문구와 실제(자동 삭제 없음) 불일치 — 사용자가 보류 결정.

## 주의사항
- html2canvas에서 `createPattern` 0크기 에러 방지를 위해 `CanvasRenderingContext2D.prototype.createPattern`을 monkey-patch함
- 이미지 CORS 우회를 위해 저장 시 canvas/fetch/corsproxy.io 3단계 변환 시도, 실패 시 placeholder 픽셀 대체
- `contenteditable` 요소에는 반드시 `spellcheck="false"` 포함
