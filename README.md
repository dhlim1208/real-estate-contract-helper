# 부동산 계약서 AI 분석 서비스

임차인이 부동산 서류(등기부등본·계약서·건축물대장)를 업로드하면 AI가 권리관계 위험을 분석하고, 보호 특약이 자동 추가된 임시 계약서(.docx)를 생성합니다.

## 빠른 시작

`index.html` 을 브라우저로 열기만 하면 바로 동작합니다. 별도의 빌드·설정·서버 실행 불필요.

```bash
# 방법 1: 바로 열기
open index.html        # macOS
start index.html       # Windows

# 방법 2: 정적 서버로 띄우기 (권장 — file:// 접근 시 일부 브라우저 제약 회피)
python3 -m http.server 8000
# 또는: npm run serve
# 브라우저: http://localhost:8000
```

> 백엔드 프록시는 미리 배포된 공용 데모 서버를 사용하도록 기본 설정되어 있습니다.
> 별도의 Vercel 배포·API 키 발급 없이 바로 분석을 시도할 수 있습니다.
>
> ⚠️ 공용 데모 프록시는 Anthropic 무료 체험 크레딧 소진 시 동작이 중단됩니다.
> 장기 운영이 필요하면 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) 참고하여 본인 프록시를 띄우세요.

## 프로젝트 구조

```
real-estate-contract-helper/
├── index.html                # 메인 — 추출·분석·계약서 생성 로직 모두 포함
├── contractsample.docx       # 계약서 템플릿 (index.html 이 같은 폴더에서 로드)
├── README.md
├── LICENSE
├── package.json              # 편의 스크립트 (npm run serve 등)
│
├── proxy/                    # Vercel Serverless Functions (참고용 + 자체 운영용)
│   ├── api/
│   │   ├── claude.js         # Anthropic API 프록시 (키 보호·CORS)
│   │   └── realestate.js     # 국토부 실거래가 API 프록시 (CORS·집계)
│   ├── package.json          # 프록시 메타데이터·Node 버전(>=18) 명시 (의존성 없음)
│   ├── vercel.json           # Vercel 배포 설정 (리전 iad1, 함수 타임아웃 60초)
│   └── .env.example          # 환경변수 템플릿 — .env.local 로 복사 후 키 입력
│
└── docs/
    ├── ARCHITECTURE.md       # 시스템 동작 흐름·환각 방지 패턴·보안 모델
    └── DEPLOYMENT.md         # GitHub Pages 게시·본인 프록시 띄우기
```

### 주요 파일 보충 설명

- **`index.html`** — 단일 HTML 파일에 모든 UI·로직이 들어있습니다. 외부 의존성은 CDN 스크립트(JSZip 등) 몇 개뿐이고 빌드 도구 불필요.
- **`contractsample.docx`** — `index.html` 이 페이지 로드 시 같은 폴더에서 상대 경로로 가져갑니다. 위치를 옮기면 `index.html` 의 `TEMPLATE_URL` 도 같이 수정해야 합니다.
- **`proxy/package.json`** — 외부 npm 의존성이 없어서 `dependencies` 비어 있음. 주된 역할은 ① 프로젝트 이름·버전 식별 ② Node 버전 제약 ③ Vercel 에게 "여기는 Node 프로젝트"라는 신호 전달.
- **`proxy/vercel.json`** — Vercel 함수 실행 환경을 지정. `regions: ["iad1"]` 은 Anthropic 차단 회피용(홍콩 등 일부 리전 차단됨), `maxDuration: 60` 은 Claude 이미지 분석 응답 시간 확보용.
- **`proxy/.env.example`** — 실제 키가 들어있는 `.env.local` 은 `.gitignore` 처리되어 커밋되지 않습니다. 로컬 개발 시 `cp .env.example .env.local` 후 값 입력. 운영 배포는 Vercel 대시보드의 Environment Variables 에 등록.

## 아키텍처 요약

```
[브라우저]
    ↓ HTTPS
[정적 호스팅 (GitHub Pages 등)]   ← index.html, contractsample.docx
    ↓ fetch
[공용 데모 프록시 (Vercel)]        ← API 키 보관, CORS 처리, iad1 리전
    ↓
[Anthropic Claude API] / [국토교통부 실거래가 API]
```

자세한 흐름은 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 참고.

## GitHub Pages 게시

1. GitHub 레포 → **Settings** → **Pages**
2. **Source**: `Deploy from a branch`
3. **Branch**: `main` / **Folder**: `/ (root)`
4. Save → 1~2분 후 `https://<유저명>.github.io/<레포명>/` 에서 동작

`index.html` 이 루트에 있어 별도 빌드·워크플로 없이 즉시 게시됩니다.

## 본인 프록시를 따로 띄우고 싶다면

`proxy/` 폴더에 그대로 동작하는 Vercel 배포용 코드가 있습니다. 자세한 절차는 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) 참고.

요약:
1. 본인 Vercel 계정에서 이 레포 import (Root Directory: `proxy`)
2. 환경변수 `ANTHROPIC_API_KEY`, `MOLIT_API_KEY` 등록
3. 발급된 URL을 `index.html` 의 `API_BASE_URL` 상수에 입력 (파일 상단 `<script>` 블록)

## 핵심 기능

- 등기부등본 신탁/근저당/소유자 유형(국가·지자체·법인) 자동 감지
- 국토부 실거래가 + 웹 교차검증으로 깡통전세 위험 평가
- 5개 평가지표(임대인 신뢰도/권리 안전성/계약 조건/특약 완성도/서류 완비) 점수화
- 누락 필수 특약 자동 보완 (근저당 말소·신탁 동의·소유권 변동 통지 등)
- 원본 docx 양식을 유지하면서 빈칸만 채우는 계약서 생성

## 기술 스택

- **프론트엔드**: 단일 HTML + Vanilla JS (의존성 0)
- **백엔드**: Vercel Serverless Functions (Node.js 18+)
- **AI**: Anthropic Claude Sonnet 4 (Vision)
- **외부 API**: 국토교통부 아파트 실거래가 공공데이터

## 알려진 제약

- Vercel Hobby 플랜 함수 실행시간 60초 (대용량 서류 분석 시 타임아웃 가능)
- Claude API 이미지당 5MB 제한 (3MB까지 PDF 직접 지원, 이상은 자동 압축)
- 공용 데모 프록시의 Anthropic 무료 체험 크레딧 소진 시 분석 불가

## 라이선스

MIT
