# 공동구매 캘린더 생성기

## 프로젝트 개요
Google Spreadsheet에서 공동구매 데이터를 실시간으로 읽어와, 인스타그램용 월간 캘린더 이미지(1080x1350, 4:5비율)를 생성하는 정적 웹페이지.

## 기술 스택
- 순수 HTML + CSS + JavaScript 단일 파일 (`index.html`)
- 프레임워크/빌드 도구 없음
- Google Sheets API v4 (브라우저에서 직접 호출)
- html2canvas (DOM → PNG 변환)
- Cloudflare Pages 정적 배포

## 프로젝트 구조
```
influencer/
├── index.html      ← 전체 앱 (CSS + JS 포함)
├── CLAUDE.md       ← 이 파일
└── .claude/
    └── commands/   ← Claude Code 커스텀 명령어
```

## 핵심 규칙
- **단일 파일 유지**: 모든 코드는 `index.html` 하나에 포함. 파일 분리 금지.
- **빌드 없음**: 정적 호스팅. Cloudflare Pages 배포.
- **API 키 하드코딩 금지**: 사용자가 UI에서 직접 입력. localStorage에 저장.
- **CSS 변수 사용**: 테마 색상은 `--accent` (RGB), `--accent-hex` (HEX) 변수 사용.
- **pseudo-element 사용 금지**: html2canvas 호환성 문제로 실제 DOM 요소 사용 (`.calendar-bg`, `.week-line`, `.date-circle`).

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
# Cloudflare Pages
CLOUDFLARE_API_TOKEN=<토큰> wrangler pages deploy . --project-name=influencer --commit-dirty=true
```

## 주의사항
- html2canvas에서 `createPattern` 0크기 에러 방지를 위해 `CanvasRenderingContext2D.prototype.createPattern`을 monkey-patch함
- 이미지 CORS 우회를 위해 저장 시 canvas/fetch/corsproxy.io 3단계 변환 시도, 실패 시 placeholder 픽셀 대체
- `contenteditable` 요소에는 반드시 `spellcheck="false"` 포함
