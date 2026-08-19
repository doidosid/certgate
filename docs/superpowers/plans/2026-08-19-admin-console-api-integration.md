# Admin Console API 연결 구현 계획 (Issue #7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React 관리 콘솔의 5개 화면을 실제 Management API에 연결하고, CRITICAL Security Event를 전역 Toast로 실시간 알린다.

**Architecture:** Console은 nginx(운영)·Vite dev server(개발)의 `/api` reverse proxy를 통해 Management API를 **same-origin으로** 호출한다. 따라서 CORS 설정을 추가하지 않고, Management API Port를 Host에 공개하지 않아도 된다. 화면은 `pages`(URL 조립) → `features/*`(도메인별 API·Query·Label) → `shared/api`(HTTP Client·Type) 3계층으로 나누고, 페이지에 fetch 호출과 Enum 변환을 흩뿌리지 않는다(repository-structure.md "React Console"). Mock은 MSW로 HTTP 계층에서 가로채 실제 Client·오류 파싱·로딩 상태를 그대로 통과시킨다.

**Tech Stack:** React 19, TypeScript 6 (strict), Vite 8, MUI 9, TanStack Query 5, React Router 7, Vitest 4 + Testing Library, MSW (신규 의존성). 서버 측 추가 작업은 Java 21 / Spring Boot 3.

**Spec:**
- [docs/ui-design.md](../../ui-design.md) — 화면 구성, Critical 알림 동작
- [docs/api-spec.md](../../api-spec.md) §3~§10 — DTO, 상태 코드, Reason Code
- [docs/repository-structure.md](../../repository-structure.md) "React Console" — 디렉터리 책임
- [Issue #7](https://github.com/doidosid/certgate/issues/7) — 완료 기준

---

## Global Constraints

- TypeScript는 `strict`이며 **`any` 금지**다(development-guide.md 코딩 규칙). 불가피하면 `unknown` + 좁히기를 쓴다.
- **API Type과 화면 Type을 구분한다.** `shared/api/types.ts`는 서버 JSON 그대로를 표현하고(대문자 Enum, ISO 문자열, `| null`), 한국어 라벨·표시용 변환은 `features/*/labels.ts`에서 한다.
- Enum은 API에서 **영문 대문자**로 오고 Console에서 한국어로 변환한다(api-spec.md §1).
- 목록 기본값은 `page=0`, `size=20`, 최대 `size=100`이다(api-spec.md §1).
- 시간은 UTC ISO 8601로 오고 화면에는 로컬 시간으로 표시한다.
- 오류 응답은 항상 `{code, message, traceId, fieldErrors[]}`다. **사용자에게 보여줄 Message와 내부 Reason Code를 분리한다** — 화면에는 `message`를, 진단용으로 `traceId`를 함께 노출한다.
- **표시 금지**: Private Key, Enrollment Token 평문(발급 응답 1회 표시는 예외), Certificate 전체 원문, 전체 CSR 원문, 전체 Telemetry Payload (ui-design.md §5, §7 / security-design.md §10).
- **구현하지 않은 동작은 비활성 또는 숨김 처리한다**(Issue #7 완료 기준). 동작하지 않는 버튼을 남기지 않는다.
- 별도 Alert 화면·Alert 상태 관리를 만들지 않는다. CRITICAL은 Toast + Security Event 화면이 전부다(ui-design.md §1).
- 물리 삭제 UI를 제공하지 않는다(ui-design.md §4).
- Branch 전략(CLAUDE.md): Console 코드 → `feature/console`, Java → `feature/management-api`, nginx·compose·env → `infra`, 문서 → `docs`. `main` 직접 Commit 금지. PR → Codex 리뷰 → 사용자 승인 → Merge.

### 서버 API 현황 (2026-08-19 기준, 실제 코드 확인)

Base path는 `/api/v1`이며 `server.servlet.context-path`가 아니라 각 Controller의 클래스 레벨 `@RequestMapping`에서 온다. **CORS 설정은 저장소 어디에도 없다.**

구현 완료(Console이 바로 쓸 수 있음):

| Method | Path | 비고 |
|---|---|---|
| POST | `/api/v1/devices` | 201 + `Location` |
| GET | `/api/v1/devices` | `query,status,roleName,page,size,sort` |
| GET | `/api/v1/devices/{deviceId}` | 인증서·정책·최근 Event 포함 |
| PATCH | `/api/v1/devices/{deviceId}/status` | |
| PUT | `/api/v1/devices/{deviceId}/role` | |
| POST | `/api/v1/devices/{deviceId}/enrollment-token` | 요청 본문 없음 |
| GET | `/api/v1/certificate-requests` | `status,deviceId,page,size` |
| GET | `/api/v1/certificate-requests/{requestId}` | `csrPem` 미포함 |
| POST | `/api/v1/certificate-requests/{requestId}/approve` | 본문 생략 가능 |
| POST | `/api/v1/certificate-requests/{requestId}/reject` | 본문 생략 가능 |
| GET | `/api/v1/certificates` | `status,deviceId,expiresBefore,page,size` |
| GET | `/api/v1/certificates/{certificateId}` | |
| GET | `/api/v1/certificates/{certificateId}/download` | `application/x-pem-file`, 본문이 PEM 문자열 |
| POST | `/api/v1/certificates/{certificateId}/revoke` | |
| GET | `/api/v1/security-events` | `from,to,deviceId,decision,reasonCode,severity,page,size` |
| GET | `/api/v1/security-events/{eventId}` | |
| GET | `/api/v1/security-events/stream` | SSE, 이벤트명 `critical-security-event` |

**미구현이라 이 계획에서 함께 만든다:**

| Method | Path | 필요한 이유 |
|---|---|---|
| GET | `/api/v1/roles` | Device Role 필터·변경 Select의 선택지 (api-spec.md §6) |
| GET | `/api/v1/dashboard/summary` | Dashboard 전체 (api-spec.md §9) |

---

## File Structure

### admin-console (Branch `feature/console`)

```text
src/
├─ app/
│  ├─ queryClient.ts                 (기존)
│  ├─ router.tsx                     (기존)
│  ├─ routes.tsx                     (수정: 상세 Route 추가)
│  └─ CriticalEventProvider.tsx      (신규: SSE 연결·재연결 보완 조회)
├─ pages/                            (URL 단위 조립만. fetch·Enum 변환 금지)
│  ├─ DashboardPage.tsx              (수정)
│  ├─ DevicesPage.tsx                (수정)
│  ├─ DeviceDetailPage.tsx           (신규)
│  ├─ CertificateRequestsPage.tsx    (수정)
│  ├─ CertificatesPage.tsx           (수정)
│  └─ SecurityEventsPage.tsx         (수정)
├─ features/
│  ├─ device/{api.ts,queries.ts,labels.ts,DeviceFilters.tsx,DeviceStatusActions.tsx,DeviceRegisterDialog.tsx}
│  ├─ certificateRequest/{api.ts,queries.ts,labels.ts,DecisionDialog.tsx}
│  ├─ certificate/{api.ts,queries.ts,labels.ts,RevokeDialog.tsx}
│  ├─ securityEvent/{api.ts,queries.ts,labels.ts,SecurityEventFilters.tsx}
│  └─ dashboard/{api.ts,queries.ts,SummaryCards.tsx,RequestTrend.tsx,ServiceHealth.tsx}
├─ shared/
│  ├─ api/{env.ts(기존),types.ts,ApiError.ts,client.ts,usePageParams.ts}
│  └─ ui/{AppLayout.tsx(기존),QueryState.tsx,DataTable.tsx,StatusChip.tsx,ConfirmDialog.tsx,PageHeader.tsx,DateTimeText.tsx}
└─ mocks/{fixtures.ts,handlers.ts,server.ts,browser.ts}
```

각 파일 책임:

- `shared/api/types.ts` — 서버 JSON 그대로의 Type. 이 파일만 서버 계약을 안다.
- `shared/api/client.ts` — fetch 래퍼. `X-Trace-Id` 생성, `ErrorResponse` 파싱, `ApiError` throw.
- `shared/api/usePageParams.ts` — URL Query String ↔ 페이지·필터 상태 동기화(새로고침·뒤로가기 보존).
- `shared/ui/QueryState.tsx` — 로딩·오류·빈 상태 3종을 한 곳에서 처리. 화면마다 다시 만들지 않는다.
- `shared/ui/DataTable.tsx` — 컬럼 정의 기반 표 + MUI `TablePagination`.
- `features/*/api.ts` — 해당 도메인 HTTP 호출만.
- `features/*/queries.ts` — TanStack Query key·hook.
- `features/*/labels.ts` — 대문자 Enum → 한국어 + Chip 색상.

### management-api (Branch `feature/management-api`)

```text
src/main/java/tech/certgate/
├─ policy/
│  ├─ RoleController.java            (신규) GET /api/v1/roles
│  └─ RoleResponse.java              (신규)
└─ dashboard/
   ├─ DashboardController.java       (신규) GET /api/v1/dashboard/summary
   ├─ DashboardService.java          (신규) 집계 조립
   ├─ DashboardSummaryResponse.java  (신규) 중첩 record
   └─ GatewayOutboxClient.java       (신규) Gateway GET /internal/outbox/stats 호출
```

### infra (Branch `infra`)

```text
infra/docker/admin-console/nginx.conf   (수정: /api reverse proxy)
infra/compose.yaml                      (수정: management-api Host Port 비공개)
admin-console/vite.config.ts            (수정: dev server proxy)
.env.example                            (수정: VITE_* 상대경로)
```

---

## 작업 순서와 PR 분할

| PR | Branch | Task | 목적 |
|---|---|---|---|
| 1 | `infra` | 1 | same-origin proxy — 이후 전부의 선행 |
| 2 | `feature/management-api` | 2, 12 | `GET /roles`, `GET /dashboard/summary` |
| 3 | `feature/console` | 3, 4, 5, 6, 7, 8 | 기반 + 읽기 화면 3개 |
| 4 | `feature/console` | 9, 10, 11 | 쓰기 동작 |
| 5 | `feature/console` | 13, 14 | Dashboard + SSE Toast |
| 6 | `docs` | 15 | README 실제 화면 교체 |

PR 2는 PR 5보다 먼저 Merge돼야 한다(Dashboard 화면이 그 API를 쓴다). PR 3·4는 PR 2와 독립이다.

날짜 기준(제출 8/23):

| 날짜 | 목표 |
|---|---|
| 8/19 | PR 1, PR 2 |
| 8/20 | PR 3 |
| 8/21 | PR 4, PR 5 |
| 8/22 | PR 6, Issue #4 E2E 착수 |
| 8/23 | 최종 검증·제출 |

---

### Task 1: same-origin `/api` Reverse Proxy

Console이 브라우저에서 `http://localhost:8080`을 직접 호출하면 cross-origin이 되는데 Management API에는 CORS 설정이 전혀 없다. 여기서 두 가지를 동시에 얻는다 — CORS 불필요, 그리고 관리 API Port를 Host에 열지 않는 배포(api-spec.md §2 "인터넷 공개 금지").

**Files:**
- Modify: `infra/docker/admin-console/nginx.conf`
- Modify: `admin-console/vite.config.ts`
- Modify: `.env.example:36-37`
- Modify: `infra/compose.yaml` (management-api `ports:` 제거)

**Interfaces:**
- Produces: 브라우저에서 `/api/v1/**`가 Management API로, `/api/v1/security-events/stream`이 SSE로 도달한다. `VITE_API_BASE_URL=/api/v1`, `VITE_SSE_URL=/api/v1/security-events/stream`.

- [ ] **Step 1: nginx에 proxy 추가**

`infra/docker/admin-console/nginx.conf`를 통째로 아래로 교체한다. SSE는 버퍼링을 끄고 read timeout을 늘리지 않으면 Toast가 지연되거나 연결이 끊긴다.

```nginx
server {
	listen 80;
	listen [::]:80;
	server_name _;
	root /usr/share/nginx/html;
	index index.html;

	location / {
		try_files $uri $uri/ /index.html;
	}

	# Console과 Management API를 same-origin으로 묶는다. CORS 설정 없이 동작하고
	# management-api Port를 Host에 공개하지 않아도 된다(docs/api-spec.md §2).
	location /api/ {
		proxy_pass http://management-api:8080/api/;
		proxy_http_version 1.1;
		proxy_set_header Host $host;
		proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
		proxy_set_header X-Forwarded-Proto $scheme;

		# SSE(/api/v1/security-events/stream): 버퍼링을 켜두면 이벤트가 모였다가
		# 나가고, 기본 60초 read timeout은 20초 heartbeat 사이에서도 연결을 끊는다.
		proxy_buffering off;
		proxy_cache off;
		proxy_read_timeout 3600s;
	}
}
```

- [ ] **Step 2: Vite dev server proxy 추가**

`admin-console/vite.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	// 개발 중에도 운영(nginx)과 같은 same-origin 경로를 쓰도록 /api를 그대로 넘긴다.
	server: {
		proxy: {
			"/api": {
				target: "http://localhost:8080",
				changeOrigin: false,
			},
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/setupTests.ts"],
	},
});
```

- [ ] **Step 3: `.env.example`을 상대 경로로 바꾸고 Port 공개를 줄인다**

`.env.example`의 36~37행:

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_SSE_URL=/api/v1/security-events/stream
```

`infra/compose.yaml`의 `management-api` 서비스에서 `ports:` 블록을 제거한다. `certgate-net` 안에서 gateway·admin-console이 서비스명으로 접근하므로 Host 공개가 필요 없다. `MANAGEMENT_API_PORT`는 컨테이너 내부 Listen Port로 계속 쓰인다.

- [ ] **Step 4: Compose 설정 검증**

Run: `docker compose -f infra/compose.yaml --env-file .env.example config`
Expected: 오류 없이 렌더링되고 `management-api` 서비스에 `ports` 항목이 없다.

- [ ] **Step 5: Console Build 확인**

Run: `cd admin-console && npm run typecheck && npm test && npm run build`
Expected: 전부 통과 (이 단계에서는 동작 변경이 없다).

- [ ] **Step 6: Commit**

```bash
git checkout infra && git merge --ff-only main
git add infra/docker/admin-console/nginx.conf infra/compose.yaml admin-console/vite.config.ts .env.example
git commit -m "infra(console): Management API를 same-origin /api proxy로 연결"
```

---

### Task 2: `GET /api/v1/roles` 구현

Device Role 필터와 Role 변경 Select가 선택지를 알아야 한다. 하드코딩은 Placeholder이므로 api-spec.md §6에 이미 정의된 계약을 구현한다.

**Files:**
- Create: `management-api/src/main/java/tech/certgate/policy/RoleController.java`
- Create: `management-api/src/main/java/tech/certgate/policy/RoleResponse.java`
- Modify: `management-api/src/main/java/tech/certgate/policy/PolicyService.java`
- Modify: `management-api/src/main/java/tech/certgate/policy/RoleRepository.java`
- Modify: `management-api/src/main/java/tech/certgate/policy/PolicyRuleRepository.java`
- Test: `management-api/src/test/java/tech/certgate/policy/RoleIntegrationTests.java`

**Interfaces:**
- Consumes: 기존 `RoleRepository`, `PolicyRuleRepository`.
- Produces: `GET /api/v1/roles` → `RoleResponse[]`, `GET /api/v1/roles/{roleName}` → `RoleResponse` (없으면 404 `ROLE_NOT_FOUND`).
  `RoleResponse = { name: String, rules: RuleView[] }`, `RuleView = { httpMethod, pathPattern, effect, priority }`.

- [ ] **Step 1: 실패하는 통합 테스트 작성**

`management-api/src/test/java/tech/certgate/policy/RoleIntegrationTests.java`:

```java
package tech.certgate.policy;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class RoleIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	/** docs/api-spec.md §6: Role과 규칙 목록. MVP는 Seed Data로 관리한다. */
	@Test
	void list_returnsSeededRolesWithRules() throws Exception {
		mockMvc.perform(get("/api/v1/roles"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$[0].name").exists())
				.andExpect(jsonPath("$[0].rules").isArray());
	}

	@Test
	void get_returnsRulesOrderedByPriority() throws Exception {
		mockMvc.perform(get("/api/v1/roles/SENSOR"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.name").value("SENSOR"))
				.andExpect(jsonPath("$.rules[0].priority").value(10));
	}

	@Test
	void get_unknownRole_returns404WithReasonCode() throws Exception {
		mockMvc.perform(get("/api/v1/roles/NO_SUCH_ROLE"))
				.andExpect(status().isNotFound())
				.andExpect(jsonPath("$.code").value("ROLE_NOT_FOUND"));
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd management-api && ./gradlew test --tests "*RoleIntegrationTests*"`
Expected: FAIL — `/api/v1/roles`가 404를 반환한다.

- [ ] **Step 3: `RoleResponse` 작성**

`management-api/src/main/java/tech/certgate/policy/RoleResponse.java`:

```java
package tech.certgate.policy;

import java.util.List;

/** docs/api-spec.md §6 "Policy API". */
public record RoleResponse(String name, List<RuleView> rules) {

	public record RuleView(String httpMethod, String pathPattern, String effect, int priority) {
	}
}
```

- [ ] **Step 4: Repository 조회 메서드 추가**

`RoleRepository`에 아래를 추가한다(이미 있으면 건너뛴다):

```java
	List<Role> findAllByOrderByNameAsc();
```

`PolicyRuleRepository`에 아래를 추가한다(이미 있으면 건너뛴다):

```java
	List<PolicyRule> findByRoleNameOrderByPriorityAsc(String roleName);
```

- [ ] **Step 5: `PolicyService`에 조회 메서드 추가**

도메인 간 직접 Repository 접근 대신 Service 경계를 쓰는 규칙(repository-structure.md)을 지킨다. `PolicyService`에 추가:

```java
	@Transactional(readOnly = true)
	public List<RoleResponse> findAllRoles() {
		return roles.findAllByOrderByNameAsc().stream().map(this::toRoleResponse).toList();
	}

	@Transactional(readOnly = true)
	public RoleResponse findRole(String roleName) {
		return roles.findByName(roleName)
				.map(this::toRoleResponse)
				.orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "ROLE_NOT_FOUND", "Role을 찾을 수 없습니다."));
	}

	private RoleResponse toRoleResponse(Role role) {
		List<RoleResponse.RuleView> rules = policyRules.findByRoleNameOrderByPriorityAsc(role.getName()).stream()
				.map(rule -> new RoleResponse.RuleView(
						rule.getHttpMethod(), rule.getPathPattern(), rule.getEffect(), rule.getPriority()))
				.toList();
		return new RoleResponse(role.getName(), rules);
	}
```

필드명(`roles`, `policyRules`)과 Getter 이름은 기존 `PolicyService`·`Role`·`PolicyRule` 코드를 먼저 읽고 실제 이름에 맞춘다.

- [ ] **Step 6: `RoleController` 작성**

`management-api/src/main/java/tech/certgate/policy/RoleController.java`:

```java
package tech.certgate.policy;

import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** docs/api-spec.md §6 "Policy API" — MVP는 조회만 제공하고 수정은 Seed Data로 관리한다. */
@RestController
@RequestMapping("/api/v1/roles")
public class RoleController {

	private final PolicyService policyService;

	public RoleController(PolicyService policyService) {
		this.policyService = policyService;
	}

	@GetMapping
	public List<RoleResponse> list() {
		return policyService.findAllRoles();
	}

	@GetMapping("/{roleName}")
	public RoleResponse get(@PathVariable String roleName) {
		return policyService.findRole(roleName);
	}
}
```

- [ ] **Step 7: 통과 확인**

Run: `cd management-api && ./gradlew test --tests "*RoleIntegrationTests*"`
Expected: PASS 3건.

- [ ] **Step 8: Commit**

```bash
git checkout feature/management-api && git merge --ff-only main
git add management-api/src/main/java/tech/certgate/policy management-api/src/test/java/tech/certgate/policy
git commit -m "feat(management-api): Role 조회 API 구현 (Issue #7 선행)"
```

---

### Task 3: API Type과 HTTP Client

이 계층만 서버 계약을 안다. 나머지 코드는 여기 정의된 Type만 본다.

**Files:**
- Create: `admin-console/src/shared/api/types.ts`
- Create: `admin-console/src/shared/api/ApiError.ts`
- Create: `admin-console/src/shared/api/client.ts`
- Test: `admin-console/src/shared/api/client.test.ts`

**Interfaces:**
- Produces:
  - `apiGet<T>(path: string, params?: QueryParams): Promise<T>`
  - `apiSend<T>(method: "POST" | "PUT" | "PATCH", path: string, body?: unknown): Promise<T>`
  - `apiGetText(path: string): Promise<string>` (PEM 다운로드용)
  - `ApiError { status: number; code: string; message: string; traceId: string; fieldErrors: FieldError[] }`
  - `types.ts`의 모든 Type (아래 Step 1 참조)

- [ ] **Step 1: `types.ts` 작성 — 서버 JSON 그대로**

`admin-console/src/shared/api/types.ts`:

```ts
// docs/api-spec.md의 응답 계약을 그대로 옮긴 Type. 화면 표시용 한국어 라벨과
// 파생 값은 features/*/labels.ts가 담당하고 여기서는 서버가 주는 모양만 표현한다.

export type DeviceStatus = "ACTIVE" | "DISABLED";
export type CertificateStatus = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "REVOKED";
export type CertificateRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export type Decision = "ALLOWED" | "DENIED" | "ERROR";
export type Severity = "INFO" | "WARNING" | "CRITICAL";

export interface PageResponse<T> {
	content: T[];
	page: number;
	size: number;
	totalElements: number;
	totalPages: number;
}

export interface FieldError {
	field: string;
	message: string;
}

export interface ErrorResponse {
	code: string;
	message: string;
	traceId: string;
	fieldErrors: FieldError[];
}

export interface RuleView {
	httpMethod: string;
	pathPattern: string;
	effect: string;
	priority: number;
}

export interface RoleResponse {
	name: string;
	rules: RuleView[];
}

export interface DeviceListItem {
	id: string;
	deviceKey: string;
	name: string;
	status: DeviceStatus;
	roleName: string;
	certificateStatus: CertificateStatus | null;
	certificateExpiresAt: string | null;
	lastSeenAt: string | null;
}

export interface DeviceCertificateSummary {
	id: string;
	serialNumber: string;
	status: CertificateStatus;
	expiresAt: string;
}

export interface DeviceEventView {
	id: string;
	occurredAt: string;
	type: string;
	severity: string;
	decision: string | null;
	reasonCode: string | null;
	httpMethod: string | null;
	requestPath: string | null;
}

export interface DeviceDetail {
	id: string;
	deviceKey: string;
	name: string;
	status: DeviceStatus;
	roleName: string;
	createdAt: string;
	lastSeenAt: string | null;
	certificate: DeviceCertificateSummary | null;
	policyRules: RuleView[];
	recentEvents: DeviceEventView[];
}

export interface DeviceSummary {
	id: string;
	deviceKey: string;
	name: string;
	status: DeviceStatus;
	roleName: string;
	createdAt: string;
	lastSeenAt: string | null;
}

/** POST /devices 응답에만 enrollmentToken 평문이 1회 포함된다. */
export interface DeviceRegistered extends DeviceSummary {
	enrollmentToken: string;
	enrollmentExpiresAt: string;
}

export interface EnrollmentTokenIssued {
	enrollmentToken: string;
	enrollmentExpiresAt: string;
}

export interface CertificateRequestItem {
	id: string;
	deviceId: string;
	status: CertificateRequestStatus;
	requestedAt: string;
}

export interface CertificateRequestDetail {
	id: string;
	deviceId: string;
	status: CertificateRequestStatus;
	subjectDn: string;
	sanUri: string | null;
	publicKeyAlgorithm: string;
	fingerprintSha256: string;
	requestedAt: string;
	decidedAt: string | null;
	decisionNote: string | null;
}

export interface CertificateItem {
	id: string;
	deviceId: string;
	serialNumber: string;
	status: CertificateStatus;
	notBefore: string;
	notAfter: string;
	issuedAt: string;
	revokedAt: string | null;
	revocationReason: string | null;
	revocationNote: string | null;
}

export interface SecurityEvent {
	id: string;
	occurredAt: string;
	type: string;
	severity: string;
	deviceId: string | null;
	certificateSerial: string | null;
	httpMethod: string | null;
	requestPath: string | null;
	decision: string | null;
	reasonCode: string | null;
	clientIp: string | null;
	latencyMs: number | null;
	traceId: string | null;
}

/** SSE `critical-security-event`의 data 필드 (docs/api-spec.md §9). */
export interface CriticalEventPayload {
	eventId: string;
	occurredAt: string;
	deviceKey: string | null;
	reasonCode: string;
	message: string;
}

export interface DashboardSummary {
	devices: { active: number; total: number };
	certificates: { valid: number; expiringSoon: number };
	pendingCertificateRequests: number;
	criticalEvents24h: number;
	requestBuckets: Array<{ startedAt: string; allowed: number; denied: number }>;
	services: Array<{ name: string; status: "UP" | "DOWN"; latencyMs: number | null }>;
	outbox: { pendingCount: number; oldestAgeSeconds: number } | null;
	recentCriticalEvents: SecurityEvent[];
}
```

- [ ] **Step 2: `ApiError` 작성**

`admin-console/src/shared/api/ApiError.ts`:

```ts
import type { ErrorResponse, FieldError } from "./types";

/**
 * 서버가 돌려준 오류 계약을 그대로 담는다(docs/api-spec.md §1 "오류 응답").
 * 화면에는 message를, 진단에는 traceId를 쓴다 — 둘을 섞지 않는다.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly traceId: string;
	readonly fieldErrors: FieldError[];

	constructor(status: number, body: ErrorResponse) {
		super(body.message);
		this.name = "ApiError";
		this.status = status;
		this.code = body.code;
		this.traceId = body.traceId;
		this.fieldErrors = body.fieldErrors ?? [];
	}
}

/** 응답 본문이 오류 계약을 따르지 않을 때(502 HTML 등) 쓰는 대체 표현. */
export function unexpectedError(status: number, traceId: string): ApiError {
	return new ApiError(status, {
		code: "INTERNAL_ERROR",
		message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
		traceId,
		fieldErrors: [],
	});
}
```

- [ ] **Step 3: 실패하는 Client 테스트 작성**

`admin-console/src/shared/api/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiSend } from "./client";
import { ApiError } from "./ApiError";

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("apiGet", () => {
	it("appends only the query params that have a value", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { content: [] }));
		vi.stubGlobal("fetch", fetchMock);

		await apiGet("/devices", { page: 0, status: "ACTIVE", roleName: undefined, query: "" });

		const url = String(fetchMock.mock.calls[0][0]);
		expect(url).toContain("page=0");
		expect(url).toContain("status=ACTIVE");
		expect(url).not.toContain("roleName");
		expect(url).not.toContain("query=");
	});

	it("sends a generated X-Trace-Id header", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
		vi.stubGlobal("fetch", fetchMock);

		await apiGet("/devices");

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		const headers = new Headers(init.headers);
		expect(headers.get("X-Trace-Id")).toMatch(/[0-9a-f-]{36}/);
	});

	it("throws ApiError carrying the server code and traceId", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				jsonResponse(409, {
					code: "CERTIFICATE_REQUEST_NOT_PENDING",
					message: "이미 처리된 요청입니다.",
					traceId: "trace-1",
					fieldErrors: [],
				}),
			),
		);

		await expect(apiGet("/certificate-requests/1")).rejects.toMatchObject({
			status: 409,
			code: "CERTIFICATE_REQUEST_NOT_PENDING",
			message: "이미 처리된 요청입니다.",
			traceId: "trace-1",
		});
	});

	it("turns a non-JSON error body into an INTERNAL_ERROR ApiError", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 })),
		);

		const error = await apiGet("/devices").catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect((error as ApiError).code).toBe("INTERNAL_ERROR");
	});
});

describe("apiSend", () => {
	it("omits the body entirely when none is given", async () => {
		const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
		vi.stubGlobal("fetch", fetchMock);

		await apiSend("POST", "/devices/1/enrollment-token");

		const init = fetchMock.mock.calls[0][1] as RequestInit;
		expect(init.body).toBeUndefined();
	});

	it("returns undefined for 204 No Content", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

		await expect(apiSend("POST", "/x")).resolves.toBeUndefined();
	});
});
```

- [ ] **Step 4: 실패 확인**

Run: `cd admin-console && npx vitest run src/shared/api/client.test.ts`
Expected: FAIL — `./client` 모듈이 없다.

- [ ] **Step 5: `client.ts` 작성**

`admin-console/src/shared/api/client.ts`:

```ts
import { apiBaseUrl } from "./env";
import { ApiError, unexpectedError } from "./ApiError";
import type { ErrorResponse } from "./types";

export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue>;

/**
 * 값이 있는 Query Parameter만 붙인다. 빈 문자열을 그대로 보내면 서버가 빈 필터를
 * 조건으로 해석해 결과가 사라지므로 여기서 걸러낸다.
 */
function buildUrl(path: string, params?: QueryParams): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params ?? {})) {
		if (value === undefined || value === null || value === "") {
			continue;
		}
		search.set(key, String(value));
	}
	const query = search.toString();
	return `${apiBaseUrl}${path}${query ? `?${query}` : ""}`;
}

function isErrorResponse(body: unknown): body is ErrorResponse {
	return (
		typeof body === "object" &&
		body !== null &&
		typeof (body as { code?: unknown }).code === "string" &&
		typeof (body as { message?: unknown }).message === "string"
	);
}

async function toApiError(response: Response, traceId: string): Promise<ApiError> {
	try {
		const body: unknown = await response.json();
		if (isErrorResponse(body)) {
			return new ApiError(response.status, {
				...body,
				traceId: body.traceId || traceId,
				fieldErrors: body.fieldErrors ?? [],
			});
		}
	} catch {
		// 오류 본문이 JSON이 아닌 경우(Proxy 502 HTML 등)는 아래로 떨어진다.
	}
	return unexpectedError(response.status, traceId);
}

async function request(method: string, path: string, params?: QueryParams, body?: unknown): Promise<Response> {
	// api-spec.md §1: 요청 추적 ID는 X-Trace-Id로 전달하고 없으면 서버가 생성한다.
	const traceId = crypto.randomUUID();
	const headers: Record<string, string> = { "X-Trace-Id": traceId, Accept: "application/json" };
	if (body !== undefined) {
		headers["Content-Type"] = "application/json";
	}

	const response = await fetch(buildUrl(path, params), {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});

	if (!response.ok) {
		throw await toApiError(response, traceId);
	}
	return response;
}

async function readJson<T>(response: Response): Promise<T> {
	if (response.status === 204 || response.headers.get("Content-Length") === "0") {
		return undefined as T;
	}
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}

export async function apiGet<T>(path: string, params?: QueryParams): Promise<T> {
	return readJson<T>(await request("GET", path, params));
}

export async function apiSend<T>(
	method: "POST" | "PUT" | "PATCH",
	path: string,
	body?: unknown,
): Promise<T> {
	return readJson<T>(await request(method, path, undefined, body));
}

/** GET /certificates/{id}/download는 JSON이 아니라 PEM 문자열을 돌려준다. */
export async function apiGetText(path: string): Promise<string> {
	return (await request("GET", path)).text();
}
```

- [ ] **Step 6: 통과 확인**

Run: `cd admin-console && npx vitest run src/shared/api/client.test.ts && npm run typecheck`
Expected: PASS 6건, 타입 오류 없음.

- [ ] **Step 7: Commit**

```bash
git checkout -b feature/console main   # 최초 1회. 이후에는 git checkout feature/console
git add admin-console/src/shared/api
git commit -m "feat(console): API Type과 HTTP Client 구현 (Issue #7)"
```

---

### Task 4: MSW Mock과 api-spec 기준 Fixture

Issue #7 완료 기준 "Mock과 실제 API Type이 같다"를 타입 시스템으로 강제한다. Fixture에 `satisfies` 를 붙여 두면 서버 계약이 바뀌었을 때 `npm run typecheck`가 깨진다.

**Files:**
- Modify: `admin-console/package.json` (msw 의존성)
- Create: `admin-console/src/mocks/fixtures.ts`
- Create: `admin-console/src/mocks/handlers.ts`
- Create: `admin-console/src/mocks/server.ts`
- Create: `admin-console/src/mocks/browser.ts`
- Modify: `admin-console/src/setupTests.ts`
- Modify: `admin-console/src/main.tsx`

**Interfaces:**
- Produces: `mockServer` (Node/Vitest용), `startMockWorker()` (브라우저용), `fixtures` (`devicePage`, `deviceDetail`, `certificateRequestPage`, `certificateRequestDetail`, `certificatePage`, `securityEventPage`, `roles`, `dashboardSummary`).

- [ ] **Step 1: msw 설치**

Run: `cd admin-console && npm install --save-dev msw@2`
Expected: `package.json`의 `devDependencies`에 `msw`가 추가된다.

- [ ] **Step 2: `fixtures.ts` 작성 — api-spec.md 예시와 동일한 값**

`admin-console/src/mocks/fixtures.ts`:

```ts
import type {
	CertificateItem,
	CertificateRequestDetail,
	CertificateRequestItem,
	DashboardSummary,
	DeviceDetail,
	DeviceListItem,
	PageResponse,
	RoleResponse,
	SecurityEvent,
} from "../shared/api/types";

// docs/api-spec.md의 예시 값을 그대로 쓴다. `satisfies`가 계약 불일치를 typecheck
// 단계에서 잡아준다 — Issue #7 완료 기준 "Mock과 실제 API Type이 같다".

function page<T>(content: T[]): PageResponse<T> {
	return { content, page: 0, size: 20, totalElements: content.length, totalPages: 1 };
}

export const devicePage = page<DeviceListItem>([
	{
		id: "0d6515ae-d560-4777-b102-054e71f98ef9",
		deviceKey: "sensor-floor-01",
		name: "1층 온도 센서",
		status: "ACTIVE",
		roleName: "SENSOR",
		certificateStatus: "VALID",
		certificateExpiresAt: "2026-09-12T05:32:18Z",
		lastSeenAt: "2026-08-13T05:31:54Z",
	},
	{
		id: "1a1b2c3d-0000-4000-8000-000000000002",
		deviceKey: "sensor-floor-02",
		name: "2층 온도 센서",
		status: "DISABLED",
		roleName: "SENSOR",
		certificateStatus: null,
		certificateExpiresAt: null,
		lastSeenAt: null,
	},
]) satisfies PageResponse<DeviceListItem>;

export const deviceDetail = {
	id: "0d6515ae-d560-4777-b102-054e71f98ef9",
	deviceKey: "sensor-floor-01",
	name: "1층 온도 센서",
	status: "ACTIVE",
	roleName: "SENSOR",
	createdAt: "2026-08-13T05:32:18Z",
	lastSeenAt: "2026-08-13T05:31:54Z",
	certificate: {
		id: "74ecff78-d52a-4f80-ae54-ac688b1c93ad",
		serialNumber: "7F28A109",
		status: "VALID",
		expiresAt: "2026-09-12T05:32:18Z",
	},
	policyRules: [{ httpMethod: "POST", pathPattern: "/telemetry", effect: "ALLOW", priority: 10 }],
	recentEvents: [
		{
			id: "c8c78370-174f-4f88-b230-784e2d9115be",
			occurredAt: "2026-08-13T05:50:00Z",
			type: "ACCESS",
			severity: "INFO",
			decision: "ALLOWED",
			reasonCode: "REQUEST_ALLOWED",
			httpMethod: "POST",
			requestPath: "/telemetry",
		},
	],
} satisfies DeviceDetail;

export const certificateRequestPage = page<CertificateRequestItem>([
	{
		id: "241a9ba8-b4d0-4a20-8684-486847ae98a4",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		status: "PENDING",
		requestedAt: "2026-08-13T05:40:00Z",
	},
]) satisfies PageResponse<CertificateRequestItem>;

export const certificateRequestDetail = {
	id: "241a9ba8-b4d0-4a20-8684-486847ae98a4",
	deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
	status: "PENDING",
	subjectDn: "CN=sensor-floor-01",
	sanUri: "urn:certgate:device:sensor-floor-01",
	publicKeyAlgorithm: "EC P-256",
	fingerprintSha256: "9f2c4a1b8e0d6f3a5c7b9d1e2f4a6c8b0d2e4f6a8c0b2d4e6f8a0c2b4d6e8f0a",
	requestedAt: "2026-08-13T05:40:00Z",
	decidedAt: null,
	decisionNote: null,
} satisfies CertificateRequestDetail;

export const certificatePage = page<CertificateItem>([
	{
		id: "74ecff78-d52a-4f80-ae54-ac688b1c93ad",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		serialNumber: "7F28A109",
		status: "VALID",
		notBefore: "2026-08-13T05:45:00Z",
		notAfter: "2026-09-12T05:45:00Z",
		issuedAt: "2026-08-13T05:45:00Z",
		revokedAt: null,
		revocationReason: null,
		revocationNote: null,
	},
]) satisfies PageResponse<CertificateItem>;

export const securityEventPage = page<SecurityEvent>([
	{
		id: "c8c78370-174f-4f88-b230-784e2d9115be",
		occurredAt: "2026-08-13T05:50:00Z",
		type: "ACCESS",
		severity: "INFO",
		deviceId: "0d6515ae-d560-4777-b102-054e71f98ef9",
		certificateSerial: "7F28A109",
		httpMethod: "POST",
		requestPath: "/telemetry",
		decision: "ALLOWED",
		reasonCode: "REQUEST_ALLOWED",
		clientIp: "203.0.113.21",
		latencyMs: 12,
		traceId: "8a6ba949-f3ec-4916-aae2-d55bd787893d",
	},
	{
		id: "e1e2e3e4-0000-4000-8000-000000000009",
		occurredAt: "2026-08-13T05:52:00Z",
		type: "SYSTEM",
		severity: "CRITICAL",
		deviceId: null,
		certificateSerial: null,
		httpMethod: null,
		requestPath: null,
		decision: "ERROR",
		reasonCode: "EVENT_OUTBOX_BACKLOG",
		clientIp: null,
		latencyMs: null,
		traceId: "b0b1b2b3-0000-4000-8000-00000000000a",
	},
]) satisfies PageResponse<SecurityEvent>;

export const roles = [
	{
		name: "SENSOR",
		rules: [
			{ httpMethod: "POST", pathPattern: "/telemetry", effect: "ALLOW", priority: 10 },
			{ httpMethod: "POST", pathPattern: "/heartbeat", effect: "ALLOW", priority: 20 },
		],
	},
	{ name: "OPERATOR", rules: [{ httpMethod: "GET", pathPattern: "/commands", effect: "ALLOW", priority: 10 }] },
] satisfies RoleResponse[];

export const dashboardSummary = {
	devices: { active: 24, total: 27 },
	certificates: { valid: 22, expiringSoon: 2 },
	pendingCertificateRequests: 3,
	criticalEvents24h: 2,
	requestBuckets: [{ startedAt: "2026-08-13T04:00:00Z", allowed: 208, denied: 4 }],
	services: [
		{ name: "gateway", status: "UP", latencyMs: 12 },
		{ name: "management-api", status: "UP", latencyMs: 3 },
		{ name: "postgres", status: "UP", latencyMs: 1 },
	],
	outbox: { pendingCount: 12, oldestAgeSeconds: 24 },
	recentCriticalEvents: [securityEventPage.content[1]],
} satisfies DashboardSummary;
```

- [ ] **Step 3: `handlers.ts` 작성**

`admin-console/src/mocks/handlers.ts`:

```ts
import { http, HttpResponse } from "msw";
import * as fixtures from "./fixtures";

const BASE = "/api/v1";

export const handlers = [
	http.get(`${BASE}/roles`, () => HttpResponse.json(fixtures.roles)),
	http.get(`${BASE}/devices`, () => HttpResponse.json(fixtures.devicePage)),
	http.get(`${BASE}/devices/:deviceId`, () => HttpResponse.json(fixtures.deviceDetail)),
	http.get(`${BASE}/certificate-requests`, () => HttpResponse.json(fixtures.certificateRequestPage)),
	http.get(`${BASE}/certificate-requests/:requestId`, () =>
		HttpResponse.json(fixtures.certificateRequestDetail),
	),
	http.get(`${BASE}/certificates`, () => HttpResponse.json(fixtures.certificatePage)),
	http.get(`${BASE}/certificates/:certificateId`, () =>
		HttpResponse.json(fixtures.certificatePage.content[0]),
	),
	http.get(`${BASE}/security-events`, () => HttpResponse.json(fixtures.securityEventPage)),
	http.get(`${BASE}/security-events/:eventId`, () =>
		HttpResponse.json(fixtures.securityEventPage.content[0]),
	),
	http.get(`${BASE}/dashboard/summary`, () => HttpResponse.json(fixtures.dashboardSummary)),
];
```

- [ ] **Step 4: `server.ts`·`browser.ts` 작성**

`admin-console/src/mocks/server.ts`:

```ts
import { setupServer } from "msw/node";
import { handlers } from "./handlers";

export const mockServer = setupServer(...handlers);
```

`admin-console/src/mocks/browser.ts`:

```ts
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/**
 * Backend 없이 화면만 확인할 때 쓴다. VITE_USE_MOCK=true 일 때만 시작하므로
 * 운영 Build에는 Mock이 끼어들지 않는다.
 */
export async function startMockWorker(): Promise<void> {
	await setupWorker(...handlers).start({ onUnhandledRequest: "bypass" });
}
```

- [ ] **Step 5: 테스트 setup에 MSW 연결**

`admin-console/src/setupTests.ts`에 추가한다(기존 `@testing-library/jest-dom` import는 유지):

```ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { mockServer } from "./mocks/server";

beforeAll(() => mockServer.listen({ onUnhandledRequest: "error" }));
afterEach(() => mockServer.resetHandlers());
afterAll(() => mockServer.close());
```

`onUnhandledRequest: "error"`로 두면 테스트가 실수로 실제 네트워크를 때리는 순간 실패한다.

- [ ] **Step 6: 브라우저 Mock 진입점 연결**

`admin-console/src/main.tsx`의 렌더 직전에 추가한다:

```tsx
if (import.meta.env.VITE_USE_MOCK === "true") {
	const { startMockWorker } = await import("./mocks/browser");
	await startMockWorker();
}
```

`admin-console/src/vite-env.d.ts`의 `ImportMetaEnv`에 `readonly VITE_USE_MOCK?: string;`를 추가한다.

- [ ] **Step 7: 검증**

Run: `cd admin-console && npm run typecheck && npm test`
Expected: 타입 오류 없음(= Fixture가 API Type과 일치), 기존 테스트 통과.

- [ ] **Step 8: Commit**

```bash
git add admin-console/package.json admin-console/package-lock.json admin-console/src/mocks admin-console/src/setupTests.ts admin-console/src/main.tsx admin-console/src/vite-env.d.ts
git commit -m "feat(console): api-spec 계약과 동일한 MSW Mock Fixture 추가 (Issue #7)"
```

---

### Task 5: 공통 UI Primitive

화면마다 로딩·빈 상태·오류를 다시 만들면 Issue #7 완료 기준("로딩·빈 상태·오류 상태")이 화면별로 어긋난다. 한 곳에서 처리한다.

**Files:**
- Create: `admin-console/src/shared/ui/QueryState.tsx`
- Create: `admin-console/src/shared/ui/DataTable.tsx`
- Create: `admin-console/src/shared/ui/StatusChip.tsx`
- Create: `admin-console/src/shared/ui/ConfirmDialog.tsx`
- Create: `admin-console/src/shared/ui/PageHeader.tsx`
- Create: `admin-console/src/shared/ui/DateTimeText.tsx`
- Create: `admin-console/src/shared/api/usePageParams.ts`
- Test: `admin-console/src/shared/ui/QueryState.test.tsx`

**Interfaces:**
- Produces:
  - `<QueryState isLoading isError error isEmpty emptyMessage onRetry>{children}</QueryState>`
  - `<DataTable<T> columns rows getRowId page size totalElements onPageChange onSizeChange onRowClick />`
    where `Column<T> = { key: string; header: string; render: (row: T) => ReactNode; width?: number }`
  - `<StatusChip label color />` with `ChipColor = "default" | "success" | "warning" | "error" | "info"`
  - `<ConfirmDialog open title description confirmLabel onConfirm onClose isPending error>{children}</ConfirmDialog>`
  - `<PageHeader title actions />`
  - `<DateTimeText value />` — `string | null` → 로컬 시간 문자열, null이면 `—`
  - `usePageParams()` → `{ params, setParam, page, size, setPage, setSize }` (URL Query String 동기화)

- [ ] **Step 1: 실패하는 `QueryState` 테스트 작성**

`admin-console/src/shared/ui/QueryState.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QueryState from "./QueryState";
import { ApiError } from "../api/ApiError";

describe("QueryState", () => {
	it("shows a progress indicator while loading", () => {
		render(
			<QueryState isLoading isError={false} error={null} isEmpty={false}>
				<div>content</div>
			</QueryState>,
		);
		expect(screen.getByRole("progressbar")).toBeInTheDocument();
		expect(screen.queryByText("content")).not.toBeInTheDocument();
	});

	it("shows the server message and traceId on error", () => {
		const error = new ApiError(409, {
			code: "CONFLICT",
			message: "이미 처리된 요청입니다.",
			traceId: "trace-9",
			fieldErrors: [],
		});
		render(
			<QueryState isLoading={false} isError error={error} isEmpty={false}>
				<div>content</div>
			</QueryState>,
		);
		expect(screen.getByText("이미 처리된 요청입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-9/)).toBeInTheDocument();
	});

	it("calls onRetry when the retry button is pressed", async () => {
		const onRetry = vi.fn();
		render(
			<QueryState isLoading={false} isError error={new Error("boom")} isEmpty={false} onRetry={onRetry}>
				<div>content</div>
			</QueryState>,
		);
		await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it("shows the empty message instead of children when empty", () => {
		render(
			<QueryState isLoading={false} isError={false} error={null} isEmpty emptyMessage="디바이스가 없습니다.">
				<div>content</div>
			</QueryState>,
		);
		expect(screen.getByText("디바이스가 없습니다.")).toBeInTheDocument();
		expect(screen.queryByText("content")).not.toBeInTheDocument();
	});
});
```

`@testing-library/user-event`가 없으면 먼저 설치한다: `npm install --save-dev @testing-library/user-event`

- [ ] **Step 2: 실패 확인**

Run: `cd admin-console && npx vitest run src/shared/ui/QueryState.test.tsx`
Expected: FAIL — `./QueryState` 모듈이 없다.

- [ ] **Step 3: `QueryState.tsx` 작성**

```tsx
import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { ApiError } from "../api/ApiError";

interface Props {
	isLoading: boolean;
	isError: boolean;
	error: unknown;
	isEmpty: boolean;
	emptyMessage?: string;
	onRetry?: () => void;
	children: ReactNode;
}

/**
 * 로딩·오류·빈 상태를 한 곳에서 처리한다(Issue #7 완료 기준). 오류에는 서버가 준
 * 사용자 Message를 쓰고 Reason Code·Trace ID는 진단용으로 따로 보여준다
 * (development-guide.md "Message와 내부 Reason Code를 분리").
 */
export default function QueryState({
	isLoading,
	isError,
	error,
	isEmpty,
	emptyMessage = "표시할 데이터가 없습니다.",
	onRetry,
	children,
}: Props) {
	if (isLoading) {
		return (
			<Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
				<CircularProgress aria-label="불러오는 중" />
			</Box>
		);
	}

	if (isError) {
		const apiError = error instanceof ApiError ? error : null;
		return (
			<Alert
				severity="error"
				action={
					onRetry ? (
						<Button color="inherit" size="small" onClick={onRetry}>
							다시 시도
						</Button>
					) : undefined
				}
			>
				<AlertTitle>요청을 처리하지 못했습니다</AlertTitle>
				<Typography variant="body2">
					{apiError ? apiError.message : "알 수 없는 오류가 발생했습니다."}
				</Typography>
				{apiError && (
					<Typography variant="caption" color="text.secondary">
						{apiError.code} · traceId {apiError.traceId}
					</Typography>
				)}
			</Alert>
		);
	}

	if (isEmpty) {
		return (
			<Box sx={{ py: 6, textAlign: "center" }}>
				<Typography color="text.secondary">{emptyMessage}</Typography>
			</Box>
		);
	}

	return <>{children}</>;
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd admin-console && npx vitest run src/shared/ui/QueryState.test.tsx`
Expected: PASS 4건.

- [ ] **Step 5: `DateTimeText.tsx`·`StatusChip.tsx`·`PageHeader.tsx` 작성**

`DateTimeText.tsx`:

```tsx
interface Props {
	value: string | null | undefined;
}

/** 서버는 UTC ISO 8601로 주고 화면에는 로컬 시간으로 보여준다. */
export default function DateTimeText({ value }: Props) {
	if (!value) {
		return <>—</>;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return <>—</>;
	}
	return <>{date.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "medium" })}</>;
}
```

`StatusChip.tsx`:

```tsx
import Chip from "@mui/material/Chip";

export type ChipColor = "default" | "success" | "warning" | "error" | "info";

interface Props {
	label: string;
	color: ChipColor;
}

export default function StatusChip({ label, color }: Props) {
	return <Chip label={label} color={color} size="small" variant={color === "default" ? "outlined" : "filled"} />;
}
```

`PageHeader.tsx`:

```tsx
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface Props {
	title: string;
	actions?: ReactNode;
}

export default function PageHeader({ title, actions }: Props) {
	return (
		<Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
			<Typography variant="h4" component="h1">
				{title}
			</Typography>
			{actions}
		</Box>
	);
}
```

`routes.test.tsx`가 `getByRole("heading", { name })`로 화면을 찾으므로 모든 페이지는 `PageHeader`를 쓰고 제목 문자열을 유지해야 한다.

- [ ] **Step 6: `DataTable.tsx` 작성**

```tsx
import type { ReactNode } from "react";
import Paper from "@mui/material/Paper";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TablePagination from "@mui/material/TablePagination";
import TableRow from "@mui/material/TableRow";

export interface Column<T> {
	key: string;
	header: string;
	render: (row: T) => ReactNode;
	width?: number;
}

interface Props<T> {
	columns: Column<T>[];
	rows: T[];
	getRowId: (row: T) => string;
	page: number;
	size: number;
	totalElements: number;
	onPageChange: (page: number) => void;
	onSizeChange: (size: number) => void;
	onRowClick?: (row: T) => void;
}

/** api-spec.md §1: page는 0-based, size 기본 20 최대 100. */
export default function DataTable<T>({
	columns,
	rows,
	getRowId,
	page,
	size,
	totalElements,
	onPageChange,
	onSizeChange,
	onRowClick,
}: Props<T>) {
	return (
		<Paper>
			<TableContainer>
				<Table size="small">
					<TableHead>
						<TableRow>
							{columns.map((column) => (
								<TableCell key={column.key} sx={{ width: column.width }}>
									{column.header}
								</TableCell>
							))}
						</TableRow>
					</TableHead>
					<TableBody>
						{rows.map((row) => (
							<TableRow
								key={getRowId(row)}
								hover={Boolean(onRowClick)}
								sx={{ cursor: onRowClick ? "pointer" : "default" }}
								onClick={onRowClick ? () => onRowClick(row) : undefined}
							>
								{columns.map((column) => (
									<TableCell key={column.key}>{column.render(row)}</TableCell>
								))}
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableContainer>
			<TablePagination
				component="div"
				count={totalElements}
				page={page}
				rowsPerPage={size}
				rowsPerPageOptions={[20, 50, 100]}
				onPageChange={(_, next) => onPageChange(next)}
				onRowsPerPageChange={(event) => onSizeChange(Number(event.target.value))}
				labelRowsPerPage="쪽당 행 수"
			/>
		</Paper>
	);
}
```

- [ ] **Step 7: `ConfirmDialog.tsx` 작성**

```tsx
import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { ApiError } from "../api/ApiError";

interface Props {
	open: boolean;
	title: string;
	description?: string;
	confirmLabel: string;
	confirmColor?: "primary" | "error";
	isPending?: boolean;
	error?: unknown;
	onConfirm: () => void;
	onClose: () => void;
	children?: ReactNode;
	confirmDisabled?: boolean;
}

export default function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	confirmColor = "primary",
	isPending = false,
	error,
	onConfirm,
	onClose,
	children,
	confirmDisabled = false,
}: Props) {
	return (
		<Dialog open={open} onClose={isPending ? undefined : onClose} fullWidth maxWidth="sm">
			<DialogTitle>{title}</DialogTitle>
			<DialogContent>
				{description && <DialogContentText sx={{ mb: 2 }}>{description}</DialogContentText>}
				{children}
				{Boolean(error) && (
					<Alert severity="error" sx={{ mt: 2 }}>
						{error instanceof ApiError ? error.message : "요청을 처리하지 못했습니다."}
						{error instanceof ApiError && (
							<div style={{ fontSize: "0.75rem", opacity: 0.8 }}>traceId {error.traceId}</div>
						)}
					</Alert>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={isPending}>
					취소
				</Button>
				<Button onClick={onConfirm} color={confirmColor} variant="contained" disabled={isPending || confirmDisabled}>
					{confirmLabel}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
```

- [ ] **Step 8: `usePageParams.ts` 작성**

```ts
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

const DEFAULT_SIZE = 20;

/**
 * 페이지·필터 상태를 URL Query String에 둔다. 새로고침·뒤로가기·링크 공유에서
 * 목록 상태가 유지되고, 별도 전역 상태 관리를 도입하지 않아도 된다
 * (Issue #7 완료 기준 "별도 Alert 화면·상태 관리가 없다").
 */
export function usePageParams() {
	const [searchParams, setSearchParams] = useSearchParams();

	const page = Number(searchParams.get("page") ?? 0);
	const size = Number(searchParams.get("size") ?? DEFAULT_SIZE);

	const setParam = useCallback(
		(key: string, value: string | undefined) => {
			setSearchParams(
				(current) => {
					const next = new URLSearchParams(current);
					if (value === undefined || value === "") {
						next.delete(key);
					} else {
						next.set(key, value);
					}
					// 필터가 바뀌면 항상 첫 페이지로 돌아간다. 3페이지를 보던 중 필터를
					// 좁히면 결과가 없어 빈 화면이 뜨는 것을 막는다.
					if (key !== "page") {
						next.delete("page");
					}
					return next;
				},
				{ replace: true },
			);
		},
		[setSearchParams],
	);

	const setPage = useCallback((next: number) => setParam("page", String(next)), [setParam]);
	const setSize = useCallback((next: number) => setParam("size", String(next)), [setParam]);
	const get = useCallback((key: string) => searchParams.get(key) ?? undefined, [searchParams]);

	return { page, size, setPage, setSize, setParam, get };
}
```

- [ ] **Step 9: 전체 검증**

Run: `cd admin-console && npm run typecheck && npm test`
Expected: 전부 통과.

- [ ] **Step 10: Commit**

```bash
git add admin-console/src/shared
git commit -m "feat(console): 로딩·빈 상태·오류 공통 처리와 표·다이얼로그 Primitive (Issue #7)"
```

---

### Task 6: Devices 목록 화면

**Files:**
- Create: `admin-console/src/features/device/{api.ts,queries.ts,labels.ts,DeviceFilters.tsx}`
- Modify: `admin-console/src/pages/DevicesPage.tsx`
- Test: `admin-console/src/pages/DevicesPage.test.tsx`

**Interfaces:**
- Consumes: `apiGet`/`apiSend` (Task 3), `QueryState`/`DataTable`/`StatusChip`/`DateTimeText`/`PageHeader`/`usePageParams` (Task 5), MSW handlers (Task 4).
- Produces:
  - `features/device/api.ts`: `fetchDevices(params: DeviceListParams): Promise<PageResponse<DeviceListItem>>`, `fetchDevice(deviceId: string): Promise<DeviceDetail>`, `fetchRoles(): Promise<RoleResponse[]>`
    where `DeviceListParams = { query?: string; status?: string; roleName?: string; page: number; size: number }`
  - `features/device/queries.ts`: `deviceKeys`, `useDevices(params)`, `useDevice(deviceId)`, `useRoles()`
  - `features/device/labels.ts`: `deviceStatusLabel(s: DeviceStatus): string`, `deviceStatusColor(s): ChipColor`, `certificateStatusLabel(s: CertificateStatus | null): string`, `certificateStatusColor(s: CertificateStatus | null): ChipColor`

- [ ] **Step 1: `features/device/api.ts` 작성**

```ts
import { apiGet, apiSend } from "../../shared/api/client";
import type {
	DeviceDetail,
	DeviceListItem,
	DeviceRegistered,
	DeviceStatus,
	DeviceSummary,
	EnrollmentTokenIssued,
	PageResponse,
	RoleResponse,
} from "../../shared/api/types";

export interface DeviceListParams {
	query?: string;
	status?: string;
	roleName?: string;
	page: number;
	size: number;
}

export function fetchDevices(params: DeviceListParams): Promise<PageResponse<DeviceListItem>> {
	return apiGet("/devices", { ...params });
}

export function fetchDevice(deviceId: string): Promise<DeviceDetail> {
	return apiGet(`/devices/${deviceId}`);
}

export function fetchRoles(): Promise<RoleResponse[]> {
	return apiGet("/roles");
}

export function registerDevice(body: {
	deviceKey: string;
	name: string;
	roleName: string;
}): Promise<DeviceRegistered> {
	return apiSend("POST", "/devices", body);
}

export function updateDeviceStatus(deviceId: string, status: DeviceStatus): Promise<DeviceSummary> {
	return apiSend("PATCH", `/devices/${deviceId}/status`, { status });
}

export function updateDeviceRole(deviceId: string, roleName: string): Promise<DeviceSummary> {
	return apiSend("PUT", `/devices/${deviceId}/role`, { roleName });
}

/** 재발급 시 기존 활성 Token은 서버에서 폐기된다(security-design.md §2). */
export function reissueEnrollmentToken(deviceId: string): Promise<EnrollmentTokenIssued> {
	return apiSend("POST", `/devices/${deviceId}/enrollment-token`);
}
```

- [ ] **Step 2: `features/device/labels.ts` 작성**

```ts
import type { ChipColor } from "../../shared/ui/StatusChip";
import type { CertificateStatus, DeviceStatus } from "../../shared/api/types";

// api-spec.md §1: Enum은 API에서 영문 대문자로 전달하고 Console에서 한국어로 변환한다.

export function deviceStatusLabel(status: DeviceStatus): string {
	return status === "ACTIVE" ? "활성" : "비활성";
}

export function deviceStatusColor(status: DeviceStatus): ChipColor {
	return status === "ACTIVE" ? "success" : "default";
}

export function certificateStatusLabel(status: CertificateStatus | null): string {
	switch (status) {
		case "VALID":
			return "유효";
		case "EXPIRING_SOON":
			return "만료 임박";
		case "EXPIRED":
			return "만료";
		case "REVOKED":
			return "폐기";
		default:
			return "발급 없음";
	}
}

export function certificateStatusColor(status: CertificateStatus | null): ChipColor {
	switch (status) {
		case "VALID":
			return "success";
		case "EXPIRING_SOON":
			return "warning";
		case "EXPIRED":
			return "default";
		case "REVOKED":
			return "error";
		default:
			return "default";
	}
}
```

- [ ] **Step 3: `features/device/queries.ts` 작성**

```ts
import { useQuery } from "@tanstack/react-query";
import { fetchDevice, fetchDevices, fetchRoles, type DeviceListParams } from "./api";

export const deviceKeys = {
	all: ["devices"] as const,
	list: (params: DeviceListParams) => [...deviceKeys.all, "list", params] as const,
	detail: (deviceId: string) => [...deviceKeys.all, "detail", deviceId] as const,
	roles: ["roles"] as const,
};

export function useDevices(params: DeviceListParams) {
	return useQuery({ queryKey: deviceKeys.list(params), queryFn: () => fetchDevices(params) });
}

export function useDevice(deviceId: string) {
	return useQuery({ queryKey: deviceKeys.detail(deviceId), queryFn: () => fetchDevice(deviceId) });
}

/** Role 목록은 Seed Data라 자주 바뀌지 않는다. */
export function useRoles() {
	return useQuery({ queryKey: deviceKeys.roles, queryFn: fetchRoles, staleTime: 5 * 60 * 1000 });
}
```

- [ ] **Step 4: `features/device/DeviceFilters.tsx` 작성**

ui-design.md §4의 "검색·필터: 이름, Device Key, 상태, Role".

```tsx
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useRoles } from "./queries";

interface Props {
	query: string;
	status: string;
	roleName: string;
	onChange: (key: "query" | "status" | "roleName", value: string) => void;
}

export default function DeviceFilters({ query, status, roleName, onChange }: Props) {
	const roles = useRoles();

	return (
		<Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
			<TextField
				label="이름 또는 Device Key"
				size="small"
				value={query}
				onChange={(event) => onChange("query", event.target.value)}
				sx={{ minWidth: 240 }}
			/>
			<TextField
				select
				label="상태"
				size="small"
				value={status}
				onChange={(event) => onChange("status", event.target.value)}
				sx={{ minWidth: 140 }}
			>
				<MenuItem value="">전체</MenuItem>
				<MenuItem value="ACTIVE">활성</MenuItem>
				<MenuItem value="DISABLED">비활성</MenuItem>
			</TextField>
			<TextField
				select
				label="Role"
				size="small"
				value={roleName}
				onChange={(event) => onChange("roleName", event.target.value)}
				sx={{ minWidth: 160 }}
				disabled={roles.isLoading}
			>
				<MenuItem value="">전체</MenuItem>
				{(roles.data ?? []).map((role) => (
					<MenuItem key={role.name} value={role.name}>
						{role.name}
					</MenuItem>
				))}
			</TextField>
		</Box>
	);
}
```

- [ ] **Step 5: 실패하는 화면 테스트 작성**

`admin-console/src/pages/DevicesPage.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

describe("DevicesPage", () => {
	it("renders each device row with Korean status labels", async () => {
		renderAt("/devices");

		expect(await screen.findByText("sensor-floor-01")).toBeInTheDocument();
		expect(screen.getByText("1층 온도 센서")).toBeInTheDocument();
		expect(screen.getByText("활성")).toBeInTheDocument();
		expect(screen.getByText("비활성")).toBeInTheDocument();
	});

	it("shows 발급 없음 for a device without a certificate", async () => {
		renderAt("/devices");
		expect(await screen.findByText("발급 없음")).toBeInTheDocument();
	});

	it("shows the empty state when the server returns no devices", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json({ content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }),
			),
		);
		renderAt("/devices");
		expect(await screen.findByText("조건에 맞는 디바이스가 없습니다.")).toBeInTheDocument();
	});

	it("shows the server error message and traceId when the list fails", async () => {
		mockServer.use(
			http.get("/api/v1/devices", () =>
				HttpResponse.json(
					{ code: "INTERNAL_ERROR", message: "일시적인 오류입니다.", traceId: "trace-7", fieldErrors: [] },
					{ status: 500 },
				),
			),
		);
		renderAt("/devices");
		expect(await screen.findByText("일시적인 오류입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-7/)).toBeInTheDocument();
	});
});
```

- [ ] **Step 6: 실패 확인**

Run: `cd admin-console && npx vitest run src/pages/DevicesPage.test.tsx`
Expected: FAIL — 현재 페이지는 제목만 렌더링한다.

- [ ] **Step 7: `DevicesPage.tsx` 작성**

ui-design.md §4 목록 컬럼: 이름, Device Key, Role, 상태, 인증서 상태, 만료일, 마지막 접속.

```tsx
import { useNavigate } from "react-router-dom";
import DeviceFilters from "../features/device/DeviceFilters";
import { useDevices } from "../features/device/queries";
import {
	certificateStatusColor,
	certificateStatusLabel,
	deviceStatusColor,
	deviceStatusLabel,
} from "../features/device/labels";
import type { DeviceListItem } from "../shared/api/types";
import { usePageParams } from "../shared/api/usePageParams";
import DataTable, { type Column } from "../shared/ui/DataTable";
import DateTimeText from "../shared/ui/DateTimeText";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

const COLUMNS: Column<DeviceListItem>[] = [
	{ key: "name", header: "이름", render: (row) => row.name },
	{ key: "deviceKey", header: "Device Key", render: (row) => row.deviceKey },
	{ key: "roleName", header: "Role", render: (row) => row.roleName },
	{
		key: "status",
		header: "상태",
		render: (row) => <StatusChip label={deviceStatusLabel(row.status)} color={deviceStatusColor(row.status)} />,
	},
	{
		key: "certificateStatus",
		header: "인증서",
		render: (row) => (
			<StatusChip
				label={certificateStatusLabel(row.certificateStatus)}
				color={certificateStatusColor(row.certificateStatus)}
			/>
		),
	},
	{ key: "certificateExpiresAt", header: "만료일", render: (row) => <DateTimeText value={row.certificateExpiresAt} /> },
	{ key: "lastSeenAt", header: "마지막 접속", render: (row) => <DateTimeText value={row.lastSeenAt} /> },
];

export default function DevicesPage() {
	const navigate = useNavigate();
	const { page, size, setPage, setSize, setParam, get } = usePageParams();
	const query = get("query") ?? "";
	const status = get("status") ?? "";
	const roleName = get("roleName") ?? "";

	const devices = useDevices({ query, status, roleName, page, size });

	return (
		<>
			<PageHeader title="Devices" />
			<DeviceFilters
				query={query}
				status={status}
				roleName={roleName}
				onChange={(key, value) => setParam(key, value)}
			/>
			<QueryState
				isLoading={devices.isPending}
				isError={devices.isError}
				error={devices.error}
				isEmpty={devices.data?.content.length === 0}
				emptyMessage="조건에 맞는 디바이스가 없습니다."
				onRetry={() => devices.refetch()}
			>
				<DataTable
					columns={COLUMNS}
					rows={devices.data?.content ?? []}
					getRowId={(row) => row.id}
					page={page}
					size={size}
					totalElements={devices.data?.totalElements ?? 0}
					onPageChange={setPage}
					onSizeChange={setSize}
					onRowClick={(row) => navigate(`/devices/${row.id}`)}
				/>
			</QueryState>
		</>
	);
}
```

- [ ] **Step 8: 통과 확인**

Run: `cd admin-console && npx vitest run src/pages/DevicesPage.test.tsx && npm run typecheck`
Expected: PASS 4건.

- [ ] **Step 9: Commit**

```bash
git add admin-console/src/features/device admin-console/src/pages/DevicesPage.tsx admin-console/src/pages/DevicesPage.test.tsx
git commit -m "feat(console): Devices 목록·검색·필터를 실제 API에 연결 (Issue #7)"
```

---

### Task 7: Device 상세 화면

**Files:**
- Create: `admin-console/src/pages/DeviceDetailPage.tsx`
- Modify: `admin-console/src/app/routes.tsx`
- Test: `admin-console/src/pages/DeviceDetailPage.test.tsx`

**Interfaces:**
- Consumes: `useDevice(deviceId)` (Task 6).
- Produces: Route `/devices/:deviceId`.

- [ ] **Step 1: Route 추가**

`admin-console/src/app/routes.tsx`의 `children` 배열에서 `devices` 항목 뒤에 추가한다:

```tsx
			{ path: "devices/:deviceId", element: <DeviceDetailPage /> },
```

파일 상단에 `import DeviceDetailPage from "../pages/DeviceDetailPage";`를 추가한다.

- [ ] **Step 2: 실패하는 테스트 작성**

`admin-console/src/pages/DeviceDetailPage.test.tsx` — Task 6의 `renderAt` 헬퍼와 동일한 방식으로 렌더링한다:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "../app/routes";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

const DEVICE_ID = "0d6515ae-d560-4777-b102-054e71f98ef9";

describe("DeviceDetailPage", () => {
	it("shows basic info, certificate, policy rules and recent events", async () => {
		renderAt(`/devices/${DEVICE_ID}`);

		expect(await screen.findByText("1층 온도 센서")).toBeInTheDocument();
		expect(screen.getByText("7F28A109")).toBeInTheDocument();
		expect(screen.getByText("/telemetry")).toBeInTheDocument();
		expect(screen.getByText("REQUEST_ALLOWED")).toBeInTheDocument();
	});

	it("never renders private key or certificate PEM material", async () => {
		const { container } = renderAt(`/devices/${DEVICE_ID}`);
		await screen.findByText("1층 온도 센서");

		expect(container.textContent).not.toContain("BEGIN CERTIFICATE");
		expect(container.textContent).not.toContain("PRIVATE KEY");
	});
});
```

- [ ] **Step 3: 실패 확인**

Run: `cd admin-console && npx vitest run src/pages/DeviceDetailPage.test.tsx`
Expected: FAIL — 모듈이 없다.

- [ ] **Step 4: `DeviceDetailPage.tsx` 작성**

ui-design.md §4 상세: 기본 정보, 인증서, 적용 정책, 최근 보안 이벤트.

```tsx
import { useParams } from "react-router-dom";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useDevice } from "../features/device/queries";
import {
	certificateStatusColor,
	certificateStatusLabel,
	deviceStatusColor,
	deviceStatusLabel,
} from "../features/device/labels";
import DateTimeText from "../shared/ui/DateTimeText";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<Stack direction="row" spacing={2} sx={{ py: 0.5 }}>
			<Typography variant="body2" color="text.secondary" sx={{ minWidth: 120 }}>
				{label}
			</Typography>
			<Typography variant="body2" component="div">
				{children}
			</Typography>
		</Stack>
	);
}

export default function DeviceDetailPage() {
	const { deviceId = "" } = useParams();
	const device = useDevice(deviceId);

	return (
		<>
			<PageHeader title="Device 상세" />
			<QueryState
				isLoading={device.isPending}
				isError={device.isError}
				error={device.error}
				isEmpty={false}
				onRetry={() => device.refetch()}
			>
				{device.data && (
					<Grid container spacing={2}>
						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										기본 정보
									</Typography>
									<Field label="이름">{device.data.name}</Field>
									<Field label="Device Key">{device.data.deviceKey}</Field>
									<Field label="Role">{device.data.roleName}</Field>
									<Field label="상태">
										<StatusChip
											label={deviceStatusLabel(device.data.status)}
											color={deviceStatusColor(device.data.status)}
										/>
									</Field>
									<Field label="등록일">
										<DateTimeText value={device.data.createdAt} />
									</Field>
									<Field label="마지막 접속">
										<DateTimeText value={device.data.lastSeenAt} />
									</Field>
								</CardContent>
							</Card>
						</Grid>

						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										인증서
									</Typography>
									{device.data.certificate ? (
										<>
											<Field label="Serial">{device.data.certificate.serialNumber}</Field>
											<Field label="상태">
												<StatusChip
													label={certificateStatusLabel(device.data.certificate.status)}
													color={certificateStatusColor(device.data.certificate.status)}
												/>
											</Field>
											<Field label="만료일">
												<DateTimeText value={device.data.certificate.expiresAt} />
											</Field>
										</>
									) : (
										<Typography color="text.secondary">발급된 인증서가 없습니다.</Typography>
									)}
								</CardContent>
							</Card>
						</Grid>

						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										적용 정책
									</Typography>
									{device.data.policyRules.length === 0 ? (
										<Typography color="text.secondary">허용 규칙이 없어 모든 요청이 차단됩니다.</Typography>
									) : (
										device.data.policyRules.map((rule) => (
											<Field key={`${rule.httpMethod} ${rule.pathPattern}`} label={rule.httpMethod}>
												{rule.pathPattern} · {rule.effect} · 우선순위 {rule.priority}
											</Field>
										))
									)}
								</CardContent>
							</Card>
						</Grid>

						<Grid size={{ xs: 12, md: 6 }}>
							<Card>
								<CardContent>
									<Typography variant="h6" gutterBottom>
										최근 보안 이벤트
									</Typography>
									{device.data.recentEvents.length === 0 ? (
										<Typography color="text.secondary">최근 이벤트가 없습니다.</Typography>
									) : (
										device.data.recentEvents.map((event) => (
											<Field key={event.id} label={event.severity}>
												<DateTimeText value={event.occurredAt} /> · {event.httpMethod ?? "—"}{" "}
												{event.requestPath ?? ""} · {event.reasonCode ?? "—"}
											</Field>
										))
									)}
								</CardContent>
							</Card>
						</Grid>
					</Grid>
				)}
			</QueryState>
		</>
	);
}
```

- [ ] **Step 5: 통과 확인 후 Commit**

Run: `cd admin-console && npx vitest run src/pages/DeviceDetailPage.test.tsx && npm run typecheck`
Expected: PASS 2건.

```bash
git add admin-console/src/pages/DeviceDetailPage.tsx admin-console/src/pages/DeviceDetailPage.test.tsx admin-console/src/app/routes.tsx
git commit -m "feat(console): Device 상세 화면 구현 (Issue #7)"
```

---

### Task 8: Security Events 목록·상세 화면

**Files:**
- Create: `admin-console/src/features/securityEvent/{api.ts,queries.ts,labels.ts,SecurityEventFilters.tsx}`
- Modify: `admin-console/src/pages/SecurityEventsPage.tsx`
- Test: `admin-console/src/pages/SecurityEventsPage.test.tsx`

**Interfaces:**
- Produces:
  - `fetchSecurityEvents(params: SecurityEventListParams): Promise<PageResponse<SecurityEvent>>` where `SecurityEventListParams = { from?, to?, deviceId?, decision?, reasonCode?, severity?, page, size }`
  - `fetchSecurityEvent(eventId: string): Promise<SecurityEvent>`
  - `useSecurityEvents(params)`, `useSecurityEvent(eventId)`, `securityEventKeys`
  - `decisionLabel/decisionColor/severityLabel/severityColor`

- [ ] **Step 1: `api.ts`·`queries.ts` 작성**

```ts
// features/securityEvent/api.ts
import { apiGet } from "../../shared/api/client";
import type { PageResponse, SecurityEvent } from "../../shared/api/types";

export interface SecurityEventListParams {
	from?: string;
	to?: string;
	deviceId?: string;
	decision?: string;
	reasonCode?: string;
	severity?: string;
	page: number;
	size: number;
}

export function fetchSecurityEvents(params: SecurityEventListParams): Promise<PageResponse<SecurityEvent>> {
	return apiGet("/security-events", { ...params });
}

export function fetchSecurityEvent(eventId: string): Promise<SecurityEvent> {
	return apiGet(`/security-events/${eventId}`);
}
```

```ts
// features/securityEvent/queries.ts
import { useQuery } from "@tanstack/react-query";
import { fetchSecurityEvent, fetchSecurityEvents, type SecurityEventListParams } from "./api";

export const securityEventKeys = {
	all: ["security-events"] as const,
	list: (params: SecurityEventListParams) => [...securityEventKeys.all, "list", params] as const,
	detail: (eventId: string) => [...securityEventKeys.all, "detail", eventId] as const,
};

export function useSecurityEvents(params: SecurityEventListParams) {
	return useQuery({ queryKey: securityEventKeys.list(params), queryFn: () => fetchSecurityEvents(params) });
}

export function useSecurityEvent(eventId: string) {
	return useQuery({
		queryKey: securityEventKeys.detail(eventId),
		queryFn: () => fetchSecurityEvent(eventId),
		enabled: eventId !== "",
	});
}
```

- [ ] **Step 2: `labels.ts` 작성**

```ts
import type { ChipColor } from "../../shared/ui/StatusChip";

export function decisionLabel(decision: string | null): string {
	switch (decision) {
		case "ALLOWED":
			return "허용";
		case "DENIED":
			return "차단";
		case "ERROR":
			return "오류";
		default:
			return "—";
	}
}

export function decisionColor(decision: string | null): ChipColor {
	switch (decision) {
		case "ALLOWED":
			return "success";
		case "DENIED":
			return "warning";
		case "ERROR":
			return "error";
		default:
			return "default";
	}
}

export function severityLabel(severity: string): string {
	switch (severity) {
		case "CRITICAL":
			return "심각";
		case "WARNING":
			return "경고";
		case "INFO":
			return "정보";
		default:
			return severity;
	}
}

export function severityColor(severity: string): ChipColor {
	switch (severity) {
		case "CRITICAL":
			return "error";
		case "WARNING":
			return "warning";
		default:
			return "info";
	}
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

`admin-console/src/pages/SecurityEventsPage.test.tsx` (Task 6의 `renderAt` 헬퍼를 그대로 재작성해 사용):

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { routes } from "../app/routes";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

describe("SecurityEventsPage", () => {
	it("renders decision and severity in Korean", async () => {
		renderAt("/security-events");
		expect(await screen.findByText("허용")).toBeInTheDocument();
		expect(screen.getByText("심각")).toBeInTheDocument();
	});

	it("shows 오류 and — for a SYSTEM event with no device or path", async () => {
		renderAt("/security-events");
		expect(await screen.findByText("EVENT_OUTBOX_BACKLOG")).toBeInTheDocument();
	});

	it("opens the detail drawer with traceId when a row is clicked", async () => {
		renderAt("/security-events");
		await userEvent.click(await screen.findByText("REQUEST_ALLOWED"));
		expect(await screen.findByText("8a6ba949-f3ec-4916-aae2-d55bd787893d")).toBeInTheDocument();
	});
});
```

- [ ] **Step 4: 실패 확인**

Run: `cd admin-console && npx vitest run src/pages/SecurityEventsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 5: `SecurityEventFilters.tsx` 작성**

ui-design.md §7 필터: 기간, 디바이스, 결과, 이벤트 코드, 심각도.

```tsx
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

interface Props {
	values: { from: string; to: string; decision: string; severity: string; reasonCode: string };
	onChange: (key: "from" | "to" | "decision" | "severity" | "reasonCode", value: string) => void;
}

export default function SecurityEventFilters({ values, onChange }: Props) {
	return (
		<Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
			<TextField
				label="시작"
				type="datetime-local"
				size="small"
				value={values.from}
				slotProps={{ inputLabel: { shrink: true } }}
				onChange={(event) => onChange("from", event.target.value)}
			/>
			<TextField
				label="종료"
				type="datetime-local"
				size="small"
				value={values.to}
				slotProps={{ inputLabel: { shrink: true } }}
				onChange={(event) => onChange("to", event.target.value)}
			/>
			<TextField
				select
				label="결과"
				size="small"
				sx={{ minWidth: 120 }}
				value={values.decision}
				onChange={(event) => onChange("decision", event.target.value)}
			>
				<MenuItem value="">전체</MenuItem>
				<MenuItem value="ALLOWED">허용</MenuItem>
				<MenuItem value="DENIED">차단</MenuItem>
				<MenuItem value="ERROR">오류</MenuItem>
			</TextField>
			<TextField
				select
				label="심각도"
				size="small"
				sx={{ minWidth: 120 }}
				value={values.severity}
				onChange={(event) => onChange("severity", event.target.value)}
			>
				<MenuItem value="">전체</MenuItem>
				<MenuItem value="CRITICAL">심각</MenuItem>
				<MenuItem value="WARNING">경고</MenuItem>
				<MenuItem value="INFO">정보</MenuItem>
			</TextField>
			<TextField
				label="Reason Code"
				size="small"
				sx={{ minWidth: 200 }}
				value={values.reasonCode}
				onChange={(event) => onChange("reasonCode", event.target.value)}
			/>
		</Box>
	);
}
```

`datetime-local` 값은 로컬 시간이므로 API로 보낼 때 `new Date(value).toISOString()`으로 변환한다.

- [ ] **Step 6: `SecurityEventsPage.tsx` 작성**

목록 컬럼(ui-design.md §7): 발생 시각, 디바이스, 요청 경로, 결과, 사유, 접속 IP, 응답 시간. 상세는 Drawer로 띄우고 인증서 Serial·HTTP Method·Trace ID를 보여준다.

```tsx
import { useState } from "react";
import Drawer from "@mui/material/Drawer";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import SecurityEventFilters from "../features/securityEvent/SecurityEventFilters";
import { useSecurityEvents } from "../features/securityEvent/queries";
import {
	decisionColor,
	decisionLabel,
	severityColor,
	severityLabel,
} from "../features/securityEvent/labels";
import type { SecurityEvent } from "../shared/api/types";
import { usePageParams } from "../shared/api/usePageParams";
import DataTable, { type Column } from "../shared/ui/DataTable";
import DateTimeText from "../shared/ui/DateTimeText";
import PageHeader from "../shared/ui/PageHeader";
import QueryState from "../shared/ui/QueryState";
import StatusChip from "../shared/ui/StatusChip";

const COLUMNS: Column<SecurityEvent>[] = [
	{ key: "occurredAt", header: "발생 시각", render: (row) => <DateTimeText value={row.occurredAt} /> },
	{
		key: "severity",
		header: "심각도",
		render: (row) => <StatusChip label={severityLabel(row.severity)} color={severityColor(row.severity)} />,
	},
	{ key: "requestPath", header: "요청 경로", render: (row) => row.requestPath ?? "—" },
	{
		key: "decision",
		header: "결과",
		render: (row) => <StatusChip label={decisionLabel(row.decision)} color={decisionColor(row.decision)} />,
	},
	{ key: "reasonCode", header: "사유", render: (row) => row.reasonCode ?? "—" },
	{ key: "clientIp", header: "접속 IP", render: (row) => row.clientIp ?? "—" },
	{ key: "latencyMs", header: "응답(ms)", render: (row) => (row.latencyMs === null ? "—" : row.latencyMs) },
];

/** 로컬 datetime-local 값을 서버가 받는 UTC ISO 8601로 바꾼다. */
function toIso(localValue: string): string | undefined {
	if (!localValue) {
		return undefined;
	}
	const date = new Date(localValue);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export default function SecurityEventsPage() {
	const { page, size, setPage, setSize, setParam, get } = usePageParams();
	const [selected, setSelected] = useState<SecurityEvent | null>(null);

	const values = {
		from: get("from") ?? "",
		to: get("to") ?? "",
		decision: get("decision") ?? "",
		severity: get("severity") ?? "",
		reasonCode: get("reasonCode") ?? "",
	};

	const events = useSecurityEvents({
		from: toIso(values.from),
		to: toIso(values.to),
		decision: values.decision || undefined,
		severity: values.severity || undefined,
		reasonCode: values.reasonCode || undefined,
		page,
		size,
	});

	return (
		<>
			<PageHeader title="Security Events" />
			<SecurityEventFilters values={values} onChange={(key, value) => setParam(key, value)} />
			<QueryState
				isLoading={events.isPending}
				isError={events.isError}
				error={events.error}
				isEmpty={events.data?.content.length === 0}
				emptyMessage="조건에 맞는 보안 이벤트가 없습니다."
				onRetry={() => events.refetch()}
			>
				<DataTable
					columns={COLUMNS}
					rows={events.data?.content ?? []}
					getRowId={(row) => row.id}
					page={page}
					size={size}
					totalElements={events.data?.totalElements ?? 0}
					onPageChange={setPage}
					onSizeChange={setSize}
					onRowClick={setSelected}
				/>
			</QueryState>

			<Drawer anchor="right" open={selected !== null} onClose={() => setSelected(null)}>
				<Box sx={{ width: 420, p: 3 }}>
					<Typography variant="h6" gutterBottom>
						보안 이벤트 상세
					</Typography>
					{selected && (
						<Stack spacing={1}>
							<Typography variant="body2">
								발생 시각: <DateTimeText value={selected.occurredAt} />
							</Typography>
							<Typography variant="body2">유형: {selected.type}</Typography>
							<Typography variant="body2">심각도: {severityLabel(selected.severity)}</Typography>
							<Typography variant="body2">결과: {decisionLabel(selected.decision)}</Typography>
							<Typography variant="body2">사유: {selected.reasonCode ?? "—"}</Typography>
							<Typography variant="body2">인증서 Serial: {selected.certificateSerial ?? "—"}</Typography>
							<Typography variant="body2">
								HTTP: {selected.httpMethod ?? "—"} {selected.requestPath ?? ""}
							</Typography>
							<Typography variant="body2">접속 IP: {selected.clientIp ?? "—"}</Typography>
							<Typography variant="body2">Trace ID: {selected.traceId ?? "—"}</Typography>
						</Stack>
					)}
				</Box>
			</Drawer>
		</>
	);
}
```

보안 기록은 수정·삭제할 수 없으므로(ui-design.md §7) 이 화면에는 어떤 변경 동작도 넣지 않는다.

- [ ] **Step 7: 통과 확인 후 Commit**

Run: `cd admin-console && npx vitest run src/pages/SecurityEventsPage.test.tsx && npm run typecheck && npm test`
Expected: PASS 3건 + 기존 테스트 전부.

```bash
git add admin-console/src/features/securityEvent admin-console/src/pages/SecurityEventsPage.tsx admin-console/src/pages/SecurityEventsPage.test.tsx
git commit -m "feat(console): Security Events 목록·필터·상세를 실제 API에 연결 (Issue #7)"
```

**PR 3은 여기까지다.** PR 본문에 Task 3~8을 정리하고 Codex 리뷰를 받는다.

---

### Task 9: Certificate Requests 목록·상세·승인·거절

**Files:**
- Create: `admin-console/src/features/certificateRequest/{api.ts,queries.ts,labels.ts,DecisionDialog.tsx}`
- Modify: `admin-console/src/pages/CertificateRequestsPage.tsx`
- Test: `admin-console/src/pages/CertificateRequestsPage.test.tsx`

**Interfaces:**
- Produces:
  - `fetchCertificateRequests({status?, deviceId?, page, size})`, `fetchCertificateRequest(requestId)`, `approveRequest(requestId, decisionNote?)`, `rejectRequest(requestId, decisionNote?)`
  - `useCertificateRequests(params)`, `useCertificateRequest(requestId)`, `useDecideRequest()`, `certificateRequestKeys`
  - `requestStatusLabel/requestStatusColor`

- [ ] **Step 1: `api.ts` 작성**

```ts
import { apiGet, apiSend } from "../../shared/api/client";
import type {
	CertificateRequestDetail,
	CertificateRequestItem,
	PageResponse,
} from "../../shared/api/types";

export interface CertificateRequestListParams {
	status?: string;
	deviceId?: string;
	page: number;
	size: number;
}

export function fetchCertificateRequests(
	params: CertificateRequestListParams,
): Promise<PageResponse<CertificateRequestItem>> {
	return apiGet("/certificate-requests", { ...params });
}

export function fetchCertificateRequest(requestId: string): Promise<CertificateRequestDetail> {
	return apiGet(`/certificate-requests/${requestId}`);
}

/** 서버는 본문 생략을 허용한다. 메모가 없으면 아예 보내지 않는다. */
export function decideRequest(
	requestId: string,
	action: "approve" | "reject",
	decisionNote?: string,
): Promise<CertificateRequestItem> {
	const body = decisionNote ? { decisionNote } : undefined;
	return apiSend("POST", `/certificate-requests/${requestId}/${action}`, body);
}
```

- [ ] **Step 2: `labels.ts` 작성**

```ts
import type { ChipColor } from "../../shared/ui/StatusChip";
import type { CertificateRequestStatus } from "../../shared/api/types";

export function requestStatusLabel(status: CertificateRequestStatus): string {
	switch (status) {
		case "PENDING":
			return "승인 대기";
		case "APPROVED":
			return "발급 완료";
		case "REJECTED":
			return "거절";
	}
}

export function requestStatusColor(status: CertificateRequestStatus): ChipColor {
	switch (status) {
		case "PENDING":
			return "warning";
		case "APPROVED":
			return "success";
		case "REJECTED":
			return "default";
	}
}
```

- [ ] **Step 3: `queries.ts` 작성 — 승인·거절 후 관련 Query 무효화**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	decideRequest,
	fetchCertificateRequest,
	fetchCertificateRequests,
	type CertificateRequestListParams,
} from "./api";
import { deviceKeys } from "../device/queries";

export const certificateRequestKeys = {
	all: ["certificate-requests"] as const,
	list: (params: CertificateRequestListParams) => [...certificateRequestKeys.all, "list", params] as const,
	detail: (requestId: string) => [...certificateRequestKeys.all, "detail", requestId] as const,
};

export function useCertificateRequests(params: CertificateRequestListParams) {
	return useQuery({
		queryKey: certificateRequestKeys.list(params),
		queryFn: () => fetchCertificateRequests(params),
	});
}

export function useCertificateRequest(requestId: string) {
	return useQuery({
		queryKey: certificateRequestKeys.detail(requestId),
		queryFn: () => fetchCertificateRequest(requestId),
		enabled: requestId !== "",
	});
}

export function useDecideRequest() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { requestId: string; action: "approve" | "reject"; decisionNote?: string }) =>
			decideRequest(input.requestId, input.action, input.decisionNote),
		onSuccess: () => {
			// 승인은 Certificate를 발급하고 Device 상세의 인증서 요약도 바꾼다.
			void queryClient.invalidateQueries({ queryKey: certificateRequestKeys.all });
			void queryClient.invalidateQueries({ queryKey: ["certificates"] });
			void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
		},
	});
}
```

- [ ] **Step 4: 실패하는 테스트 작성**

`admin-console/src/pages/CertificateRequestsPage.test.tsx` — 핵심은 **409 경합 처리**다. 서버는 이미 처리된 요청에 `409 CERTIFICATE_REQUEST_NOT_PENDING`을 준다.

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

describe("CertificateRequestsPage", () => {
	it("shows PENDING requests in Korean", async () => {
		renderAt("/certificate-requests");
		expect(await screen.findByText("승인 대기")).toBeInTheDocument();
	});

	it("shows the SAN URI and fingerprint but never the raw CSR", async () => {
		renderAt("/certificate-requests");
		await userEvent.click(await screen.findByText("승인 대기"));

		expect(await screen.findByText("urn:certgate:device:sensor-floor-01")).toBeInTheDocument();
		const body = document.body.textContent ?? "";
		expect(body).not.toContain("BEGIN CERTIFICATE REQUEST");
	});

	it("surfaces the 409 message when the request is no longer PENDING", async () => {
		mockServer.use(
			http.post("/api/v1/certificate-requests/:requestId/approve", () =>
				HttpResponse.json(
					{
						code: "CERTIFICATE_REQUEST_NOT_PENDING",
						message: "이미 처리된 요청입니다.",
						traceId: "trace-3",
						fieldErrors: [],
					},
					{ status: 409 },
				),
			),
		);
		renderAt("/certificate-requests");
		await userEvent.click(await screen.findByText("승인 대기"));
		await userEvent.click(await screen.findByRole("button", { name: "승인" }));
		await userEvent.click(await screen.findByRole("button", { name: "승인하기" }));

		expect(await screen.findByText("이미 처리된 요청입니다.")).toBeInTheDocument();
	});
});
```

- [ ] **Step 5: 실패 확인**

Run: `cd admin-console && npx vitest run src/pages/CertificateRequestsPage.test.tsx`
Expected: FAIL.

- [ ] **Step 6: `DecisionDialog.tsx` 작성**

```tsx
import TextField from "@mui/material/TextField";
import ConfirmDialog from "../../shared/ui/ConfirmDialog";

interface Props {
	open: boolean;
	action: "approve" | "reject";
	decisionNote: string;
	isPending: boolean;
	error: unknown;
	onNoteChange: (value: string) => void;
	onConfirm: () => void;
	onClose: () => void;
}

export default function DecisionDialog({
	open,
	action,
	decisionNote,
	isPending,
	error,
	onNoteChange,
	onConfirm,
	onClose,
}: Props) {
	const isReject = action === "reject";
	return (
		<ConfirmDialog
			open={open}
			title={isReject ? "인증서 요청 거절" : "인증서 요청 승인"}
			description={
				isReject
					? "거절 사유를 남기면 요청 이력에 함께 보관됩니다."
					: "승인하면 Intermediate CA가 인증서를 발급합니다. 승인 전에 Device Key와 SAN URI가 일치하는지 확인하세요."
			}
			confirmLabel={isReject ? "거절하기" : "승인하기"}
			confirmColor={isReject ? "error" : "primary"}
			isPending={isPending}
			error={error}
			onConfirm={onConfirm}
			onClose={onClose}
			confirmDisabled={isReject && decisionNote.trim() === ""}
		>
			<TextField
				label={isReject ? "거절 사유 (필수)" : "메모 (선택)"}
				fullWidth
				multiline
				minRows={2}
				value={decisionNote}
				onChange={(event) => onNoteChange(event.target.value)}
			/>
		</ConfirmDialog>
	);
}
```

거절은 ui-design.md §5 "사유를 포함한 거절"이므로 사유가 비면 확인 버튼을 비활성화한다.

- [ ] **Step 7: `CertificateRequestsPage.tsx` 작성**

목록 컬럼(ui-design.md §5): 요청 ID, 디바이스, SAN URI, 키 알고리즘, 요청일, 상태. SAN URI·알고리즘은 상세에만 있으므로 목록에는 요청 ID·디바이스·요청일·상태를 놓고, 행 클릭 시 Drawer에서 상세(`subjectDn`, `sanUri`, `publicKeyAlgorithm`, `fingerprintSha256`)를 보여준다.

주요 구성:
- `usePageParams()`로 `status` 필터(전체/PENDING/APPROVED/REJECTED)와 페이지 관리
- `useCertificateRequests({status, page, size})`
- 행 클릭 → `selectedId` 상태 → `useCertificateRequest(selectedId)`로 Drawer 내용 로드
- Drawer 안에 **승인**·**거절** 버튼. `status !== "PENDING"`이면 두 버튼을 렌더링하지 않는다(Issue #7 완료 기준 "구현되지 않은 동작은 비활성 또는 숨김").
- 버튼 클릭 → `DecisionDialog` 열기 → `useDecideRequest().mutate({requestId, action, decisionNote})`
- Mutation 성공 시 Drawer를 닫고 목록이 자동 갱신된다(Step 3의 `invalidateQueries`).
- `csrPem`은 서버가 주지 않으므로 화면에도 없다(ui-design.md §5 "Device 개인키는 서버와 관리 화면에 저장하거나 표시하지 않는다").

- [ ] **Step 8: 통과 확인 후 Commit**

Run: `cd admin-console && npx vitest run src/pages/CertificateRequestsPage.test.tsx && npm run typecheck`
Expected: PASS 3건.

```bash
git add admin-console/src/features/certificateRequest admin-console/src/pages/CertificateRequestsPage.tsx admin-console/src/pages/CertificateRequestsPage.test.tsx
git commit -m "feat(console): CSR 목록·상세와 승인·거절 동작 구현 (Issue #7)"
```

---

### Task 10: Certificates 목록·상세·폐기·다운로드

**Files:**
- Create: `admin-console/src/features/certificate/{api.ts,queries.ts,RevokeDialog.tsx}`
- Modify: `admin-console/src/pages/CertificatesPage.tsx`
- Test: `admin-console/src/pages/CertificatesPage.test.tsx`

**Interfaces:**
- Consumes: `certificateStatusLabel`/`certificateStatusColor` (Task 6 `features/device/labels.ts`).
- Produces: `fetchCertificates({status?, deviceId?, expiresBefore?, page, size})`, `fetchCertificate(id)`, `downloadCertificatePem(id)`, `revokeCertificate(id, {reason, note})`, `useCertificates`, `useCertificate`, `useRevokeCertificate`, `certificateKeys`.

- [ ] **Step 1: `api.ts` 작성**

```ts
import { apiGet, apiGetText, apiSend } from "../../shared/api/client";
import type { CertificateItem, PageResponse } from "../../shared/api/types";

export interface CertificateListParams {
	status?: string;
	deviceId?: string;
	expiresBefore?: string;
	page: number;
	size: number;
}

export function fetchCertificates(params: CertificateListParams): Promise<PageResponse<CertificateItem>> {
	return apiGet("/certificates", { ...params });
}

export function fetchCertificate(certificateId: string): Promise<CertificateItem> {
	return apiGet(`/certificates/${certificateId}`);
}

/** 공개 인증서만 내려받는다. Private Key는 서버에 존재하지 않는다. */
export function downloadCertificatePem(certificateId: string): Promise<string> {
	return apiGetText(`/certificates/${certificateId}/download`);
}

export function revokeCertificate(
	certificateId: string,
	body: { reason: string; note?: string },
): Promise<CertificateItem> {
	return apiSend("POST", `/certificates/${certificateId}/revoke`, body);
}
```

- [ ] **Step 2: `queries.ts` 작성**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCertificate, fetchCertificates, revokeCertificate, type CertificateListParams } from "./api";
import { deviceKeys } from "../device/queries";

export const certificateKeys = {
	all: ["certificates"] as const,
	list: (params: CertificateListParams) => [...certificateKeys.all, "list", params] as const,
	detail: (certificateId: string) => [...certificateKeys.all, "detail", certificateId] as const,
};

export function useCertificates(params: CertificateListParams) {
	return useQuery({ queryKey: certificateKeys.list(params), queryFn: () => fetchCertificates(params) });
}

export function useCertificate(certificateId: string) {
	return useQuery({
		queryKey: certificateKeys.detail(certificateId),
		queryFn: () => fetchCertificate(certificateId),
		enabled: certificateId !== "",
	});
}

export function useRevokeCertificate() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: { certificateId: string; reason: string; note?: string }) =>
			revokeCertificate(input.certificateId, { reason: input.reason, note: input.note }),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: certificateKeys.all });
			void queryClient.invalidateQueries({ queryKey: deviceKeys.all });
		},
	});
}
```

- [ ] **Step 3: 실패하는 테스트 작성**

`admin-console/src/pages/CertificatesPage.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { routes } from "../app/routes";
import { mockServer } from "../mocks/server";

function renderAt(path: string) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	return render(
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>,
	);
}

describe("CertificatesPage", () => {
	it("renders the serial number and Korean status", async () => {
		renderAt("/certificates");
		expect(await screen.findByText("7F28A109")).toBeInTheDocument();
		expect(screen.getByText("유효")).toBeInTheDocument();
	});

	it("requires a revocation reason before enabling the confirm button", async () => {
		renderAt("/certificates");
		await userEvent.click(await screen.findByText("7F28A109"));
		await userEvent.click(await screen.findByRole("button", { name: "폐기" }));

		expect(screen.getByRole("button", { name: "폐기하기" })).toBeDisabled();
		await userEvent.type(screen.getByLabelText(/폐기 사유/), "KEY_COMPROMISE");
		expect(screen.getByRole("button", { name: "폐기하기" })).toBeEnabled();
	});

	it("surfaces the server message when revocation conflicts", async () => {
		mockServer.use(
			http.post("/api/v1/certificates/:certificateId/revoke", () =>
				HttpResponse.json(
					{ code: "CONFLICT", message: "이미 폐기된 인증서입니다.", traceId: "trace-5", fieldErrors: [] },
					{ status: 409 },
				),
			),
		);
		renderAt("/certificates");
		await userEvent.click(await screen.findByText("7F28A109"));
		await userEvent.click(await screen.findByRole("button", { name: "폐기" }));
		await userEvent.type(screen.getByLabelText(/폐기 사유/), "KEY_COMPROMISE");
		await userEvent.click(screen.getByRole("button", { name: "폐기하기" }));

		expect(await screen.findByText("이미 폐기된 인증서입니다.")).toBeInTheDocument();
	});
});
```

- [ ] **Step 4: 실패 확인**

Run: `cd admin-console && npx vitest run src/pages/CertificatesPage.test.tsx`
Expected: FAIL.

- [ ] **Step 5: `RevokeDialog.tsx` 작성**

`reason`은 필수·최대 64자, `note`는 최대 500자다(api-spec.md §5). 클라이언트에서 미리 막아 왕복을 줄이되, 서버 오류 메시지도 그대로 보여준다.

```tsx
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ConfirmDialog from "../../shared/ui/ConfirmDialog";

interface Props {
	open: boolean;
	serialNumber: string;
	reason: string;
	note: string;
	isPending: boolean;
	error: unknown;
	onReasonChange: (value: string) => void;
	onNoteChange: (value: string) => void;
	onConfirm: () => void;
	onClose: () => void;
}

export default function RevokeDialog({
	open,
	serialNumber,
	reason,
	note,
	isPending,
	error,
	onReasonChange,
	onNoteChange,
	onConfirm,
	onClose,
}: Props) {
	return (
		<ConfirmDialog
			open={open}
			title={`인증서 폐기 (${serialNumber})`}
			description="폐기하면 Gateway가 해당 인증서의 접근을 차단합니다. 되돌릴 수 없으며, 재발급은 새 CSR 요청으로 처리합니다."
			confirmLabel="폐기하기"
			confirmColor="error"
			isPending={isPending}
			error={error}
			onConfirm={onConfirm}
			onClose={onClose}
			confirmDisabled={reason.trim() === "" || reason.length > 64 || note.length > 500}
		>
			<Stack spacing={2}>
				<TextField
					label="폐기 사유 (필수, 64자 이내)"
					fullWidth
					required
					value={reason}
					error={reason.length > 64}
					helperText={`${reason.length}/64`}
					onChange={(event) => onReasonChange(event.target.value)}
				/>
				<TextField
					label="메모 (선택, 500자 이내)"
					fullWidth
					multiline
					minRows={2}
					value={note}
					error={note.length > 500}
					helperText={`${note.length}/500`}
					onChange={(event) => onNoteChange(event.target.value)}
				/>
			</Stack>
		</ConfirmDialog>
	);
}
```

- [ ] **Step 6: `CertificatesPage.tsx` 작성**

목록 컬럼(ui-design.md §6): Serial Number, 디바이스, 상태, 발급일, 만료일. "발급 CA"는 서버 응답에 없으므로 컬럼을 만들지 않는다(없는 값을 화면에 지어내지 않는다).

구성:
- 필터: 상태 Select(전체/VALID/EXPIRING_SOON/EXPIRED/REVOKED), 만료 기간(`expiresBefore` datetime-local → ISO 변환)
- 행 클릭 → Drawer 상세: Serial, 상태, 유효기간(notBefore~notAfter), 발급일, 폐기 정보(revokedAt/reason/note)
- Drawer 버튼 2개:
  - **공개 인증서 다운로드**: `downloadCertificatePem(id)` → `new Blob([pem], {type:"application/x-pem-file"})` → `URL.createObjectURL` → 임시 `<a download={`${serialNumber}.pem`}>` 클릭 → `URL.revokeObjectURL`
  - **폐기**: `status === "REVOKED"`면 렌더링하지 않는다. 그 외에는 `RevokeDialog`를 연다.

- [ ] **Step 7: 통과 확인 후 Commit**

Run: `cd admin-console && npx vitest run src/pages/CertificatesPage.test.tsx && npm run typecheck`
Expected: PASS 3건.

```bash
git add admin-console/src/features/certificate admin-console/src/pages/CertificatesPage.tsx admin-console/src/pages/CertificatesPage.test.tsx
git commit -m "feat(console): Certificate 목록·상세·다운로드·폐기 구현 (Issue #7)"
```

---

### Task 11: Device 등록·상태 변경·Role 변경·Token 재발급

**Files:**
- Create: `admin-console/src/features/device/{DeviceRegisterDialog.tsx,DeviceActions.tsx}`
- Modify: `admin-console/src/features/device/queries.ts` (mutation hook 추가)
- Modify: `admin-console/src/pages/DevicesPage.tsx` (등록 버튼), `admin-console/src/pages/DeviceDetailPage.tsx` (동작 버튼)
- Test: `admin-console/src/features/device/DeviceRegisterDialog.test.tsx`

**Interfaces:**
- Consumes: `registerDevice`, `updateDeviceStatus`, `updateDeviceRole`, `reissueEnrollmentToken` (Task 6 `api.ts`), `useRoles`.
- Produces: `useRegisterDevice()`, `useUpdateDeviceStatus()`, `useUpdateDeviceRole()`, `useReissueToken()` — 모두 성공 시 `deviceKeys.all` 무효화.

- [ ] **Step 1: mutation hook 추가**

`features/device/queries.ts`에 추가:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { registerDevice, reissueEnrollmentToken, updateDeviceRole, updateDeviceStatus } from "./api";
import type { DeviceStatus } from "../../shared/api/types";

function useDeviceMutation<TInput, TOutput>(mutationFn: (input: TInput) => Promise<TOutput>) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: deviceKeys.all }),
	});
}

export function useRegisterDevice() {
	return useDeviceMutation((input: { deviceKey: string; name: string; roleName: string }) =>
		registerDevice(input),
	);
}

export function useUpdateDeviceStatus() {
	return useDeviceMutation((input: { deviceId: string; status: DeviceStatus }) =>
		updateDeviceStatus(input.deviceId, input.status),
	);
}

export function useUpdateDeviceRole() {
	return useDeviceMutation((input: { deviceId: string; roleName: string }) =>
		updateDeviceRole(input.deviceId, input.roleName),
	);
}

export function useReissueToken() {
	return useDeviceMutation((input: { deviceId: string }) => reissueEnrollmentToken(input.deviceId));
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

Enrollment Token 취급이 이 Task에서 가장 중요하다. 평문은 응답에서 한 번만 오고 다시 조회할 수 없다.

`admin-console/src/features/device/DeviceRegisterDialog.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DeviceRegisterDialog from "./DeviceRegisterDialog";

function renderDialog() {
	const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<DeviceRegisterDialog open onClose={vi.fn()} />
		</QueryClientProvider>,
	);
}

describe("DeviceRegisterDialog", () => {
	it("disables 등록 until deviceKey, name and roleName are filled", async () => {
		renderDialog();
		expect(screen.getByRole("button", { name: "등록" })).toBeDisabled();
	});

	it("shows the enrollment token once with a warning that it cannot be viewed again", async () => {
		renderDialog();
		await userEvent.type(screen.getByLabelText(/Device Key/), "sensor-floor-09");
		await userEvent.type(screen.getByLabelText(/이름/), "9층 센서");
		await userEvent.click(screen.getByLabelText(/Role/));
		await userEvent.click(await screen.findByRole("option", { name: "SENSOR" }));
		await userEvent.click(screen.getByRole("button", { name: "등록" }));

		expect(await screen.findByText(/다시 조회할 수 없습니다/)).toBeInTheDocument();
	});
});
```

MSW handler에 등록 응답을 추가한다(`mocks/handlers.ts`):

```ts
	http.post(`${BASE}/devices`, () =>
		HttpResponse.json(
			{
				id: "9a9b9c9d-0000-4000-8000-000000000009",
				deviceKey: "sensor-floor-09",
				name: "9층 센서",
				status: "ACTIVE",
				roleName: "SENSOR",
				enrollmentToken: "cg_enroll_examplevalue",
				enrollmentExpiresAt: "2026-08-20T05:32:18Z",
				createdAt: "2026-08-19T05:32:18Z",
			},
			{ status: 201 },
		),
	),
```

- [ ] **Step 3: 실패 확인**

Run: `cd admin-console && npx vitest run src/features/device/DeviceRegisterDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 4: `DeviceRegisterDialog.tsx` 작성**

핵심 규칙: 발급된 `enrollmentToken`은 **컴포넌트 로컬 상태에만** 두고, 로그·URL·Query Cache에 남기지 않으며, 다이얼로그를 닫으면 사라진다. 다시 볼 수 없다는 경고를 함께 띄운다.

구성:
- 입력 3개: Device Key, 이름, Role(`useRoles()` Select)
- 셋 다 채워야 등록 버튼 활성화
- 성공 시 폼 대신 결과 패널로 전환: 평문 Token + 만료 시각 + "이 값은 지금만 확인할 수 있고 다시 조회할 수 없습니다." 경고 + 복사 버튼
- `DEVICE_KEY_DUPLICATE`(409) 등 서버 오류는 `ConfirmDialog`의 error 슬롯과 동일한 형식으로 표시

- [ ] **Step 5: `DeviceActions.tsx` 작성 후 상세 화면에 연결**

`DeviceDetailPage`의 `PageHeader actions`에 넣는다:
- **비활성화 / 활성화** 토글 — `useUpdateDeviceStatus`, `ConfirmDialog`로 확인
- **Role 변경** — `useRoles()` Select + `useUpdateDeviceRole`
- **Enrollment Token 재발급** — `useReissueToken`, 확인 다이얼로그에 "기존 활성 Token은 폐기됩니다" 명시(security-design.md §2), 성공 시 등록 다이얼로그와 같은 1회 노출 패널
- 삭제 버튼은 만들지 않는다(ui-design.md §4 "물리 삭제는 제공하지 않는다")

`DevicesPage`의 `PageHeader actions`에는 **디바이스 등록** 버튼을 넣어 `DeviceRegisterDialog`를 연다.

- [ ] **Step 6: 통과 확인 후 Commit**

Run: `cd admin-console && npm run typecheck && npm test`
Expected: 전부 통과.

```bash
git add admin-console/src/features/device admin-console/src/pages/DevicesPage.tsx admin-console/src/pages/DeviceDetailPage.tsx admin-console/src/mocks/handlers.ts
git commit -m "feat(console): Device 등록·상태·Role 변경과 Token 재발급 구현 (Issue #7)"
```

**PR 4는 여기까지다.**

---

### Task 12: `GET /api/v1/dashboard/summary` 구현

Dashboard 화면 전체가 이 API에 걸려 있다. Gateway Outbox 상태는 Management API가 직접 볼 수 없으므로 Gateway의 `GET /internal/outbox/stats`(PR #31에서 추가됨)를 호출해 채운다.

**Files:**
- Create: `management-api/src/main/java/tech/certgate/dashboard/{DashboardController.java,DashboardService.java,DashboardSummaryResponse.java,GatewayOutboxClient.java}`
- Modify: `management-api/src/main/java/tech/certgate/{device,certificate,enrollment,securityevent}` 각 Service에 집계 메서드
- Test: `management-api/src/test/java/tech/certgate/dashboard/DashboardIntegrationTests.java`

**Interfaces:**
- Produces: `GET /api/v1/dashboard/summary?from=&to=` → `DashboardSummaryResponse` (필드는 `admin-console/src/shared/api/types.ts`의 `DashboardSummary`와 1:1).
- `outbox`는 Gateway 조회 실패 시 **null**이다. Dashboard 하나 때문에 전체 응답을 500으로 만들지 않는다(architecture.md 장애 원칙: 부분 실패를 전체 실패로 확대하지 않는다).

- [ ] **Step 1: 실패하는 통합 테스트 작성**

```java
package tech.certgate.dashboard;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class DashboardIntegrationTests {

	@Autowired
	private MockMvc mockMvc;

	/** docs/api-spec.md §9 "Dashboard 응답 핵심 형태". */
	@Test
	void summary_returnsEveryContractField() throws Exception {
		mockMvc.perform(get("/api/v1/dashboard/summary"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.devices.active").isNumber())
				.andExpect(jsonPath("$.devices.total").isNumber())
				.andExpect(jsonPath("$.certificates.valid").isNumber())
				.andExpect(jsonPath("$.certificates.expiringSoon").isNumber())
				.andExpect(jsonPath("$.pendingCertificateRequests").isNumber())
				.andExpect(jsonPath("$.criticalEvents24h").isNumber())
				.andExpect(jsonPath("$.requestBuckets").isArray())
				.andExpect(jsonPath("$.services").isArray())
				.andExpect(jsonPath("$.recentCriticalEvents").isArray());
	}

	/**
	 * Gateway가 죽어 있어도 Dashboard 나머지는 보여야 한다. outbox만 null이 된다.
	 * (테스트 환경의 GATEWAY_INTERNAL_URL은 응답하지 않는 주소다.)
	 */
	@Test
	void summary_whenGatewayUnreachable_returnsNullOutboxNotError() throws Exception {
		mockMvc.perform(get("/api/v1/dashboard/summary"))
				.andExpect(status().isOk())
				.andExpect(jsonPath("$.outbox").doesNotExist());
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd management-api && ./gradlew test --tests "*DashboardIntegrationTests*"`
Expected: FAIL — 404.

- [ ] **Step 3: `DashboardSummaryResponse` 작성**

```java
package tech.certgate.dashboard;

import java.time.Instant;
import java.util.List;
import tech.certgate.securityevent.SecurityEventResponse;

/** docs/api-spec.md §9 "Dashboard 응답 핵심 형태". */
public record DashboardSummaryResponse(
		DeviceCounts devices,
		CertificateCounts certificates,
		long pendingCertificateRequests,
		long criticalEvents24h,
		List<RequestBucket> requestBuckets,
		List<ServiceHealth> services,
		OutboxStats outbox,
		List<SecurityEventResponse> recentCriticalEvents) {

	public record DeviceCounts(long active, long total) {
	}

	public record CertificateCounts(long valid, long expiringSoon) {
	}

	public record RequestBucket(Instant startedAt, long allowed, long denied) {
	}

	public record ServiceHealth(String name, String status, Integer latencyMs) {
	}

	public record OutboxStats(int pendingCount, int oldestAgeSeconds) {
	}
}
```

- [ ] **Step 4: `GatewayOutboxClient` 작성**

기존 `certificate/GatewayCacheClient.java`의 구성(RestClient·Internal Token 주입·Timeout)을 먼저 읽고 같은 방식을 따른다.

```java
package tech.certgate.dashboard;

import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Gateway의 SQLite Outbox는 Gateway 프로세스 안에만 있어서 Management API가
 * 직접 볼 수 없다(docs/api-spec.md §8 "Outbox 상태").
 */
@Component
public class GatewayOutboxClient {

	private static final Logger log = LoggerFactory.getLogger(GatewayOutboxClient.class);

	private final RestClient restClient;
	private final String internalToken;

	public GatewayOutboxClient(
			RestClient.Builder builder,
			@Value("${certgate.gateway.internal-url}") String gatewayInternalUrl,
			@Value("${certgate.gateway.internal-token}") String internalToken) {
		this.restClient = builder.baseUrl(gatewayInternalUrl).build();
		this.internalToken = internalToken;
	}

	/**
	 * 조회 실패는 비어 있는 값으로 돌려준다. Gateway가 죽었다고 Dashboard 전체가
	 * 500이 되면 오히려 운영자가 상황을 볼 수 없다.
	 */
	public Optional<DashboardSummaryResponse.OutboxStats> fetchStats() {
		try {
			return Optional.ofNullable(restClient.get()
					.uri("/internal/outbox/stats")
					.header("Authorization", "Bearer " + internalToken)
					.retrieve()
					.body(DashboardSummaryResponse.OutboxStats.class));
		} catch (RuntimeException failure) {
			log.warn("Gateway Outbox 상태를 조회하지 못했습니다", failure);
			return Optional.empty();
		}
	}
}
```

`application.yml`에 `certgate.gateway.internal-url`·`internal-token` 설정이 없으면 추가하고, `.env.example`·`compose.yaml`의 Management API 환경변수에도 대응 값을 넣는다(값 이름은 Gateway 쪽 `GATEWAY_INTERNAL_TOKEN`과 같은 것을 쓴다).

- [ ] **Step 5: `DashboardService`·`DashboardController` 작성**

`DashboardService`는 각 도메인 Service에 집계를 요청해 조립만 한다(도메인 간 직접 Repository 접근 금지).

각 도메인에 추가할 집계 메서드:
- `DeviceService.countByStatus()` → `(active, total)`
- `CertificateService.countValidAndExpiringSoon(Instant now)` → `(valid, expiringSoon)` — 상태는 저장하지 않고 `revokedAt`/`notAfter`로 계산한다(api-spec.md §5)
- `EnrollmentService.countPendingRequests()`
- `SecurityEventService.countCriticalSince(Instant from)`, `findRecentCritical(int limit)`, `countDecisionBuckets(Instant from, Instant to)` → 시간별 `allowed`/`denied`

`services`는 3개를 채운다:
- `management-api`: 항상 `UP`, `latencyMs = 0`
- `postgres`: 간단한 `SELECT 1`을 실행해 성공하면 `UP`, 걸린 시간을 `latencyMs`
- `gateway`: `GatewayOutboxClient.fetchStats()`가 값을 주면 `UP`, 아니면 `DOWN`

`from`·`to`는 생략 가능하며 기본은 "최근 24시간"이다(`Clock` 주입 — development-guide.md 규칙).

`DashboardController`:

```java
@RestController
@RequestMapping("/api/v1/dashboard")
public class DashboardController {

	private final DashboardService dashboardService;

	public DashboardController(DashboardService dashboardService) {
		this.dashboardService = dashboardService;
	}

	@GetMapping("/summary")
	public DashboardSummaryResponse summary(
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant from,
			@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) Instant to) {
		return dashboardService.summarize(from, to);
	}
}
```

- [ ] **Step 6: 통과 확인 후 Commit**

Run: `cd management-api && ./gradlew test`
Expected: BUILD SUCCESSFUL.

```bash
git add management-api/src/main/java/tech/certgate management-api/src/test/java/tech/certgate/dashboard management-api/src/main/resources/application.yml .env.example infra/compose.yaml
git commit -m "feat(management-api): Dashboard 요약 API 구현 (Issue #7)"
```

**PR 2는 Task 2 + Task 12다.**

---

### Task 13: Dashboard 화면

**Files:**
- Create: `admin-console/src/features/dashboard/{api.ts,queries.ts,SummaryCards.tsx,ServiceHealth.tsx,OutboxPanel.tsx,RecentCriticalPanel.tsx}`
- Modify: `admin-console/src/pages/DashboardPage.tsx`
- Test: `admin-console/src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/v1/dashboard/summary` (Task 12), `severityLabel`/`decisionLabel` (Task 8).
- Produces: `fetchDashboardSummary(): Promise<DashboardSummary>`, `useDashboardSummary()`.

- [ ] **Step 1: 실패하는 테스트 작성**

```tsx
describe("DashboardPage", () => {
	it("renders the four summary cards", async () => {
		renderAt("/");
		expect(await screen.findByText("활성 디바이스")).toBeInTheDocument();
		expect(screen.getByText("24 / 27")).toBeInTheDocument();
		expect(screen.getByText("승인 대기 CSR")).toBeInTheDocument();
		expect(screen.getByText("Critical Event (24h)")).toBeInTheDocument();
	});

	it("renders the Gateway Outbox panel", async () => {
		renderAt("/");
		expect(await screen.findByText(/대기 12건/)).toBeInTheDocument();
	});

	it("says the Outbox state is unavailable when the server returns null", async () => {
		mockServer.use(
			http.get("/api/v1/dashboard/summary", () =>
				HttpResponse.json({ ...dashboardSummary, outbox: null }),
			),
		);
		renderAt("/");
		expect(await screen.findByText("Gateway Outbox 상태를 확인할 수 없습니다.")).toBeInTheDocument();
	});

	it("navigates to the security event when a recent critical item is clicked", async () => {
		renderAt("/");
		await userEvent.click(await screen.findByText("EVENT_OUTBOX_BACKLOG"));
		expect(await screen.findByText(/보안 이벤트/)).toBeInTheDocument();
	});
});
```

`dashboardSummary`는 `../mocks/fixtures`에서 import한다.

- [ ] **Step 2: 화면 구성**

ui-design.md §3 순서대로 배치한다.

1. **요약 카드 4개** — 활성 디바이스(`active / total`), 유효 인증서(`valid`, 만료 임박 `expiringSoon` 병기), 승인 대기 CSR, Critical Event(24h)
2. **최근 24시간 허용·차단 추이** — `requestBuckets`. 차트 라이브러리를 새로 넣지 않고 MUI `LinearProgress` 기반 막대 목록으로 표현한다(implementation-plan.md 후순위 항목이 "복잡한 Chart"다)
3. **서비스 상태** — `services` 배열을 `StatusChip`(UP=success, DOWN=error)과 `latencyMs`로 표시
4. **Gateway Outbox** — `outbox`가 null이면 "Gateway Outbox 상태를 확인할 수 없습니다."를 보여준다. 값이 있으면 "대기 {pendingCount}건 · 최고 지연 {oldestAgeSeconds}초", `pendingCount >= 100` 또는 `oldestAgeSeconds >= 60`이면 error 색으로 강조한다(security-design.md §9 임계치와 같은 값)
5. **최근 Critical Event 패널** — `recentCriticalEvents`. 항목 클릭 시 `navigate(`/security-events?reasonCode=${reasonCode}`)`로 이동한다(ui-design.md §3 "패널 항목 클릭 시 보안 이벤트 상세로 이동")

- [ ] **Step 3: 통과 확인 후 Commit**

Run: `cd admin-console && npx vitest run src/pages/DashboardPage.test.tsx && npm run typecheck`

```bash
git add admin-console/src/features/dashboard admin-console/src/pages/DashboardPage.tsx admin-console/src/pages/DashboardPage.test.tsx
git commit -m "feat(console): Dashboard 요약·서비스 상태·Outbox 패널 구현 (Issue #7)"
```

---

### Task 14: SSE 전역 CRITICAL Toast와 재연결 보완 조회

Issue #6에서 Console로 넘어온 마지막 항목이다.

**Files:**
- Create: `admin-console/src/app/CriticalEventProvider.tsx`
- Modify: `admin-console/src/App.tsx`
- Test: `admin-console/src/app/CriticalEventProvider.test.tsx`

**Interfaces:**
- Consumes: `VITE_SSE_URL` (`shared/api/env.ts`), `fetchSecurityEvents` (Task 8).
- Produces: `<CriticalEventProvider>` — 자식을 그대로 렌더링하고 화면 오른쪽 위에 Toast Stack을 띄운다.

동작 규칙(ui-design.md §8):
- 연결 유지, `critical-security-event` 이벤트 수신 시 Toast 추가
- Toast에 **알림 유형(reasonCode 한국어 message), 디바이스(deviceKey), 발생 시각**을 표시
- **자동으로 사라지지 않는다.** 사용자가 닫아야 한다 (`autoHideDuration` 없음)
- 클릭 시 해당 Security Event로 이동
- 닫아도 원본 Event는 남는다 (Toast는 화면 상태일 뿐 서버에 아무 것도 보내지 않는다)
- **재연결 후 보완 조회**: `EventSource`의 `onerror` 후 브라우저가 자동 재연결하므로, `onopen`이 다시 불릴 때 마지막으로 본 시각 이후의 `severity=CRITICAL` 목록을 `GET /security-events?severity=CRITICAL&from=...`로 조회해 놓친 Event를 Toast로 채운다. 이미 본 `eventId`는 Set으로 걸러 중복 Toast를 만들지 않는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`EventSource`는 jsdom에 없으므로 테스트용 가짜를 만든다.

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import CriticalEventProvider from "./CriticalEventProvider";

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	listeners = new Map<string, (event: MessageEvent) => void>();
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	close = vi.fn();

	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, handler: (event: MessageEvent) => void) {
		this.listeners.set(type, handler);
	}

	emit(type: string, data: unknown) {
		this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
	}
}

function renderProvider() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={queryClient}>
			<MemoryRouter>
				<CriticalEventProvider>
					<div>app</div>
				</CriticalEventProvider>
			</MemoryRouter>
		</QueryClientProvider>,
	);
}

afterEach(() => {
	FakeEventSource.instances = [];
	vi.unstubAllGlobals();
});

describe("CriticalEventProvider", () => {
	it("shows a toast with the message, device key and time on a critical event", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		renderProvider();

		FakeEventSource.instances[0].emit("critical-security-event", {
			eventId: "c8c78370-174f-4f88-b230-784e2d9115be",
			occurredAt: "2026-08-19T05:50:00Z",
			deviceKey: "sensor-floor-03",
			reasonCode: "CERTIFICATE_REVOKED",
			message: "폐기된 인증서의 접근이 차단되었습니다.",
		});

		expect(await screen.findByText("폐기된 인증서의 접근이 차단되었습니다.")).toBeInTheDocument();
		expect(screen.getByText(/sensor-floor-03/)).toBeInTheDocument();
	});

	it("does not auto-dismiss the toast", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		vi.useFakeTimers();
		renderProvider();
		FakeEventSource.instances[0].emit("critical-security-event", {
			eventId: "e1",
			occurredAt: "2026-08-19T05:50:00Z",
			deviceKey: null,
			reasonCode: "EVENT_OUTBOX_BACKLOG",
			message: "Gateway Security Event Outbox가 적체되었습니다.",
		});
		await vi.advanceTimersByTimeAsync(60_000);
		vi.useRealTimers();

		expect(screen.getByText("Gateway Security Event Outbox가 적체되었습니다.")).toBeInTheDocument();
	});

	it("ignores a repeated eventId so a reconnect backfill does not duplicate toasts", async () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		renderProvider();
		const payload = {
			eventId: "same-id",
			occurredAt: "2026-08-19T05:50:00Z",
			deviceKey: "sensor-floor-03",
			reasonCode: "CERTIFICATE_REVOKED",
			message: "폐기된 인증서의 접근이 차단되었습니다.",
		};
		FakeEventSource.instances[0].emit("critical-security-event", payload);
		FakeEventSource.instances[0].emit("critical-security-event", payload);

		expect(await screen.findAllByText("폐기된 인증서의 접근이 차단되었습니다.")).toHaveLength(1);
	});

	it("closes the connection on unmount", () => {
		vi.stubGlobal("EventSource", FakeEventSource);
		const { unmount } = renderProvider();
		unmount();
		expect(FakeEventSource.instances[0].close).toHaveBeenCalled();
	});
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd admin-console && npx vitest run src/app/CriticalEventProvider.test.tsx`
Expected: FAIL.

- [ ] **Step 3: `CriticalEventProvider.tsx` 작성**

구현 요점:
- `useEffect`에서 `new EventSource(securityEventStreamUrl)` 생성, cleanup에서 `close()`
- 표시된 `eventId`를 `useRef<Set<string>>`로 관리해 중복 Toast 차단
- `onopen`이 **두 번째 이후**로 불리면(= 재연결) 마지막 수신 시각 이후의 CRITICAL을 조회해 보완
- Toast는 MUI `Snackbar` + `Alert severity="error"`를 Stack으로 쌓고 `autoHideDuration`을 주지 않는다
- Toast 클릭 → `navigate(`/security-events?reasonCode=${reasonCode}`)` 후 해당 Toast 닫기

- [ ] **Step 4: `App.tsx`에 연결**

`RouterProvider`를 감싸도록 넣는다. `useNavigate`를 쓰므로 Router **안쪽**이어야 한다 — `routes.tsx`의 `AppLayout` 안에서 감싸거나, `AppLayout`에 `CriticalEventProvider`를 넣는다.

- [ ] **Step 5: 통과 확인 후 Commit**

Run: `cd admin-console && npm run typecheck && npm test`

```bash
git add admin-console/src/app admin-console/src/shared/ui/AppLayout.tsx
git commit -m "feat(console): CRITICAL Security Event 전역 SSE Toast와 재연결 보완 조회 (Issue #6, #7)"
```

**PR 5는 Task 13 + Task 14다.**

---

### Task 15: README 와이어프레임을 실제 화면으로 교체

Issue #7 완료 기준 마지막 항목이다.

**Files:**
- Modify: `README.md`, `docs/ui-design.md` §10
- Create: `docs/images/console-*.png` (5장)

- [ ] **Step 1: 스택 기동**

Run: `docker compose -f infra/compose.yaml --env-file .env up -d --build`
Expected: 전체 서비스 healthy. `.env`는 `.env.example`을 복사해 로컬 값으로 채운 것이며 Git에 올리지 않는다.

- [ ] **Step 2: Seed 데이터 준비**

Device 몇 개를 등록하고 Device Agent로 CSR을 제출해 승인·발급까지 한 뒤, 인증서 하나는 폐기해 CRITICAL Event를 만든다. 화면이 빈 상태로 캡처되지 않게 한다.

- [ ] **Step 3: 5개 화면 캡처**

`docs/images/`에 `console-dashboard.png`, `console-devices.png`, `console-certificate-requests.png`, `console-certificates.png`, `console-security-events.png`로 저장한다. **캡처에 실제 Token·Private Key·인증서 원문이 보이지 않는지 확인한다.**

- [ ] **Step 4: 문서 갱신**

- `README.md`의 와이어프레임 링크를 실제 화면 이미지로 교체한다.
- `docs/ui-design.md` §10에 "와이어프레임은 설계 단계 자료이고 실제 구현 화면은 README를 참고" 취지로 문장을 정리한다.
- 실행 방법(`npm run dev` + `VITE_USE_MOCK`, Compose 기동)을 `admin-console/README.md`에 적는다.

- [ ] **Step 5: Commit**

```bash
git checkout docs && git merge --ff-only main
git add README.md docs/ui-design.md docs/images admin-console/README.md
git commit -m "docs(console): 와이어프레임을 실제 구현 화면 캡처로 교체 (Issue #7)"
```

---

## Self-Review

**1. Spec coverage**

| 요구 (출처) | 담당 Task |
|---|---|
| Dashboard 화면 (ui-design §3) | 12, 13 |
| Devices 목록·상세·검색·필터 (§4) | 6, 7 |
| Device 등록·활성화/비활성화 (§4) | 11 |
| 인증서 요청 목록·상세·승인·거절 (§5) | 9 |
| 인증서 목록·상세·다운로드·폐기 (§6) | 10 |
| 보안 이벤트 목록·상세·필터 (§7) | 8 |
| 실시간 CRITICAL Toast·재연결 보완 (§8) | 14 |
| Mock Fixture = 실제 API Type (Issue #7) | 4 (`satisfies`로 강제) |
| 로딩·빈 상태·오류 상태 (Issue #7) | 5 (`QueryState`), 각 화면 테스트 |
| 별도 Alert 화면·상태 관리 없음 (Issue #7) | 5 (`usePageParams`로 URL 상태), 14 (Toast는 로컬 상태) |
| 미구현 동작 비활성/숨김 (Issue #7) | 9, 10, 11 (상태별 버튼 미렌더링) |
| README 실제 화면 교체 (Issue #7) | 15 |
| `GET /roles`, `GET /dashboard/summary` 미구현 | 2, 12 |

**2. 알려진 공백 (의도적)**

- ui-design.md §6의 목록 컬럼 "발급 CA"는 서버 응답에 없다. 없는 값을 지어내지 않고 컬럼을 만들지 않는다. 필요하면 별도 Issue로 서버 응답에 추가한다.
- ui-design.md §5의 목록 컬럼 "SAN URI·키 알고리즘"은 목록 API가 주지 않고 상세 API에만 있다. 목록에는 넣지 않고 상세에서 보여준다.
- ui-design.md §7 "동일 Trace ID로 관련 요청을 추적한다"는 상세에 Trace ID를 표시하는 데까지만 구현한다. Trace ID 기준 목록 필터는 서버 Query Parameter에 없다.
- 관리자 로그인은 MVP 제외다(api-spec.md §2). SSE 연결을 "로그인 후"가 아니라 앱 진입 시 연다.

**3. Type 일관성 확인**

- `DashboardSummary`(TS, Task 3)와 `DashboardSummaryResponse`(Java, Task 12)의 필드명이 1:1로 일치한다. `outbox`는 양쪽 모두 nullable이다.
- `ChipColor`는 `shared/ui/StatusChip.tsx`에서 한 번만 정의하고 모든 `labels.ts`가 import한다.
- `certificateStatusLabel`/`certificateStatusColor`는 `features/device/labels.ts`에 정의하고 Task 10이 재사용한다(중복 정의 금지).
- Query Key는 `deviceKeys`/`certificateKeys`/`certificateRequestKeys`/`securityEventKeys` 네 개뿐이며, 교차 무효화는 `certificateKeys.all` 같은 최상위 키로만 한다.

---

## Execution Handoff

계획을 `docs/superpowers/plans/2026-08-19-admin-console-api-integration.md`에 저장했다. 실행 방식은 두 가지다.

1. **Subagent-Driven (권장)** — Task마다 새 Subagent를 띄우고 사이사이 검토한다. Context가 짧게 유지돼 긴 계획에 유리하다.
2. **Inline 실행** — 이 세션에서 Task를 이어서 실행하고 체크포인트마다 확인한다.

---

## 추가 채택 항목 (2026-08-19 결정)

계획 수립 후 저장소를 조사하면서 발견한 격차 3건을 추가로 채택했다. Task 번호는 기존 Task의 상호 참조를 깨지 않도록 뒤에 붙이고, 실제 진행 순서는 위 "작업 순서와 PR 분할" 표를 갱신해 반영한다.

| PR | Branch | Task | 목적 |
|---|---|---|---|
| 1 | `infra` | 1 | same-origin proxy — 이후 전부의 선행 |
| 2 | `feature/management-api` | 2, 16, 12 | `GET /roles`, **JSON 구조화 로그**, `GET /dashboard/summary` |
| 3 | `feature/console` | 3, 18, 4, 5, 6, 7, 8 | 기반 + **디자인 톤** + 읽기 화면 3개 |
| 4 | `feature/console` | 9, 10, 11 | 쓰기 동작 |
| 5 | `feature/console` | 13, 14 | Dashboard + SSE Toast |
| 6 | `infra` | 17 | **CI 취약점 스캔** (임계 경로를 막지 않도록 뒤로) |
| 7 | `docs` | 15 | README 실제 화면 교체 |

조사에서 확인해 **추천하지 않기로** 한 것: Testcontainers 도입(이미 PostgreSQL로 통합 테스트가 돈다), Trace ID 전파(`TraceIdFilter`가 이미 구현돼 있다), Redis·Kafka·Alert Domain·Webhook(ai-usage.md 2026-08-13에 기각됨), Kubernetes·Cloud 배포(implementation-plan.md 후순위), OpenTelemetry(4일 일정에 안 맞음), Redux·Zustand(Issue #7 완료 기준이 "별도 상태 관리 없음"), Storybook(화면 5개 대비 효과 낮음).

---

### Task 16: management-api JSON 구조화 로그

`docs/operations.md` "로그"는 **모든 서비스**에 JSON 구조화 로그와 공통 필드를 요구한다. Gateway는 지키지만 management-api의 `application.yml`에는 로깅 설정이 아예 없어 Spring 기본 평문 로그가 나간다. 특히 `TraceIdFilter`가 MDC에 `traceId`를 넣는데 그것을 출력하는 포맷이 없어서 **어떤 로그에도 Trace ID가 찍히지 않는다.** 배관은 이미 있고 출력만 없는 상태다.

**Files:**
- Create: `management-api/src/main/java/tech/certgate/common/CertGateLogFormatter.java`
- Modify: `management-api/src/main/resources/application.yml`
- Test: `management-api/src/test/java/tech/certgate/common/CertGateLogFormatterTest.java`

**Interfaces:**
- Consumes: 기존 `TraceIdFilter`가 채우는 MDC 키 `traceId`.
- Produces: `logging.structured.format.console=tech.certgate.common.CertGateLogFormatter` 설정 시 모든 로그가 한 줄 JSON으로 나간다. 필드: `timestamp`, `level`, `service`, `logger`, `message`, 그리고 MDC에 있을 때만 `traceId`·`deviceKey`·`reasonCode`·`latencyMs`, 예외가 있으면 `error`.

- [ ] **Step 1: 실패하는 테스트 작성**

`management-api/src/test/java/tech/certgate/common/CertGateLogFormatterTest.java`:

```java
package tech.certgate.common;

import static org.assertj.core.api.Assertions.assertThat;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.LoggerContext;
import ch.qos.logback.classic.spi.LoggingEvent;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CertGateLogFormatterTest {

	private final CertGateLogFormatter formatter = new CertGateLogFormatter();
	private final ObjectMapper objectMapper = new ObjectMapper();

	private LoggingEvent event(Level level, String message, Map<String, String> mdc) {
		LoggingEvent event = new LoggingEvent();
		event.setLoggerContext(new LoggerContext());
		event.setLoggerName("tech.certgate.device.DeviceService");
		event.setLevel(level);
		event.setMessage(message);
		event.setTimeStamp(1_755_000_000_000L);
		event.setMDCPropertyMap(mdc);
		return event;
	}

	private JsonNode format(LoggingEvent event) throws Exception {
		String line = formatter.format(event);
		assertThat(line).endsWith("\n");
		return objectMapper.readTree(line);
	}

	/** docs/operations.md "로그": JSON 구조화 로그 공통 필드. */
	@Test
	void format_emitsCommonFieldsAsOneJsonLine() throws Exception {
		JsonNode json = format(event(Level.WARN, "device disabled", Map.of()));

		assertThat(json.get("timestamp").asText()).isEqualTo("2026-08-12T13:20:00Z");
		assertThat(json.get("level").asText()).isEqualTo("WARN");
		assertThat(json.get("service").asText()).isEqualTo("management-api");
		assertThat(json.get("message").asText()).isEqualTo("device disabled");
		assertThat(json.get("logger").asText()).isEqualTo("tech.certgate.device.DeviceService");
	}

	/**
	 * TraceIdFilter가 MDC에 넣은 traceId가 실제 로그 줄에 나타나야 한다. 이것이
	 * 없으면 오류를 요청과 연결할 방법이 없다(api-spec.md §1).
	 */
	@Test
	void format_includesTraceIdAndOptionalContextFromMdc() throws Exception {
		JsonNode json = format(event(Level.WARN, "blocked", Map.of(
				"traceId", "8a6ba949-f3ec-4916-aae2-d55bd787893d",
				"deviceKey", "sensor-floor-03",
				"reasonCode", "CERTIFICATE_REVOKED",
				"latencyMs", "8")));

		assertThat(json.get("traceId").asText()).isEqualTo("8a6ba949-f3ec-4916-aae2-d55bd787893d");
		assertThat(json.get("deviceKey").asText()).isEqualTo("sensor-floor-03");
		assertThat(json.get("reasonCode").asText()).isEqualTo("CERTIFICATE_REVOKED");
		assertThat(json.get("latencyMs").asInt()).isEqualTo(8);
	}

	/** 값이 없는 선택 필드는 아예 넣지 않는다 — null 잡음을 만들지 않는다. */
	@Test
	void format_omitsOptionalFieldsWhenMdcIsEmpty() throws Exception {
		JsonNode json = format(event(Level.INFO, "started", Map.of()));

		assertThat(json.has("traceId")).isFalse();
		assertThat(json.has("deviceKey")).isFalse();
		assertThat(json.has("reasonCode")).isFalse();
		assertThat(json.has("latencyMs")).isFalse();
	}

	/** 줄바꿈이 들어간 message가 JSON 한 줄 계약을 깨뜨리지 않아야 한다. */
	@Test
	void format_escapesNewlinesSoOneEventStaysOneLine() throws Exception {
		String line = formatter.format(event(Level.ERROR, "first\nsecond", Map.of()));

		assertThat(line.strip()).doesNotContain("\n");
		assertThat(objectMapper.readTree(line).get("message").asText()).isEqualTo("first\nsecond");
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd management-api && ./gradlew test --tests "*CertGateLogFormatterTest*"`
Expected: FAIL — `CertGateLogFormatter` 클래스가 없다.

- [ ] **Step 3: `CertGateLogFormatter` 작성**

```java
package tech.certgate.common;

import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.IThrowableProxy;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Map;
import org.springframework.boot.logging.structured.StructuredLogFormatter;

/**
 * docs/operations.md "로그"의 JSON 구조화 로그 공통 필드를 그대로 내보낸다. Go
 * Gateway가 이미 같은 필드명으로 로그를 남기므로 두 서비스의 로그를 한 파이프라인
 * 에서 같은 스키마로 읽을 수 있다.
 *
 * <p>선택 필드는 {@link TraceIdFilter}가 채운 MDC에서 가져오고, 값이 없으면 아예
 * 넣지 않는다. Secret·Token·Private Key·CSR·Certificate 원문·Telemetry Payload는
 * 어떤 경로로도 이 포맷터에 들어오지 않는다 — MDC에 그런 값을 넣지 않는 것이
 * 규칙이다(docs/security-design.md §10).
 *
 * <p>{@code logging.structured.format.console}에 이 클래스의 FQCN을 지정해 활성화
 * 한다. 로깅 시스템이 Environment 바인딩보다 먼저 초기화되므로 service 이름은
 * 상수로 둔다({@code spring.application.name}과 같은 값을 유지한다).
 */
public class CertGateLogFormatter implements StructuredLogFormatter<ILoggingEvent> {

	private static final String SERVICE = "management-api";
	private static final DateTimeFormatter TIMESTAMP = DateTimeFormatter.ISO_INSTANT;

	private final ObjectMapper objectMapper = new ObjectMapper();

	@Override
	public String format(ILoggingEvent event) {
		ObjectNode json = this.objectMapper.createObjectNode();
		json.put("timestamp", TIMESTAMP.format(event.getInstant().atOffset(ZoneOffset.UTC)));
		json.put("level", event.getLevel().toString());
		json.put("service", SERVICE);
		json.put("logger", event.getLoggerName());
		json.put("message", event.getFormattedMessage());

		Map<String, String> mdc = event.getMDCPropertyMap();
		putIfPresent(json, mdc, "traceId");
		putIfPresent(json, mdc, "deviceKey");
		putIfPresent(json, mdc, "reasonCode");
		putIntIfPresent(json, mdc, "latencyMs");

		IThrowableProxy throwable = event.getThrowableProxy();
		if (throwable != null) {
			json.put("error", ThrowableProxyUtil.asString(throwable));
		}

		// Jackson이 message·error의 줄바꿈과 인용부호를 escape하므로 한 Event가
		// 항상 한 줄이다. 마지막 개행은 StructuredLogFormatter 계약이다.
		return json.toString() + "\n";
	}

	private static void putIfPresent(ObjectNode json, Map<String, String> mdc, String key) {
		String value = mdc.get(key);
		if (value != null && !value.isBlank()) {
			json.put(key, value);
		}
	}

	private static void putIntIfPresent(ObjectNode json, Map<String, String> mdc, String key) {
		String value = mdc.get(key);
		if (value == null || value.isBlank()) {
			return;
		}
		try {
			json.put(key, Integer.parseInt(value));
		} catch (NumberFormatException notANumber) {
			json.put(key, value);
		}
	}
}
```

- [ ] **Step 4: `application.yml`에 포맷터 등록**

`server:` 블록 앞에 추가한다:

```yaml
logging:
  structured:
    format:
      console: tech.certgate.common.CertGateLogFormatter
```

- [ ] **Step 5: 통과 확인**

Run: `cd management-api && ./gradlew test --tests "*CertGateLogFormatterTest*"`
Expected: PASS 4건.

Run: `cd management-api && ./gradlew test`
Expected: BUILD SUCCESSFUL. 통합 테스트 출력이 JSON 한 줄 형식으로 바뀐 것을 눈으로 확인한다.

- [ ] **Step 6: Commit**

```bash
git add management-api/src/main/java/tech/certgate/common/CertGateLogFormatter.java management-api/src/main/resources/application.yml management-api/src/test/java/tech/certgate/common/CertGateLogFormatterTest.java
git commit -m "feat(management-api): operations.md 스키마의 JSON 구조화 로그 적용"
```

---

### Task 17: CI 의존성·이미지 취약점 스캔

현재 `secret-scan` job은 gitleaks와 Key·`.env` 파일 검사까지다. 인증서·Key·Token을 다루는 프로젝트에 의존성·이미지 취약점 스캔이 없다.

**임계 경로를 막지 않도록 Console 작업 뒤(8/22)에 진행한다.** 기존 의존성에서 취약점이 나오면 수정 작업이 파생될 수 있어서, Console이 끝나기 전에 넣으면 일정이 흔들린다.

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/development-guide.md` "필수 검증"

**Interfaces:**
- Produces: CI job `vuln-scan`. 실패 조건은 **HIGH·CRITICAL만** — MEDIUM 이하로 임계 경로를 막지 않는다.

- [ ] **Step 1: Go 모듈 취약점 스캔 Step 추가**

`ci.yml`의 `go` job 마지막에 추가한다. `govulncheck`는 호출 그래프를 분석해 실제로 도달하는 취약점만 보고하므로 잡음이 적다.

```yaml
      - name: govulncheck
        working-directory: ${{ matrix.module }}
        run: |
          go install golang.org/x/vuln/cmd/govulncheck@latest
          "$(go env GOPATH)/bin/govulncheck" ./...
```

- [ ] **Step 2: npm 취약점 스캔 Step 추가**

`admin-console` job의 `npm ci` 다음에 추가한다:

```yaml
      - name: npm audit
        run: npm audit --audit-level=high
```

- [ ] **Step 3: 이미지 스캔 job 추가**

`compose-smoke` 뒤에 새 job으로 넣는다. 이미지를 빌드해 놓고 스캔한다.

```yaml
  image-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: build images
        run: docker compose -f infra/compose.yaml --env-file .env.example build
      # 인증서·Key·Token을 다루는 서비스라 실행 이미지의 알려진 취약점을 CI에서
      # 막는다. HIGH·CRITICAL만 실패시켜 임계 경로를 흔들지 않는다.
      - name: trivy (gateway)
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: certgate-gateway:latest
          severity: HIGH,CRITICAL
          exit-code: "1"
          ignore-unfixed: true
      - name: trivy (management-api)
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: certgate-management-api:latest
          severity: HIGH,CRITICAL
          exit-code: "1"
          ignore-unfixed: true
      - name: trivy (admin-console)
        uses: aquasecurity/trivy-action@0.28.0
        with:
          image-ref: certgate-admin-console:latest
          severity: HIGH,CRITICAL
          exit-code: "1"
          ignore-unfixed: true
```

`image-ref` 값은 실제 빌드된 이미지 이름과 맞춰야 한다. 먼저 `docker compose -f infra/compose.yaml --env-file .env.example config | grep image` 또는 `docker images`로 Compose가 붙이는 이름(`<project>-<service>`)을 확인하고 그 값을 쓴다. `compose.yaml`에 `image:` 키가 없으면 이름이 디렉터리 기준으로 정해지므로, 필요하면 각 서비스에 `image: certgate-<service>:latest`를 명시해 고정한다.

- [ ] **Step 4: 로컬 사전 확인**

Run: `cd gateway && go install golang.org/x/vuln/cmd/govulncheck@latest && "$(go env GOPATH)/bin/govulncheck" ./...`
Expected: `No vulnerabilities found.` 또는 발견된 취약점 목록. **취약점이 나오면 CI에 넣기 전에 의존성을 올려 해결한다.** 빨간 CI를 main에 넣지 않는다.

Run: `cd admin-console && npm audit --audit-level=high`
Expected: 취약점 없음.

- [ ] **Step 5: 문서 갱신**

`docs/development-guide.md` "필수 검증"에 항목을 더한다:

```markdown
- 의존성 취약점: Go <code>govulncheck</code>, Node <code>npm audit --audit-level=high</code>
- 실행 Image 취약점: Trivy HIGH·CRITICAL
```

- [ ] **Step 6: Commit**

```bash
git checkout infra && git merge --ff-only main
git add .github/workflows/ci.yml docs/development-guide.md
git commit -m "ci: 의존성·Image 취약점 스캔 추가 (govulncheck, npm audit, Trivy)"
```

---

### Task 18: Console 디자인 톤 확정

스크린샷은 이 포트폴리오에서 가장 많이 보이는 산출물인데 현재는 `createTheme()` 기본값이라 "튜토리얼 화면"으로 읽힌다. 새 의존성 없이 `theme.ts` 하나로 인상을 바꾼다.

**Task 3(HTTP Client) 다음, Task 4(Mock)보다 먼저** 한다. 이후 화면 Task들이 처음부터 확정된 톤 위에서 만들어져 나중에 되돌릴 일이 없다.

**Files:**
- Create: `admin-console/src/app/theme.ts`
- Modify: `admin-console/src/App.tsx`
- Modify: `admin-console/src/shared/ui/AppLayout.tsx`

**Interfaces:**
- Produces: `theme` (MUI `Theme`). `App.tsx`가 `createTheme()` 대신 이것을 쓴다.

- [ ] **Step 1: `frontend-design` skill 로드**

구현 전에 `frontend-design` skill을 호출해 미적 방향(팔레트·타이포·밀도)을 잡는다. 기본값처럼 보이지 않는 선택을 하는 것이 목적이다.

- [ ] **Step 2: `theme.ts` 작성**

지켜야 할 제약:
- **보안 운영 도구**답게 절제한다. 채도 높은 색은 상태 표시(success·warning·error)에만 쓰고 화면 전체에는 쓰지 않는다.
- `StatusChip`이 쓰는 `success`·`warning`·`error`·`info` 4색이 **서로 명확히 구분되고 명암 대비를 만족**해야 한다. 인증서 상태(유효/만료 임박/만료/폐기)를 색만으로도 구분할 수 있어야 한다.
- 표 중심 화면이라 밀도를 높인다(`MuiTable` size small 기본, 셀 padding 축소).
- 숫자·Serial Number·Trace ID·Reason Code는 등폭 글꼴로 읽히게 한다. Serial과 지문을 눈으로 비교하는 화면이라 실제로 도움이 된다.
- 다크 모드는 만들지 않는다. 제출까지 4일이고 화면 캡처는 한 가지 테마로 한다.
- Google Fonts 등 외부 폰트를 새로 끌어오지 않는다. 시스템 폰트 스택으로 처리한다.

- [ ] **Step 3: `App.tsx`·`AppLayout.tsx` 적용**

`App.tsx`의 `const theme = createTheme();`를 `import { theme } from "./app/theme";`로 교체한다. `AppLayout`의 AppBar·Drawer가 새 팔레트와 맞는지 확인하고 필요한 만큼만 조정한다.

- [ ] **Step 4: 검증**

Run: `cd admin-console && npm run typecheck && npm test && npm run build`
Expected: 전부 통과. `routes.test.tsx`가 `heading` 이름으로 화면을 찾으므로 제목 문자열을 바꾸지 않는다.

- [ ] **Step 5: Commit**

```bash
git add admin-console/src/app/theme.ts admin-console/src/App.tsx admin-console/src/shared/ui/AppLayout.tsx
git commit -m "feat(console): 관리 콘솔 디자인 톤 확정 (표 밀도·상태 색·등폭 식별자)"
```

---

### Task 3 추가 Step: `repository-structure.md`의 "생성된 Type" 편차 해소

`docs/repository-structure.md`는 `shared/api`를 "HTTP Client와 **생성된** Type"으로 정의하지만 Task 3은 `types.ts`를 손으로 쓴다. 문서와 다르게 구현할 때는 문서를 함께 갱신한다(CLAUDE.md "Source of Truth").

OpenAPI codegen(`springdoc-openapi` + `openapi-typescript`)을 도입하지 않기로 한 이유: 제출까지 4일이고 생성 단계·CI 배선 비용이 얻는 안전성보다 크다. 계약 불일치는 Task 4의 Mock Fixture에 붙인 `satisfies`가 `npm run typecheck`에서 잡는다 — 서버 응답 모양이 바뀌면 Fixture가 타입 검사를 통과하지 못한다.

- [ ] **Step: 문서 수정과 근거 기록**

`docs/repository-structure.md`의 해당 줄을 아래로 바꾼다:

```markdown
- <code>shared/api</code>: HTTP Client와 API 계약 Type
```

같은 절 끝에 근거를 한 문장 남긴다:

```markdown
API 계약 Type은 OpenAPI Codegen이 아니라 <code>api-spec.md</code>를 보고 직접 정의한다. Mock Fixture에 <code>satisfies</code>를 걸어 계약이 어긋나면 Type 검사가 실패하게 하는 방식으로 동일한 안전성을 얻는다(Issue #7 구현 중 결정).
```

Task 3의 Commit에 이 문서 변경을 함께 포함한다 — 코드 결정과 그 근거가 같은 Commit에 남는다.

---

## 다른 기기에서 이어서 작업하기 (2026-08-19 기준)

이 계획은 Windows PC에서 착수했고 이후 macOS에서 이어간다. 저장소에 없는 것(gitignore 대상)이 있어서 새 기기에서는 아래 준비가 필요하다.

### 1. 진행 상황 — 어디까지 됐나

| 항목 | 상태 |
|---|---|
| Task 1 same-origin `/api` proxy | **merge 완료** (PR #33) |
| Issue #34 Compose가 Gateway를 띄우게 함 | **merge 완료** (PR #35) |
| PKI clamp 판단 이식성 | **PR #37 열림** — 리뷰·merge 대기 |
| Task 2 `GET /roles` + Task 16 JSON 구조화 로그 | **PR #38 열림** — 리뷰·merge 대기 |
| Task 12 `GET /dashboard/summary` | **다음 착수 지점** |
| Task 3 이후 Console 전체 | 미착수 |

부수적으로 등록된 Issue: **#36** (Gateway `/healthz`가 Management API readiness를 반영하지 않음). Issue #4·#7 Task 13과 얽혀 있고 이 계획 범위 밖이다.

**다음 작업은 Task 12다.** PR #37·#38을 먼저 merge하고 시작한다.

### 2. 저장소에 없는 것 — 새 기기에서 만들어야 한다

**PKI 자료** (`pki/runtime/`, gitignore 대상). Compose를 띄우기 전에 반드시 필요하다. 없으면 Docker가 bind mount 원본 자리에 **디렉터리를 만들어** 컨테이너가 깨진다.

~~~bash
./pki/scripts/init-ca.sh
./pki/scripts/issue-gateway-cert.sh
~~~

**`.env`** (gitignore 대상). Compose 실행에는 `--env-file .env.example`을 그대로 쓸 수 있어서 필수는 아니다. 만들 경우 `VITE_API_BASE_URL`·`VITE_SSE_URL`을 상대 경로(`/api/v1`, `/api/v1/security-events/stream`)로 둬야 한다. 절대 URL이면 cross-origin이 되고 Management API에는 CORS 설정이 없어 모든 요청이 차단된다.

**`admin-console/node_modules`**. `cd admin-console && npm ci`.

**`.claude/settings.local.json`** (gitignore 대상). Windows 전용 절대 경로(`JAVA_HOME`, MinGW `CC`)가 들어 있던 파일이라 **macOS로 가져오면 안 된다.** macOS에서는 Homebrew JDK 21과 Xcode CLT가 PATH에 있으면 별도 설정이 필요 없다.

### 3. macOS에서 다르게 동작하는 것들

| | 내용 |
|---|---|
| **Key 권한 검사** | `pki/scripts/test_*.sh`는 Windows에서 SKIP했지만 **macOS에서는 실제로 검사한다**(Darwin 분기). `chmod 600`이 정상 반영되므로 통과해야 한다. |
| **`date` 호출** | `issue-gateway-cert.sh`의 정상 경로는 `openssl -checkend`만 쓰므로 `date`를 타지 않는다(PR #37). clamp 경로(만료 임박 CA)의 BSD `date -j -f`는 **macOS 미검증**이다. |
| **줄바꿈** | Windows 작업 트리는 CRLF였고 Git이 LF로 정규화해 커밋한다. macOS 체크아웃은 LF라 Shell Script가 그대로 실행된다. Windows에서는 컨테이너에 올릴 때 `set: pipefail: invalid option name`이 났는데 macOS에서는 그 문제가 없다. |
| **`curl`** | Windows curl은 schannel을 써서 revocation 검사에서 먼저 실패해 mTLS 거부를 확인할 수 없었다. macOS curl은 대개 OpenSSL/LibreSSL이라 `tlsv13 alert certificate required`를 직접 볼 수 있다. |
| **Docker mount 경로** | `compose.yaml`의 bind mount는 compose 파일 기준 상대 경로(`../pki/runtime/...`)라 OS와 무관하다. |

### 4. 새 기기 첫 실행 점검

~~~bash
# 1) 도구 확인
docker --version && java -version && node --version && go version

# 2) 최신 main 동기화
git checkout main && git pull

# 3) PKI 생성
./pki/scripts/init-ca.sh && ./pki/scripts/issue-gateway-cert.sh
./pki/scripts/test_init_ca.sh && ./pki/scripts/test_issue_gateway_cert.sh   # 둘 다 PASS 여야 한다

# 4) 스택 기동 — 5개 서비스가 모두 healthy 여야 한다 (gateway 포함)
docker compose -f infra/compose.yaml --env-file .env.example up -d --build
docker compose -f infra/compose.yaml --env-file .env.example ps

# 5) proxy 경로 확인
curl -s http://127.0.0.1:5173/api/v1/devices        # PageResponse JSON
curl -s http://127.0.0.1:5173/api/v1/roles          # SENSOR·OPERATOR (PR #38 merge 후)

# 6) Console·Java 테스트
cd admin-console && npm ci && npm run typecheck && npm test && cd ..
cd management-api && ./gradlew test && cd ..

# 7) 정리
docker compose -f infra/compose.yaml --env-file .env.example down -v
~~~

4번에서 `gateway`가 목록에 없으면 3번의 PKI 생성이 빠졌거나 실패한 것이다. `docker compose logs gateway`로 확인한다.
