# ELENA · 나만의 뉴스 아카이브

1~2명이 함께 사용하는 비밀번호 보호 뉴스 대시보드입니다. 금융·경제·사회·문화·기타 기사, 원문 링크, 공유 즐겨찾기·메모, 제목 주요 단어·급상승 단어, 네이버 검색어 트렌드를 제공합니다.

## 구조

```text
GitHub Actions (한국 시간 07:17 / 12:17 / 18:17 / 23:17 예정)
  → NAVER API HUB 뉴스 + 검색어 트렌드
  → Neon PostgreSQL에 저장
  → Vercel의 보호된 API → 대시보드
```

Vercel에서는 서버 파일에 데이터를 저장하지 않습니다. 별도 PostgreSQL이 필요합니다. DB는 Neon을 권장하며 Vercel과 같은 DB를 GitHub 수집 작업에서도 사용합니다. 저장소를 비공개로 바꾸어도 웹사이트가 자동으로 비공개가 되는 것은 아닙니다. 이 앱은 자체 비밀번호와 HttpOnly 서명 쿠키로 데이터 API를 보호합니다. 화면 HTML은 공개되어도 기사·메모·트렌드 데이터는 로그인해야 조회됩니다. 사용자별 계정은 없고 비밀번호·즐겨찾기·메모를 공유합니다.

## 1. 데이터베이스 준비

1. https://neon.com 에서 프로젝트를 생성합니다. 초기에는 무료 플랜을 검토하세요.
2. **Connect**에서 `postgresql://...`로 시작하는 **pooled connection string**을 복사합니다. `sslmode=require` 등 제공된 SSL 설정을 유지하세요.
3. 이 값을 아래 GitHub와 Vercel 양쪽의 `DATABASE_URL`로 입력합니다. 연결 문자열에는 비밀번호가 포함되므로 코드에 적지 않습니다.

테이블은 최초 수집/접속 시 자동 생성됩니다. DB 역할에는 테이블 생성 권한이 필요합니다. 무료 플랜의 용량·사용량 제한과 요금은 신청 화면에서 확인하세요.

## 2. 네이버 API 입력 위치 — GitHub Secrets

저장소 → **Settings → Secrets and variables → Actions → New repository secret**에서 아래 5개를 등록합니다.

| Secret 이름 | 넣을 값 |
|---|---|
| `DATABASE_URL` | 위 Neon DB 연결 문자열 |
| `NAVER_NEWS_CLIENT_ID` | API HUB **뉴스** Application의 Client ID |
| `NAVER_NEWS_CLIENT_SECRET` | API HUB **뉴스** Application의 Client Secret |
| `NAVER_TREND_CLIENT_ID` | API HUB **검색어 트렌드** Application의 Client ID |
| `NAVER_TREND_CLIENT_SECRET` | API HUB **검색어 트렌드** Application의 Client Secret |

API HUB 인증은 `X-NCP-APIGW-API-KEY-ID`, `X-NCP-APIGW-API-KEY` 헤더를 사용합니다. 서로 다른 Application이면 서로 다른 키를 입력합니다. 같은 키로 두 API를 사용할 권한이 있다면 같은 값을 각각 등록해도 됩니다. 일반 NCP 계정용 Access Key/Secret Key와 혼동하지 마세요.

이 구조에서 네이버 키는 **Vercel에 입력할 필요가 없습니다.** 수집은 GitHub Actions에서만 실행하고 Vercel은 저장된 DB를 읽습니다. 키를 프런트엔드, README, Git 커밋, `NEXT_PUBLIC_` 또는 `VITE_` 변수에 넣지 마세요.

## 3. 첫 수집 실행

1. GitHub **Actions → Collect news → Run workflow**를 클릭합니다.
2. 워크플로가 비활성화되어 있으면 먼저 활성화합니다.
3. 녹색 완료를 확인합니다. 오류가 나면 해당 작업의 마지막 로그를 확인하세요.
4. 이후 기본 브랜치에서 하루 4회 예약 실행됩니다. GitHub 예약 작업은 지연·누락될 수 있으며 정시 실행을 보장하지 않습니다. 공개 저장소는 60일간 활동이 없으면 예약이 비활성화될 수 있습니다. 비공개 저장소는 Actions 사용 시간에 따라 요금/한도가 적용될 수 있습니다.

뉴스 검색어와 트렌드 비교 그룹은 `lib/config.mjs`에서 바꿉니다. 초기 설정은 주제별 4개씩 총 20개 검색어, 검색어당 최대 10페이지(1,000개), 트렌드 1요청입니다. 실행당 최대 201회 요청(재시도 제외)이며 페이지가 먼저 끝나면 줄어듭니다. 트렌드는 완료된 어제까지 최근 30일, 고정 5개 그룹을 한 요청으로 비교합니다.

## 4. Vercel 배포

1. https://vercel.com → **Add New → Project → Import Git Repository**에서 이 저장소를 선택합니다.
2. **Framework Preset: Other**, **Root Directory: 저장소 루트**.
3. Build Command는 비워두고, Output Directory는 기본값(루트), Install Command는 `npm ci --omit=dev --ignore-scripts`로 설정합니다.
4. 환경 변수(Environment Variables)에 다음 3개를 입력합니다. Production에 적용하고, Preview 환경에서도 사용할 경우 별도로 선택합니다.

| Vercel 변수 이름 | 넣을 값 |
|---|---|
| `DATABASE_URL` | GitHub에 넣은 것과 동일한 Neon 연결 문자열 |
| `ARCHIVE_PASSWORD` | 대시보드 입장 비밀번호. **임의의 20자 이상** 권장 |
| `SESSION_SECRET` | 쿠키 서명용 키. 비밀번호와 다른 **임의의 32자 이상** |

두 임의 값은 비밀번호 관리자로 생성하거나 로컬에서 각각 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`를 실행해 생성할 수 있습니다. `SESSION_SECRET`은 사용자에게 공유하지 않습니다.

5. Deploy를 누릅니다. 발급된 HTTPS 주소를 열고 `ARCHIVE_PASSWORD`로 로그인합니다.
6. 함께 사용할 사람에게 주소와 입장 비밀번호만 전달합니다.

환경 변수 변경 후에는 **Deployments → Redeploy**해야 새 값이 적용됩니다. `SESSION_SECRET` 변경 시 기존 로그인 쿠키는 모두 무효화됩니다. 비밀번호 변경 시 기존 로그인도 끊으려면 서명 키도 함께 변경하세요. 세션은 최대 7일입니다.

네이버 API HUB를 쓰기 위해 네이버 클라우드 서버를 생성할 필요는 없습니다. Vercel/Neon/GitHub Actions/API HUB 비용은 각각 별도이며 무료 플랜 조건과 유료 전환 공지를 확인하세요.

## 화면 사용법

- 왼쪽 주제, 기간, 제목·설명 검색으로 기사와 주요 단어를 필터링합니다.
- 주요 단어를 누르면 해당 단어로 기사 목록을 검색합니다.
- 기사 제목을 누르면 설명문·공유 메모·원문 링크를 볼 수 있습니다. 전문 수집은 하지 않습니다.
- 별표를 누르면 즐겨찾기에 저장합니다. 저장한 기사도 선택 기간이 적용됩니다. 오래된 기사는 전체 기간 필터에서 확인하세요.
- 뉴스 필터는 기사 및 주요/급상승 단어에 적용됩니다. 검색 관심도 그래프는 별도로 고정한 5개 그룹의 최근 30일입니다.
- 새로고침은 DB를 다시 읽습니다. 즉시 수집하려면 GitHub Actions의 Run workflow를 사용합니다.

## 분석 기준과 한계

- 기사는 원문 URL을 우선 식별자로 사용합니다. 원문 URL이 없으면 네이버 링크를 사용합니다. URL은 임의로 재작성하지 않습니다.
- 같은 URL 재수집 시 제목·설명을 갱신하고 즐겨찾기·메모는 유지합니다. 여러 검색어·주제 연결을 별도 테이블에 보존합니다.
- 초기에는 **2026년 10월 26일 00:00(한국 시간)**부터 조회합니다. 이후 겹침 조회도 이 시작일 이전으로 내려가지 않습니다. 대시보드와 분석에서도 시작일 이전의 기사는 제외합니다. 기존에 저장된 이전 기사는 삭제하지 않습니다. 이후 최근 완료 시점부터 48시간 겹쳐 조회하며 검색어당 최대 1,000개로 제한합니다. 네이버 검색의 범위·조회 제한 때문에 전체 뉴스 수집을 보장하지 않습니다.
- 주제는 수집 검색어 기준입니다. 기사 하나가 여러 주제에 포함될 수 있습니다. AI 내용 분류는 적용하지 않았습니다.
- 주요 단어는 **제목의 한글/영문 단어를 단순 추출**하고 일부 불용어를 제외한 기사 수입니다. 한국어 형태소 분석·동의어 통합은 적용하지 않았습니다. 조사나 어미가 남을 수 있습니다.
- 급상승은 최근 24시간 언급 기사 비율에서 직전 7일 비율을 뺀 %p입니다. 최근 최소 3건, 최초 수집 8일 이후부터 표시합니다. 필터와 최대 5,000건 분석 한도가 적용됩니다. 수집 누락·검색어 변경은 지표에 영향을 줍니다. 전체 대중 관심도나 사건별 중복 제거 지표가 아닙니다.
- 검색어 트렌드는 같은 요청 내 최대 검색량을 100으로 정규화한 상대 지수입니다. 실제 검색 횟수가 아닙니다. 요청별 결과를 합치지 않고 최신 요청 전체를 보존·표시합니다. 누락된 날짜는 0으로 채우지 않습니다.
- 조회 기간은 현재부터 최근 N×24시간이며 화면 날짜는 한국 시간입니다. API pubDate는 네이버 제공 시각(미제공 기사는 원문 제공 시각)입니다.
- 기사 화면과 분석은 최신 최대 5,000건입니다. 초과 시 경고합니다. DB에는 계속 축적되므로 기간을 좁히거나 추후 서버 페이지네이션을 추가할 수 있습니다.
- 기사/메모는 자동 삭제하지 않습니다. 트렌드 요청 스냅샷은 90일 보존합니다. DB 백업과 용량 관리는 Neon에서 설정하세요.

## 로컬 실행 및 검증

Node.js 22 이상을 사용합니다.

```bash
npm install
npm test
# .env.example을 .env로 복사하고 로컬에서만 값 입력
node --env-file=.env scripts/setup.mjs
node --env-file=.env scripts/collect.mjs
# 로컬 API 확인은 Vercel CLI 사용 (HTTPS 쿠키는 운영 환경에서 확인)
npx vercel dev
```

쿠키는 `Secure`를 사용하므로 로컬 HTTP 로그인에는 제약이 있습니다. 실제 로그인·즐겨찾기·메모는 HTTPS Preview 배포에서 확인하세요. 배포 후 로그인 전 API가 401인지, 비밀번호 인증 후 읽기와 저장이 되는지, Actions 수집 후 새 기사가 나타나는지 확인하세요.

## 공식 문서

- [뉴스 검색 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-news)
- [검색어 트렌드 API](https://api.ncloud-docs.com/docs/naver-api-hub-search-trend)
- [Vercel Functions](https://vercel.com/docs/functions)
- [GitHub 예약 워크플로](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 파일

`index.html`, `style.css`, `app.js`: 화면 / `api/index.mjs`: 인증·기사 API / `lib/`: DB·분석·네이버 연동 / `scripts/collect.mjs`: 수집 / `.github/workflows/`: 자동 수집·테스트 / `.env.example`: 입력값 설명.

수집 진행 로그는 검색어·페이지·저장 처리 건수·경과 시간을 표시합니다. 페이지의 최대 100개 기사를 한 SQL 문으로 일괄 저장하므로 기사별 DB 왕복을 줄였습니다. 검색 결과 1,000개 한도 도달은 누락 가능성을 경고하지만 실행 자체를 실패로 처리하지 않습니다.
