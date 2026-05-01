# 공동구매 캘린더 & AI 스터디 플랫폼

## 프로젝트 개요
Google Spreadsheet에서 공동구매 데이터를 실시간으로 읽어와, 인스타그램용 월간 캘린더 이미지(1080x1350, 4:5비율)를 생성하는 정적 웹페이지. AI 그룹 스터디 신청 및 관리 기능 포함.

## 기술 스택
- 순수 HTML + CSS + JavaScript (프레임워크/빌드 도구 없음)
- Google Sheets API v4 (브라우저에서 직접 호출)
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
├── study-curriculum.html     ← 스터디 커리큘럼 안내 페이지
├── study-skills-practice.html← 스킬 실습 가이드 (수업 자료)
├── dashboard.html            ← 공구 매출 대시보드 (API 직접 호출)
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
| `/deploy` | Cloudflare Pages 배포 |
| `/add-product` | 캘린더에 새 제품 매핑 추가 |
| `/setup` | 프로젝트 설정 상태 점검 |

## 핵심 규칙
- **단일 파일 유지**: 각 페이지는 HTML 하나에 CSS + JS 포함. 외부 파일 분리 금지.
- **빌드 없음**: 정적 호스팅. Cloudflare Pages 배포.
- **API 키 하드코딩 금지**: 사용자가 UI에서 직접 입력. localStorage에 저장.
- **CSS 변수 사용**: 테마 색상은 `--accent` (RGB), `--accent-hex` (HEX) 변수 사용.
- **pseudo-element 사용 금지**: html2canvas 호환성 문제로 실제 DOM 요소 사용 (`.calendar-bg`, `.week-line`, `.date-circle`).

## 페이지별 설명

### index.html (공동구매 캘린더)
- Google Sheets API로 스프레드시트 데이터 실시간 연동
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

### study-curriculum.html (커리큘럼 페이지)
- 4주 AI 스터디 커리큘럼 안내
- 호스트 3명 + 게스트 6명 (최대 9명)
- 오프라인 1시간 미팅 + 과제 수행 방식
- 하단 CTA로 신청 폼(study.html) 연결

### dashboard.html (공구 매출 대시보드)
- 친한스토어 어드민 REST API 직접 호출 (Google Sheets 미사용)
- Bearer JWT 토큰 인증 (Phase 1), 향후 ID/PW 로그인 전환 예정
- 셀러 목록, 공구 플랜 상세, 상품/옵션/커미션 시각화
- 통계 카드, CSS 바 차트, 정렬/검색/필터 테이블, 상세 모달
- 엑셀/CSV 내보내기

## 스프레드시트 컬럼 구조 (A~H)
| 컬럼 | 내용 |
|------|------|
| A | 공구번호 |
| B | 공구타이틀 |
| C | 상품명 |
| D | 공구시작일시 |
| E | 공구종료일시 |
| F | 판매링크 URL |
| G | 공구 상태코드 |
| H | 썸네일이미지 URL |

## 배포
```bash
# Cloudflare Pages (전체 배포)
CLOUDFLARE_API_TOKEN=<토큰> wrangler pages deploy . --project-name=influencer --commit-dirty=true
```
- 프로덕션 URL: https://influencer-p68.pages.dev
- 프로젝트명: `influencer`

## 주의사항
- html2canvas에서 `createPattern` 0크기 에러 방지를 위해 `CanvasRenderingContext2D.prototype.createPattern`을 monkey-patch함
- 이미지 CORS 우회를 위해 저장 시 canvas/fetch/corsproxy.io 3단계 변환 시도, 실패 시 placeholder 픽셀 대체
- `contenteditable` 요소에는 반드시 `spellcheck="false"` 포함
