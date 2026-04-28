프로젝트 설정 상태를 점검하고 누락된 부분을 안내합니다.

다음 항목을 순서대로 확인하세요:

1. **Wrangler CLI**: `wrangler --version` 실행하여 설치 여부 확인. 없으면 `npm i -g wrangler` 안내.
2. **index.html 존재 여부**: 파일이 있는지 확인.
3. **Cloudflare API 토큰**: 사용자에게 토큰 보유 여부 확인. 없으면 Cloudflare Dashboard → My Profile → API Tokens에서 생성 안내.
4. **배포 테스트**: `CLOUDFLARE_API_TOKEN=<토큰> wrangler pages deploy . --project-name=influencer --commit-dirty=true` 실행 제안.

점검 결과를 요약해서 사용자에게 알려주세요. 문제가 있으면 해결 방법을 안내하세요.
