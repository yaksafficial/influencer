# 공동구매 캘린더 생성기

Google Spreadsheet에서 공동구매 데이터를 실시간으로 읽어와, 인스타그램에 올릴 수 있는 월간 캘린더 이미지(1080×1350, 4:5 비율)를 생성하는 정적 웹페이지입니다.

## 미리보기

- 데모: [https://influencer-amber.vercel.app](https://influencer-amber.vercel.app)

## 기능

- Google Sheets API를 통해 스프레드시트 데이터 실시간 연동
- 인스타그램 최적 비율(4:5) 캘린더 자동 생성
- 제품명, 설명, 배지(HOT 등) 인라인 편집
- 테마 색상 커스텀 변경
- PNG 이미지 다운로드
- 제품 클릭 시 판매 링크 이동
- 모든 설정 localStorage 자동 저장

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
# 아무 정적 서버로 열기
npx serve .
# 또는 직접 index.html 열기
open index.html
```

**Vercel 배포:**
```bash
npm i -g vercel
vercel login
vercel --yes --prod
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
├── index.html      ← 단일 HTML 파일 (전체 앱)
├── vercel.json     ← Vercel 정적 배포 설정
└── README.md
```

## 기술 스택

- 순수 HTML + CSS + JavaScript (프레임워크 없음)
- Google Sheets API v4
- html2canvas (PNG 변환)
- Google Fonts (Noto Sans KR, Cormorant Garamond)

## 라이선스

MIT
