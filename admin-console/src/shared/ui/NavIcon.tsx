interface Props {
	name: NavIconName;
}

export type NavIconName = "dashboard" | "device" | "request" | "certificate" | "event";

/**
 * 사이드바 메뉴 아이콘. 손으로 그린 20px SVG다 — 아이콘 하나 때문에 `@mui/icons-material`
 * 전체를 의존성에 추가하지 않는다(Task 18 "새 의존성 없음").
 *
 * `aria-hidden`이다. 메뉴의 접근 가능한 이름은 옆의 글자가 담당하고, 아이콘은 같은 뜻을
 * 두 번 읽게 만들 뿐이다.
 */
const PATHS: Record<NavIconName, string> = {
	// 사분면 — 한눈에 보는 요약
	dashboard: "M3 3h7v7H3V3zm11 0h7v4h-7V3zM3 14h7v7H3v-7zm11 3h7v4h-7v-4zm0-6h7v4h-7v-4z",
	// 단말
	device: "M7 2h10a2 2 0 012 2v16a2 2 0 01-2 2H7a2 2 0 01-2-2V4a2 2 0 012-2zm0 2v13h10V4H7zm4 15h2v1h-2v-1z",
	// 서명을 기다리는 문서
	request: "M6 2h8l4 4v16H6V2zm7 1.5V7h3.5L13 3.5zM8 11h8v2H8v-2zm0 4h8v2H8v-2z",
	// 인증서 — 봉인이 붙은 문서
	certificate: "M5 3h14v11H5V3zm2 2v7h10V5H7zm5 10l3 2-1 4-2-1.5L10 21l-1-4 3-2z",
	// 판정 기록 — 심박 그래프
	event: "M3 12h4l2-5 3 10 2-5h7v2h-5.8l-2.7 6.5L9.6 10 8.3 14H3v-2z",
};

export default function NavIcon({ name }: Props) {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
			<path d={PATHS[name]} />
		</svg>
	);
}
