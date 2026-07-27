# Lumen AI v1.0

스마트폰에서 배포 주소만 열어 사용하는 최소형 AI 글쓰기 웹앱입니다.

## 기능

1. 글쓰기 요청 입력
2. AI가 완성된 글 생성
3. 결과 복사

로그인, 저장, 카테고리, 번역, 요약, 결제, 광고는 포함하지 않았습니다.

---

## 가장 쉬운 배포 방법: Vercel

### 1. GitHub에 업로드

압축을 푼 뒤 폴더 안의 파일 전체를 새 GitHub 저장소에 업로드합니다.

주의: `lumen-ai-deploy` 폴더 자체가 아니라 그 안의 파일들이 저장소 최상단에 있어야 합니다.

### 2. Vercel에서 프로젝트 만들기

1. Vercel에 로그인합니다.
2. `Add New` → `Project`를 누릅니다.
3. 방금 만든 GitHub 저장소를 선택합니다.
4. 별도 빌드 설정 없이 배포합니다.

### 3. 환경변수 설정

Vercel 프로젝트에서 다음 경로로 이동합니다.

`Settings → Environment Variables`

다음 값을 추가합니다.

- 이름: `OPENAI_API_KEY`
- 값: 본인의 OpenAI API 키

선택 설정:

- 이름: `OPENAI_MODEL`
- 값: `gpt-5-mini`

환경변수를 추가한 뒤 `Deployments`에서 최신 배포를 다시 배포해야 적용됩니다.

### 4. 스마트폰에서 실행

Vercel이 발급한 주소를 스마트폰 브라우저에서 열면 됩니다.

예:

`https://프로젝트이름.vercel.app`

HTML 파일을 직접 열지 마세요. 주소가 `content://`로 시작하면 AI 서버 기능이 작동하지 않습니다.

---

## 파일 구조

```text
public/
  index.html
  manifest.webmanifest
  icon.svg
  sw.js
api/
  write.js
vercel.json
package.json
.gitignore
README.md
```

## 보안

- OpenAI API 키는 브라우저 코드에 포함하지 않습니다.
- 키는 Vercel 환경변수에만 저장됩니다.
- `.env`와 API 키를 GitHub에 올리지 마세요.

## 비용 관리

OpenAI API 사용량에 따라 비용이 발생합니다. 출시 전 OpenAI 대시보드에서 사용 한도와 결제 설정을 확인하세요.
