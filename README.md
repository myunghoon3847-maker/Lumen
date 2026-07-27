# Lumen AI v1.3 Brand Applied

## 적용 내용
- 확정한 Lumen AI 가로형 SVG 로고를 상단에 적용
- 로고 심볼 기반 앱 아이콘 적용
- PWA 설치 아이콘 192×192, 512×512 적용
- Apple 홈 화면 아이콘 적용
- favicon 적용
- manifest.webmanifest 및 service worker 추가

## 배포
이 폴더의 전체 파일을 기존 GitHub 저장소에 덮어쓴 뒤 커밋·푸시하면 Vercel에서 자동 배포됩니다.
기존 `OPENAI_API_KEY` 환경 변수는 그대로 유지됩니다.


## v1.4 브랜드 수정
- 초기 L 로고를 앱 헤더에 복원
- 동일한 L 심볼을 PWA/앱 설치 아이콘, Apple Touch Icon, favicon에 적용
- 외부 SVG 경로 의존을 제거하여 깨진 이미지 문제 방지
