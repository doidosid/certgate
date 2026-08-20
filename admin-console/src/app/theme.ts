import { createTheme } from "@mui/material/styles";

/**
 * CertGate 관리 콘솔의 디자인 톤 (Issue #7 Task 18).
 *
 * 사용자가 준 레퍼런스(FINEbank.IO 계열 대시보드)를 기준으로 잡았다: 어두운 사이드바 +
 * 밝은 콘텐츠, teal 강조, 흰 카드에 옅은 그림자, 회색 섹션 헤딩. 그 위에 이 도메인에
 * 맞는 판단을 얹었다 — 표가 주인공이고, 판정은 도장처럼 단단하고, 장식은 없다.
 *
 * 제약(계획 문서 Task 18):
 * - 외부 폰트를 새로 끌어오지 않는다. 시스템 폰트 스택만 쓴다.
 * - 채도 높은 색은 상태 표시에만 쓴다.
 * - 단일 테마다. 전환 토글은 만들지 않는다.
 */

const INK = "#1D2129"; // 본문·제목
const MUTED = "#79818D"; // 보조 텍스트, 열 이름, 섹션 헤딩
const CANVAS = "#F7F8FA"; // 콘텐츠 바닥
const SURFACE = "#FFFFFF"; // 카드, 표, 상단 헤더
const HAIRLINE = "#E8EBF0"; // 경계선

/*
 * 레퍼런스의 teal은 #2E9E8F인데 흰 배경 대비가 3.0:1로 본문 기준(4.5:1)에 못 미친다.
 * 그래서 글자·채움에는 한 단계 어두운 값을 쓰고, 밝은 쪽은 차트 라인이나 hover 틴트처럼
 * 의미를 혼자 전달하지 않는 자리에만 쓴다.
 */
const TEAL = "#15756A"; // 링크, 활성 메뉴 채움, 주요 버튼 (흰 글자 대비 5.55:1)
const TEAL_BRIGHT = "#2E9E8F"; // 장식 전용
const TEAL_TINT = "rgba(46, 158, 143, 0.08)"; // 행 hover

/** 사이드바는 밝은 테마 팔레트를 쓰지 않는다. AppLayout이 이 값들을 직접 쓴다. */
export const sidebar = {
	background: "#1E2024",
	border: "#2A2D33",
	text: "#A8B0BA", // #1E2024 대비 7.6:1
	textActive: "#FFFFFF",
	brand: "#FFFFFF",
	activeFill: TEAL,
	mark: TEAL_BRIGHT,
};

/*
 * 상태 4색은 서로 다른 색상 계열에 두고, 흰 글자와의 명암비를 모두 4.5:1 이상으로 맞춘다.
 *
 * 상태의 의미를 색이 단독으로 전달하지는 않는다 — StatusChip은 항상 한국어 라벨을 함께
 * 표시하고, 색은 훑어볼 때의 보조 단서다. 색상으로는 뚜렷이 다르지만 명도는 서로 가까워
 * 색상을 인지하지 못하면 구분되지 않는다(Codex 리뷰 PR #46 Medium). 색 없이도 읽히는
 * 것은 라벨이고, EXPIRED처럼 사건이 아닌 상태는 outlined 형태로 한 번 더 구분한다.
 *
 * INFO를 채도 낮은 강철색으로 둔 것은 의도다 — 가장 급하지 않은 심각도가 가장 조용해야
 * 하고, 강조색(teal)과도 혼동되지 않는다.
 */
const SUCCESS = "#1E7F3C";
const WARNING = "#A25700";
const ERROR = "#B3261E";
const INFO = "#4A5B7A";

/** 한글 자폭이 깨지지 않도록 Windows·macOS 한글 face를 스택에 함께 둔다. */
const SANS = [
	"system-ui",
	"-apple-system",
	'"Segoe UI"',
	"Roboto",
	'"Malgun Gothic"',
	'"Apple SD Gothic Neo"',
	'"Helvetica Neue"',
	"Arial",
	"sans-serif",
].join(",");

/**
 * ASCII 식별자 전용이다. 화면 문구에는 쓰지 않는다 — 등폭 face에 한글 글리프가 없어
 * 한글 face로 떨어지면서 등폭이 아니게 되고 자폭만 어긋난다.
 */
export const MONO = [
	"ui-monospace",
	"SFMono-Regular",
	'"SF Mono"',
	"Menlo",
	"Consolas",
	'"Liberation Mono"',
	"monospace",
].join(",");

export const theme = createTheme({
	palette: {
		mode: "light",
		primary: { main: TEAL, dark: "#0F5B53", light: TEAL_BRIGHT, contrastText: "#FFFFFF" },
		secondary: { main: INK, contrastText: "#FFFFFF" },
		success: { main: SUCCESS, contrastText: "#FFFFFF" },
		warning: { main: WARNING, contrastText: "#FFFFFF" },
		error: { main: ERROR, contrastText: "#FFFFFF" },
		info: { main: INFO, contrastText: "#FFFFFF" },
		background: { default: CANVAS, paper: SURFACE },
		text: { primary: INK, secondary: MUTED },
		divider: HAIRLINE,
	},

	// 레퍼런스의 카드 모서리에 맞춘다.
	shape: { borderRadius: 8 },

	typography: {
		fontFamily: SANS,
		fontSize: 14,
		h4: { fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.2 },
		// 카드·Drawer 제목. 데이터가 주인공이라 제목은 작고 단단하게 둔다.
		h6: { fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.005em" },
		// 카드 묶음 위의 섹션 헤딩 — 레퍼런스의 "Goals", "Total Balance" 자리.
		subtitle1: { fontSize: "1rem", fontWeight: 600, color: MUTED },
		body2: { fontSize: "0.8125rem", lineHeight: 1.55 },
		caption: { fontFamily: MONO, fontSize: "0.75rem", letterSpacing: 0 },
		button: { textTransform: "none", fontWeight: 600 },
	},

	components: {
		MuiCssBaseline: {
			styleOverrides: {
				/*
				 * 브라우저가 직접 그리는 UI(datetime-local 달력, 체크박스, 스크롤바)는 CSS로
				 * 색을 지정할 수 없고 기본 파란색으로 나온다. 기간 필터의 달력이 화면에서
				 * 유일하게 파란 요소가 되는데, accent-color 하나로 강조색에 맞출 수 있다.
				 */
				"html, body": { accentColor: TEAL },
				body: { backgroundColor: CANVAS, color: INK },
				// 움직임을 줄이도록 설정한 사용자에게는 전환을 사실상 끈다.
				"@media (prefers-reduced-motion: reduce)": {
					"*": { animationDuration: "0.01ms !important", transitionDuration: "0.01ms !important" },
				},
			},
		},

		/*
		 * 레퍼런스의 카드 — 흰 면, 옅은 테두리, 아주 약한 그림자 하나. 그림자를 깊게 주지
		 * 않는다. 운영 도구에서 떠 있는 느낌은 정보를 읽는 데 도움이 되지 않는다.
		 */
		MuiPaper: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: {
					backgroundImage: "none",
					border: `1px solid ${HAIRLINE}`,
					boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
				},
			},
		},

		MuiDrawer: {
			styleOverrides: { paper: { backgroundColor: SURFACE, border: 0, boxShadow: "none" } },
		},

		// 표가 주인공이므로 기본을 밀도 높은 쪽에 둔다.
		MuiTable: { defaultProps: { size: "small" } },

		MuiTableCell: {
			styleOverrides: {
				root: { padding: "10px 16px", borderBottom: `1px solid ${HAIRLINE}` },
				/*
				 * 열 이름은 대장의 항목명처럼 읽히게 한다. 한글이라 등폭은 쓰지 않고,
				 * 작은 크기·굵은 두께·넓은 자간으로 표의 머리를 눌러 준다.
				 */
				head: {
					padding: "11px 16px",
					backgroundColor: CANVAS,
					color: MUTED,
					fontSize: "0.6875rem",
					fontWeight: 700,
					letterSpacing: "0.045em",
					lineHeight: 1.4,
					whiteSpace: "nowrap",
					borderBottom: `1px solid ${HAIRLINE}`,
				},
			},
		},

		MuiTableRow: {
			styleOverrides: {
				root: {
					"&:last-of-type td": { borderBottom: 0 },
					"&.MuiTableRow-hover:hover": { backgroundColor: TEAL_TINT },
				},
			},
		},

		MuiTablePagination: {
			styleOverrides: {
				root: { borderTop: `1px solid ${HAIRLINE}` },
				// 쪽수·건수는 숫자라 등폭이 실제로 읽기 쉽다.
				displayedRows: { fontFamily: MONO, fontSize: "0.75rem", color: MUTED },
				selectLabel: { fontSize: "0.75rem", color: MUTED },
				select: { fontFamily: MONO, fontSize: "0.75rem" },
			},
		},

		/*
		 * 시그니처 — 판정은 도장이다. mTLS 판정에 "아마도"는 없으므로 알약 모양을 쓰지
		 * 않는다. 카드 모서리가 둥근 화면에서 각진 칩이 오히려 눈에 걸려 판정을 찾게 한다.
		 */
		MuiChip: {
			styleOverrides: {
				root: {
					borderRadius: 3,
					height: 22,
					fontSize: "0.75rem",
					fontWeight: 700,
					letterSpacing: "0.01em",
				},
				label: { paddingLeft: 8, paddingRight: 8 },
				outlined: { borderColor: HAIRLINE, color: MUTED, backgroundColor: SURFACE },
			},
		},

		MuiLink: {
			defaultProps: { underline: "hover" },
			styleOverrides: { root: { color: TEAL, fontWeight: 500 } },
		},

		// 레퍼런스의 "Adjust ✎"처럼 옅은 테두리 + 강조색 글자.
		MuiButton: {
			defaultProps: { disableElevation: true },
			styleOverrides: { root: { borderRadius: 6 } },
		},

		MuiButtonBase: {
			styleOverrides: {
				root: { "&.Mui-focusVisible": { outline: `2px solid ${TEAL}`, outlineOffset: 2 } },
			},
		},

		MuiOutlinedInput: {
			styleOverrides: {
				notchedOutline: { borderColor: HAIRLINE },
				root: { backgroundColor: SURFACE, borderRadius: 6 },
			},
		},

		MuiInputLabel: { styleOverrides: { root: { fontSize: "0.8125rem" } } },

		MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2, fontSize: "0.6875rem" } } },

		MuiListItemText: { styleOverrides: { primary: { fontSize: "0.875rem", fontWeight: 500 } } },
	},
});
