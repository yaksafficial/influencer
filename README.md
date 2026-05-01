# 공동구매 캘린더 & AI 스터디 플랫폼

Google Spreadsheet 기반 인스타그램용 공동구매 캘린더 이미지 생성기와 AI 그룹 스터디 운영 플랫폼입니다.

## 미리보기

- 프로덕션: [https://influencer-p68.pages.dev](https://influencer-p68.pages.dev)

## 기능

### 공동구매 캘린더 (`index.html`)
- Google Sheets API를 통해 스프레드시트 데이터 실시간 연동
- 인스타그램 최적 비율(4:5) 캘린더 자동 생성
- 제품명, 설명, 배지(HOT 등) 인라인 편집
- 테마 색상 커스텀 변경
- PNG 이미지 다운로드
- 제품 클릭 시 판매 링크 이동
- 모든 설정 localStorage 자동 저장

### AI 스터디 (`study.html`, `study-admin.html`, `study-curriculum.html`)
- 스터디 신청 폼 (Google Apps Script → Google Sheets 연동)
- 관리자 대시보드 (신청자 조회 및 관리)
- 커리큘럼 안내 페이지 (4주 과정)

### 공구 매출 대시보드 (`dashboard.html`)
- 친한스토어 어드민 REST API 직접 연동
- 셀러/공구/상품/옵션/커미션 현황 시각화
- 통계 카드, CSS 바 차트, 상세 테이블, 엑셀/CSV 내보내기

## 시작하기

### 1. 사전 준비

1. [Google Cloud Console](https://console.cloud.google.com)에서 프로젝트 생성
2. **Google Sheets API** 활성화
3. **사용자 인증 정보 → API 키** 생성
4. 스프레드시트 공유 설정: **"링크가 있는 모든 사용자 — 뷰어"**

### 2. 스프레드시트 컬럼 구조 (A~H)

| 컬럼 | 내용 |
|------|------|
| A | 공구번호 |
| B | 공구타이틀 |
| C | 상품명 |
| D | 공구시작일시 (예: 2026-04-06 00:00:00) |
| E | 공구종료일시 |
| F | 판매링크 URL |
| G | 공구 상태코드 |
| H | 썸네일이미지 URL |

### 3. 실행

**로컬 실행:**
```bash
# 반드시 HTTP 서버로 실행 (file://로 직접 열면 이미지 저장이 동작하지 않습니다)
npx serve .
# 또는
python3 -m http.server 8080
```

**Cloudflare Pages 배포:**
```bash
npm i -g wrangler
CLOUDFLARE_API_TOKEN=<토큰> wrangler pages deploy . --project-name=influencer --commit-dirty=true
```

### 4. 사용법

1. 페이지 상단에 **API 키**와 **스프레드시트 URL** 입력
2. **적용** 클릭 → 캘린더 자동 생성
3. 텍스트 클릭하여 제품명/설명/배지/타이틀 편집
4. 테마 컬러 피커로 색상 변경
5. **이미지 저장** → PNG 다운로드
6. 인스타그램에 업로드

## 프로젝트 구조

```
influencer/
├── index.html              ← 공동구매 캘린더 (메인 앱)
├── study.html              ← AI 스터디 신청 폼
├── study-admin.html        ← 스터디 관리자 대시보드
├── study-curriculum.html   ← 스터디 커리큘럼 안내 페이지
├── dashboard.html          ← 공구 매출 대시보드
├── CLAUDE.md               ← Claude Code 설정
├── PLAN.md                 ← 프로젝트 플랜
└── README.md               ← 이 파일
```

## 기술 스택

- 순수 HTML + CSS + JavaScript (프레임워크 없음)
- Google Sheets API v4
- Google Apps Script (폼 데이터 저장)
- html2canvas (PNG 변환)
- Google Fonts (Noto Sans KR, Cormorant Garamond)
- Cloudflare Pages (정적 배포)

## 라이선스

MIT
