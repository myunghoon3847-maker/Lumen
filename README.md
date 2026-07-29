# Lumen AI v1.6.5 — Connection Fix

## 핵심 수정
- GitHub Pages에서 Vercel API를 호출할 때 발생하던 CORS 연결 실패 수정
- 확인된 두 Vercel Production 도메인을 순서대로 재시도
- Vercel 내부에서는 상대 경로 `/api/write` 사용
- Vercel Deployment Protection 오류를 별도로 안내
- API 응답에 `Access-Control-Allow-Origin: *` 적용

## 저장소 구조
압축 내부의 파일과 폴더를 GitHub 저장소 최상단에 업로드하세요.

## 배포 확인
1. `https://lumen-git-main-hoony2.vercel.app/api/health`
2. `https://lumen-blxbzzpaz-hoony2.vercel.app/api/health`

둘 중 하나에서 JSON이 열리고 `apiKeyConfigured: true`여야 합니다.

## 커밋 메시지
`fix: resolve Vercel API connection and CORS failures`
