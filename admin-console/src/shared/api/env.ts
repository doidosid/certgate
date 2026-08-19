/**
 * Vite는 빌드 시점에 import.meta.env를 치환한다. 값이 없으면 undefined가 그대로
 * 남아 API 경로가 "undefined/devices"처럼 만들어지고, 요청은 404·CORS 오류로만
 * 보여 원인을 찾기 어렵다. 실제로 이 저장소에서 stale한 .env 때문에 Console이
 * 잘못된 URL로 빌드될 뻔한 적이 있어(계획 문서 인수인계 절), 여기서 먼저 끊는다.
 */
function required(name: string, value: string | undefined): string {
	if (!value) {
		throw new Error(`${name}이(가) 설정되지 않았습니다. .env.example을 참고해 상대 경로로 지정하세요.`);
	}
	return value;
}

export const apiBaseUrl = required("VITE_API_BASE_URL", import.meta.env.VITE_API_BASE_URL);
export const securityEventStreamUrl = required("VITE_SSE_URL", import.meta.env.VITE_SSE_URL);
