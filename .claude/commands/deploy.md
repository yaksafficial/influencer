⚠️ 먼저 확인: 운영 사이트(influencer-6d1.pages.dev)는 `claude/cool-hypatia-vzy9wv` 브랜치 기준입니다.
현재 브랜치가 이 브랜치(또는 이 브랜치가 병합된 main)가 아니면 배포하지 마세요 — 고객 응대 인박스가 사라집니다.
이 브랜치는 push 하면 GitHub Actions 가 자동 배포하므로 보통 수동 배포가 필요 없습니다.

Cloudflare Pages에 프로덕션 배포를 실행하세요.

1. 사용자에게 Cloudflare API 토큰을 입력받으세요. (예: "Cloudflare API 토큰을 입력해주세요.")
2. 토큰을 환경변수로 설정하여 배포를 실행합니다:
   `CLOUDFLARE_API_TOKEN=<토큰> wrangler pages deploy . --project-name=influencer --commit-dirty=true`
3. 배포 실패 시 프로젝트가 없으면 먼저 생성합니다:
   `CLOUDFLARE_API_TOKEN=<토큰> wrangler pages project create influencer --production-branch=main`
4. 배포 완료 후 프로덕션 URL을 사용자에게 알려주세요.
