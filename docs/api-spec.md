# Management API 초안

기본 경로: `/api/v1`

## Device API

| Method | Path | 설명 |
|---|---|---|
| POST | `/devices` | Device 등록 |
| GET | `/devices` | Device 목록과 필터 조회 |
| GET | `/devices/{deviceId}` | Device 상세 조회 |
| PATCH | `/devices/{deviceId}/status` | Device 활성·비활성 변경 |
| PUT | `/devices/{deviceId}/role` | Device Role 지정 |

## 인증서 발급 요청 API

| Method | Path | 설명 |
|---|---|---|
| POST | `/certificate-requests` | 등록된 Device의 CSR 제출 |
| GET | `/certificate-requests` | 대기·완료 요청 조회 |
| POST | `/certificate-requests/{requestId}/approve` | CSR 승인 및 인증서 서명 |
| POST | `/certificate-requests/{requestId}/reject` | CSR 거절 |
| GET | `/certificate-requests/{requestId}/certificate` | 발급 인증서 다운로드 |

## 인증서 API

| Method | Path | 설명 |
|---|---|---|
| GET | `/certificates` | 인증서 목록 조회 |
| GET | `/certificates/{certificateId}` | 인증서 메타데이터 조회 |
| POST | `/certificates/{certificateId}/revoke` | 인증서 폐기 |

## 정책 API

| Method | Path | 설명 |
|---|---|---|
| GET | `/roles` | Role과 규칙 목록 조회 |
| GET | `/roles/{roleName}` | 특정 Role 정책 조회 |
| PUT | `/roles/{roleName}` | Role 정책 수정. 제출 이후 기능 |

## 보안 이벤트 API

| Method | Path | 설명 |
|---|---|---|
| POST | `/internal/security-events` | Gateway의 접근 결과 저장 |
| GET | `/security-events` | 시간·Device·결과·사유·등급별 이벤트 검색 |
| GET | `/security-events/{eventId}` | Security Event 상세 조회 |
| GET | `/security-events/stream` | 접속 중인 콘솔에 Critical Event를 SSE로 전송 |
| GET | `/dashboard/summary` | 관리 콘솔 요약 통계와 최근 Critical Event 조회 |

SSE 알림은 별도 Alert 리소스를 만들지 않고 저장된 Security Event의 ID를 전달한다. 콘솔은 알림 클릭 시 해당 Event 상세 API로 이동한다.

## Gateway 내부 조회 API

| Method | Path | 설명 |
|---|---|---|
| GET | `/internal/access-context?serial={serial}` | 인증서·Device 상태, Role, 규칙 조회 |
| POST | `/internal/security-events/batch` | Gateway Outbox의 Event 묶음 저장. Event ID로 중복 방지 |
| POST | `/internal/cache-invalidations` | 상태 변경 후 Gateway Cache 무효화 알림 |

## 공통 오류 응답

```json
{
  "code": "CERTIFICATE_REVOKED",
  "message": "신뢰할 수 없는 인증서입니다.",
  "traceId": "..."
}
```

관리자용 API와 Gateway 내부 API는 배포 시 네트워크 분리 또는 Service Credential로 보호해야 한다.
