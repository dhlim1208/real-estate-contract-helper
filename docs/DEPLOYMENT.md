# 배포 가이드

## 기본 동작

`index.html` 은 미리 배포된 공용 데모 프록시(`https://realestate-proxy-vercel.vercel.app`)를 사용합니다. 이 URL은 `index.html` 내 `API_BASE_URL` 상수에 직접 박혀 있어 별도 설정 없이 바로 동작합니다.

따라서 일반적인 사용은 다음 두 가지 중 하나면 충분합니다:

1. **로컬에서 그냥 사용** — `index.html` 을 브라우저로 열거나 `npm run serve`
2. **정적 호스팅 게시** — 레포 루트의 파일을 그대로 GitHub Pages, Cloudflare Pages, Netlify 등에 게시

이 경우 추가 설정·환경변수·키 발급이 전혀 필요 없습니다.

### GitHub Pages 로 게시하기

`index.html` 이 레포 루트에 있어 GitHub Pages 기본 호스팅으로 즉시 게시 가능합니다.

1. GitHub 레포 → **Settings** → **Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` 선택, **Folder**: `/ (root)` 선택
4. Save → 1~2분 후 `https://<유저명>.github.io/<레포명>/` 에서 동작

이후 main 에 push 하면 자동 재배포됩니다. 캐시 문제로 변경이 늦게 반영되면 브라우저에서 강력 새로고침(Ctrl+Shift+R) 하세요.

### Cloudflare Pages / Netlify 로 게시하기

이쪽도 추가 설정 거의 없이 바로 됩니다.

- **Cloudflare Pages**: 새 프로젝트 → Git 연결 → 빌드 명령·출력 디렉터리 모두 비워두기
- **Netlify**: 새 사이트 → Git 연결 → Publish directory 비워두거나 `.` 입력

빌드 도구가 없어 정적 파일을 그대로 서빙하면 끝.

## 본인 프록시를 따로 띄울 때 (선택)

다음 경우에 해당하면 본인의 Vercel 프록시가 필요합니다:

- 공용 데모 프록시의 Anthropic 무료 크레딧이 소진된 이후
- 사내 전용 프록시로 운영하고 싶을 때
- 프록시 코드를 수정해 자체 운영하고 싶을 때

### 준비물

1. **Vercel 계정** — <https://vercel.com/signup> (GitHub 로그인 가능, 무료)
2. **Anthropic API 키** — <https://console.anthropic.com/> → API Keys
3. **국토부 API 키 (Encoding 키)** — <https://www.data.go.kr/> → "아파트매매 실거래가 자료" 활용신청

신규 가입자는 Anthropic 가입 시 $5 무료 크레딧이 있어 약 250회 분석 가능합니다.

### 배포 절차 (Vercel 대시보드)

1. <https://vercel.com/new> 접속
2. **Import Git Repository** → 이 레포 선택
3. **Configure Project**:
   - **Framework Preset**: `Other`
   - **Root Directory**: `proxy` ← ⚠️ 반드시 이 폴더 지정
   - Build/Install Command 비워두기
4. **Environment Variables** 추가:
   ```
   ANTHROPIC_API_KEY = sk-ant-api03-...
   MOLIT_API_KEY     = (국토부 발급 인증키)
   ```
5. **Deploy** → 1~2분 후 본인 URL 발급 (예: `https://your-proxy.vercel.app`)

### CLI로 배포 (대안)

```bash
npm install -g vercel
cd proxy
vercel login
vercel --prod
```

배포 후 Vercel 대시보드에서 환경변수 등록 → Redeploy.

### 프론트엔드를 본인 프록시에 연결

`index.html` 파일 상단 `<script>` 블록에서 `API_BASE_URL` 상수를 본인 URL로 변경하세요. 검색하면 한 번에 찾을 수 있습니다.

```javascript
// 변경 전 (공용 데모 프록시)
const API_BASE_URL = 'https://realestate-proxy-vercel.vercel.app';

// 변경 후 (본인 프록시)
const API_BASE_URL = 'https://your-proxy.vercel.app';
```

수정 후 정적 호스팅에 다시 올리면 적용됩니다.

### 동작 확인

본인 프록시 URL 뒤에 `/api/claude` 를 붙여 브라우저로 접속:
- 정상: `405 Method Not Allowed` 등 (POST만 허용하므로 GET 거부 = 정상)
- `404 Not Found`: Root Directory 설정이 잘못된 것 → `proxy` 로 변경
- `ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다`: 환경변수 등록 후 Redeploy 필요

## 흔한 실수

| 증상 | 원인 | 해결 |
|---|---|---|
| `404 Not Found` | Root Directory 가 `proxy` 가 아님 | Vercel Project Settings에서 변경 |
| 환경변수가 안 먹힘 | 등록 후 재배포 안 함 | Redeploy 클릭 |
| `403 forbidden` (Anthropic) | 리전이 `iad1` 이 아님 | `vercel.json` 의 `regions` 확인 |
| `504 Gateway Timeout` | 60초 한도 초과 | 큰 서류는 PDF→이미지 변환, 또는 Pro 플랜 |

## 운영 비용 (참고)

- **Anthropic**: 1회 분석 약 ₩280~350 (Sonnet 4 기준)
- **Vercel Hobby**: 무료 (월 100GB 대역폭, 100GB-Hours 함수)
- **국토부 API**: 일 1,000회 무료
