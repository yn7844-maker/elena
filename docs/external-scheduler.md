# 무료 외부 예약 연결: cron-job.org → GitHub Actions

이 문서는 연결을 위한 준비이며, 파일을 올린 것만으로 cron-job.org에 작업이 등록되지는 않습니다. 사용자가 계정과 토큰을 설정해야 합니다.

## 작동 방식과 한계

```text
cron-job.org (한국 시간 07·08·09·10·11·15·18·21시)
  → GitHub API에 예약 수집 요청 (204 응답)
  → GitHub Actions 실행 대기 → 실제 한국 시각 기록
  → 늦어져도 네이버 API → Neon 저장 → Vercel 화면에서 조회
  → 정각보다 5분 초과 지연 시 경고만 기록 (수집은 계속)
```

GitHub 자체 cron 대신 외부 서비스가 요청합니다. **GitHub 실행 대기는 여전히 남으므로 정각 실행·정각 완료를 보장하지 않습니다.** 무료 우선으로 지연 가능성을 감수하는 방식입니다. 별도 상시 서버는 만들지 않습니다. cron-job.org 가입 시 기본 무료 기능의 제공 조건을 확인하고, GitHub Actions·Neon·네이버 API의 기존 사용 한도도 확인하세요. 외부 서비스에서 204 성공은 요청 접수 성공일 뿐 실제 수집 성공이 아닙니다. 수집 결과는 GitHub Actions에서 확인합니다.

## 1. GitHub 호출용 토큰 만들기

네이버 API 키나 DATABASE_URL을 cron-job.org에 넣지 않습니다. GitHub 수집 실행 권한만 가진 별도 토큰을 사용합니다.

1. GitHub 오른쪽 프로필 → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. 이름은 `news-collector-cron`, 만료일은 관리할 수 있는 기간으로 정합니다. 만료 후에는 새 토큰으로 외부 서비스의 헤더를 갱신해야 합니다.
3. **Resource owner**는 `yn7844-maker/elena` 저장소를 소유한 계정/조직을 선택합니다. 조직 승인 대상이면 승인 완료가 필요합니다.
4. **Repository access → Only select repositories → elena**.
5. **Repository permissions → Actions → Read and write**. Metadata 읽기는 기본 권한입니다. Contents 쓰기 권한은 추가하지 않습니다.
6. Generate token 후 복사하여 아래 cron-job.org 설정에 직접 입력합니다. 토큰을 채팅·코드·커밋·URL에 넣지 마세요.

토큰 화면: https://github.com/settings/personal-access-tokens

## 2. cron-job.org 예약 만들기

https://cron-job.org 에서 가입·로그인하고 콘솔의 **CREATE CRONJOB**을 선택합니다. 화면 언어나 버전에 따라 탭 이름이 다를 수 있습니다.

- 제목: `오늘의 뉴스 수집`
- URL: `https://api.github.com/repos/yn7844-maker/elena/actions/workflows/collect.yml/dispatches`
- 활성화: 켬
- 시간대: **Asia/Seoul**
- 실행 일정: 사용자 지정, 매일, 아래 8개 시각만 선택합니다.

```text
07:00 / 08:00 / 09:00 / 10:00 / 11:00 / 15:00 / 18:00 / 21:00
```

시간 선택 화면에서는 **Hour: 7,8,9,10,11,15,18,21**, **Minute: 0**, 일·월·요일은 모두 선택합니다. cron 표현식 입력을 지원하는 화면이면 `0 7,8,9,10,11,15,18,21 * * *`입니다. 이 표현식은 **Asia/Seoul을 선택했을 때** 기준입니다. ‘매분’으로 저장하지 마세요. 저장 후 다음 실행 시각이 위 목록과 맞는지 확인합니다.

고급 요청 설정에서 **Request method: POST**로 변경하고 헤더를 추가합니다.

| 헤더 이름 | 값 |
|---|---|
| Authorization | `Bearer 여기에_발급한_GitHub_토큰` |
| Accept | `application/vnd.github+json` |
| Content-Type | `application/json` |
| X-GitHub-Api-Version | `2022-11-28` |
| User-Agent | `elena-news-scheduler` |

Authorization은 글자 `Bearer`, 공백 한 칸, 실제 토큰 순서입니다. 표의 설명용 문자열 자체를 입력하지 않습니다.

**Request body**에는 다음 JSON을 그대로 넣습니다.

```json
{"ref":"main","inputs":{"scheduled":true}}
```

응답 본문이 없어도 **HTTP 204**이면 GitHub가 실행 요청을 접수한 것입니다. 외부 서비스의 실패 알림을 켜 두면 토큰 만료·권한 오류를 확인하는 데 도움이 됩니다. 수집이 끝날 때까지 HTTP 연결을 유지하는 구조가 아닙니다.

## 3. 연결 확인

- 외부 서비스의 테스트 버튼으로 요청을 한 번 보냅니다. HTTP 204 이후 **실제 네이버 수집이 즉시 시작됩니다.** 지정 시각 밖이라도 지연 경고만 남기고 실행합니다. 요청 본문의 `scheduled`는 계속 `true`로 유지합니다.
- 실제 예약 확인은 지정 시각에 **GitHub → elena → Actions → Collect news**에서 확인합니다. 실행 이벤트는 `workflow_dispatch`로 표시되지만 로그가 `예약 수집 시작`이면 지연을 진단하는 외부 예약입니다.
- Actions 실행이 성공하고 대시보드의 최근 수집 완료가 바뀌는 것까지 확인합니다. 완료 시각은 시작 시각보다 늦습니다. 화면의 새로고침으로 DB를 다시 읽을 수 있습니다.

## 4. 외부 예약 확인 후 GitHub 자체 예약 끄기

처음에는 기존 예약을 유지합니다. 두 방식이 겹치는 기간에는 두 번 수집될 수 있으므로 연결 확인 후 바로 전환합니다.

**GitHub 저장소 → Settings → Secrets and variables → Actions → Variables 탭 → New repository variable**.

| 항목 | 값 |
|---|---|
| Name | `COLLECTION_SCHEDULER` |
| Value | `external` |

**Secret이 아니라 Variable입니다.** 이후 GitHub 자체 schedule 이벤트의 수집 job은 건너뛰고, 외부 호출과 Run workflow 수동 실행은 유지합니다. 워크플로 전체를 Disable하면 외부 호출도 막히므로 Disable workflow는 누르지 않습니다. Vercel에 이 변수를 추가하거나 Redeploy할 필요는 없습니다.

외부 서비스에 문제가 생겨 기존 방식으로 돌아가려면 cron-job.org 작업을 먼저 비활성화하고 이 GitHub 변수를 삭제합니다.

## 오류 확인

- **401**: 토큰 값·만료 확인.
- **403**: Actions 쓰기 권한, 선택 저장소, 조직 승인, GitHub Actions 사용 한도 확인.
- **404**: 저장소 접근 권한, URL, workflow 파일 이름 확인.
- **422**: ref `main`, JSON, `scheduled` 입력 이름 확인.
- **204인데 데이터가 안 바뀜**: GitHub Actions 실제 실행 로그 확인. 실행 대기, DB/API 오류는 HTTP 204로 판단할 수 없습니다.

공식 문서: https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event / https://cron-job.org/en/faq/

## 지연·실패 시 처리

- 늦은 시작은 중단 사유가 아닙니다. 이전의 ‘5분 초과 중단’은 제거했습니다.
- 네이버의 네트워크·서버 오류는 기존 수집기의 제한된 재시도를 사용합니다. 인증 오류는 키 수정이 필요합니다.
- 수집 실패 후 다음 실행은 최근 완료 기준 48시간을 겹쳐 조회합니다. 조회 한도 때문에 완전한 복구를 보장하지는 않습니다.
- GitHub job은 기존 25분 제한과 호출 예산을 유지합니다. 실행 대기·한도 소진·외부 서비스 자체 실패는 별도로 로그를 확인해야 합니다.
