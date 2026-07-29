# Lumen AI v1.6.4 Stable

## GitHub 업로드 구조
압축을 푼 뒤 아래 파일과 폴더를 저장소 최상단에 그대로 업로드하세요.

- index.html
- manifest.webmanifest
- sw.js
- favicon.ico
- app-icon-1024.png
- icons/
- api/
- vercel.json

`public` 폴더 안에 넣지 않습니다.

## Vercel 환경 변수
- OPENAI_API_KEY
- OPENAI_MODEL (선택)

환경 변수를 변경한 경우 Redeploy가 필요합니다.

## 테스트
- `https://배포주소.vercel.app/api/health`
- 앱은 Vercel Production Domain으로 먼저 테스트하세요.
