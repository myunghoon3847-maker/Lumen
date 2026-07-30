# Lumen AI v1.6.5 Security Hardened

기존 `v1.6.5 Connection Fix`의 화면과 OpenAI Responses API 흐름은 유지하면서, 공개 배포 전 필요한 보안 경계를 보완한 버전입니다.

## 반영한 핵심 보완

- API 호출 출처를 허용 목록으로 제한하고 `*` CORS 제거
- 운영 환경에서 Upstash Redis 기반 공유 사용량 제한을 필수화
- 요청 본문 48KB, 요청문 2,000자, 수정 지시 500자, 기존 글 12,000자 상한
- 선택값 허용 목록 검증 및 JSON 요청만 허용
- OpenAI 원문 오류·키 설정 상태·모델 설정을 클라이언트에 노출하지 않음
- OpenAI Responses API 요청에 `store: false` 적용
- CSP, 클릭재킹 차단, MIME 스니핑 차단, Referrer/Permissions 보안 헤더
- GitHub Pages 하위 경로에서 동작하도록 PWA 경로 수정
- 서비스 워커가 외부 API 응답을 캐시하지 않도록 동일 출처 정적 파일만 처리
- 작성 이력을 브라우저에 최대 30일·50건만 보관
- 저장 데이터 검증·용량 예외 처리·DOM 안전 생성으로 로컬 저장형 XSS 차단
- 실패 시 기존 작성 결과를 지우지 않도록 동작 보완
- Node 내장 테스트와 정적 문법 검사 추가

## 배포 전 필수 설정

Vercel 프로젝트의 Production 환경 변수에 아래 값을 설정합니다. 실제 비밀값은 `.env`나 저장소에 커밋하지 않습니다.

1. `OPENAI_API_KEY`
2. `UPSTASH_REDIS_REST_URL`
3. `UPSTASH_REDIS_REST_TOKEN`
4. `RATE_LIMIT_SALT` — 충분히 긴 무작위 서버 전용 문자열
5. `ALLOWED_ORIGINS` — 기본 공개 주소 외 출처가 필요할 때만 쉼표로 추가

운영 환경에서는 Upstash 설정이나 `RATE_LIMIT_SALT`가 없으면 `/api/write`가 `503 RATE_LIMIT_UNAVAILABLE`로 안전하게 차단됩니다. 메모리 기반 제한은 로컬 개발과 자동 테스트에서만 사용됩니다.

## 기본 제한값

- 동일 이용자 식별값 기준 60초에 10회
- `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_SECONDS`로 조정 가능
- IP 원문은 저장하지 않고 `RATE_LIMIT_SALT`를 이용한 HMAC-SHA256 값만 제한 키로 사용

## 로컬 검증

Node.js 18 이상에서 다음을 실행합니다.

```text
npm run check
npm test
```

자동 테스트는 실제 OpenAI 또는 Upstash로 요청하지 않고 모의 응답을 사용합니다.

## 배포 확인 순서

1. Vercel 환경 변수를 설정하고 Production으로 배포
2. `https://<Vercel 주소>/api/health`가 `{"ok":true,"service":"lumen-api"}`만 반환하는지 확인
3. GitHub Pages에서 글 생성·수정·재시도 확인
4. 허용하지 않은 Origin 요청이 `403`인지 확인
5. 제한 초과 시 `429`와 `Retry-After`가 반환되는지 확인
6. 브라우저 개발자 도구에서 외부 API 응답이 서비스 워커 캐시에 들어가지 않는지 확인

## 중요한 운영 조건

이 패키지는 코드 수준의 보안 보완본입니다. 실제 공개 전에는 Vercel 환경 변수 설정, Upstash 생성, Production 재배포, GitHub Pages 연결 확인이 반드시 필요합니다. `OPENAI_API_KEY`, Upstash 토큰, `RATE_LIMIT_SALT`는 모두 서버 환경 변수로만 관리하세요.
