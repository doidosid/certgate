import { createTheme } from "@mui/material/styles";

/**
 * CertGate 관리 콘솔의 디자인 톤 (Issue #7 Task 18).
 *
 * 이 화면들이 하는 일은 "이 Device를 신뢰할 수 있는가"를 판정한 기록을 읽는 것이다.
 * 그래서 대시보드가 아니라 발급 대장처럼 보이게 한다 — 표가 주인공이고, 판정은
 * 도장처럼 단단하고, 장식은 없다.
 *
 * 제약(계획 문서 Task 18):
 * - 외부 폰트를 새로 끌어오지 않는다. 시스템 폰트 스택만 쓴다.
 * - 다크 모드는 만들지 않는다.
 * - 채도 높은 색은 상태 표시에만 쓴다.
 */

const INK = "#161B2E"; // 권위: AppBar, 제목, 본문
const SLATE = "#5A6478"; // 보조 텍스트, 열 이름
const CANVAS = "#F5F6F8"; // 페이지 바닥, 표 머리
const SURFACE = "#FFFFFF"; // 카드, 표 본문
const VERDIGRIS = "#0B6E6E"; // 단 하나의 브랜드 색: 링크, 활성 상태, focus
const HAIRLINE = "#E3E6EB"; // 모든 경계선

/*
 * 상태 4색은 서로 다른 색상 계열에 두고, 흰 글자와의 명암비를 모두 4.5:1 이상으로
 * 맞춘다. 인증서 상태(유효·만료 임박·만료·폐기)를 색만으로 구분해야 한다.
 *
 * INFO를 채도 낮은 강철색으로 둔 것은 의도다 — 가장 급하지 않은 심각도가 가장 조용해야
 * 하고, 동시에 브랜드 색(녹청)과 혼동되지 않는다.
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
 * ASCII 식별자 전용이다. 한글에는 쓰지 않는다 — Consolas·Menlo에 한글이 없어
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
		primary: { main: VERDIGRIS, dark: "#075252", light: "#3B8E8E", contrastText: "#FFFFFF" },
		secondary: { main: INK, contrastText: "#FFFFFF" },
		success: { main: SUCCESS, contrastText: "#FFFFFF" },
		warning: { main: WARNING, contrastText: "#FFFFFF" },
		error: { main: ERROR, contrastText: "#FFFFFF" },
		info: { main: INFO, contrastText: "#FFFFFF" },
		background: { default: CANVAS, paper: SURFACE },
		text: { primary: INK, secondary: SLATE },
		divider: HAIRLINE,
	},

	shape: { borderRadius: 3 },

	typography: {
		fontFamily: SANS,
		fontSize: 14,
		// 페이지 제목. 한글이 섞이므로 tracking을 과하게 조이지 않는다.
		h4: { fontSize: "1.625rem", fontWeight: 700, letterSpacing: "-0.015em", lineHeight: 1.2 },
		// 카드·Drawer 제목. 데이터가 주인공이라 제목은 작고 단단하게 둔다.
		h6: { fontSize: "0.9375rem", fontWeight: 700, letterSpacing: "-0.005em" },
		body2: { fontSize: "0.8125rem", lineHeight: 1.55 },
		// ASCII 보조 정보(코드·traceId 조각)에 쓰는 자리.
		caption: { fontFamily: MONO, fontSize: "0.75rem", letterSpacing: 0 },
		button: { textTransform: "none", fontWeight: 600 },
	},

	components: {
		MuiCssBaseline: {
			styleOverrides: {
				body: { backgroundColor: CANVAS, color: INK },
				// 움직임을 줄이도록 설정한 사용자에게는 전환을 사실상 끈다.
				"@media (prefers-reduced-motion: reduce)": {
					"*": { animationDuration: "0.01ms !important", transitionDuration: "0.01ms !important" },
				},
			},
		},

		// 그림자 대신 hairline 하나로 면을 구분한다. 운영 도구에 깊이감은 필요 없다.
		MuiPaper: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: { backgroundImage: "none", border: `1px solid ${HAIRLINE}` },
			},
		},

		MuiAppBar: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: { backgroundColor: INK, border: 0, borderBottom: `1px solid ${INK}` },
			},
		},

		MuiToolbar: {
			styleOverrides: { root: { minHeight: 56, "@media (min-width:600px)": { minHeight: 56 } } },
		},

		MuiDrawer: {
			styleOverrides: {
				paper: { backgroundColor: CANVAS, border: 0, borderRight: `1px solid ${HAIRLINE}` },
			},
		},

		// 표가 주인공이므로 기본을 밀도 높은 쪽에 둔다.
		MuiTable: { defaultProps: { size: "small" } },

		MuiTableCell: {
			styleOverrides: {
				root: { padding: "6px 12px", borderBottom: `1px solid ${HAIRLINE}` },
				/*
				 * 열 이름은 대장의 항목명처럼 읽히게 한다. 한글이라 등폭은 쓰지 않고,
				 * 작은 크기·굵은 두께·넓은 자간과 잉크색 밑줄로 표의 머리를 못 박는다.
				 */
				head: {
					padding: "9px 12px",
					backgroundColor: CANVAS,
					color: SLATE,
					fontSize: "0.6875rem",
					fontWeight: 700,
					letterSpacing: "0.045em",
					lineHeight: 1.4,
					whiteSpace: "nowrap",
					borderBottom: `2px solid ${INK}`,
				},
			},
		},

		MuiTableRow: {
			styleOverrides: {
				root: {
					"&:last-of-type td": { borderBottom: 0 },
					"&.MuiTableRow-hover:hover": { backgroundColor: "#EFF3F3" },
				},
			},
		},

		MuiTablePagination: {
			styleOverrides: {
				root: { borderTop: `1px solid ${HAIRLINE}` },
				// 쪽수·건수는 숫자라 등폭이 실제로 읽기 쉽다.
				displayedRows: { fontFamily: MONO, fontSize: "0.75rem", color: SLATE },
				selectLabel: { fontSize: "0.75rem", color: SLATE },
				select: { fontFamily: MONO, fontSize: "0.75rem" },
			},
		},

		/*
		 * 시그니처 1 — 판정은 도장이다. mTLS 판정에 "아마도"는 없으므로 알약 모양을
		 * 쓰지 않는다. 각을 세우고 두께를 올려 찍힌 것처럼 보이게 한다.
		 */
		MuiChip: {
			styleOverrides: {
				root: {
					borderRadius: 2,
					height: 22,
					fontSize: "0.75rem",
					fontWeight: 700,
					letterSpacing: "0.01em",
				},
				label: { paddingLeft: 8, paddingRight: 8 },
				outlined: { borderColor: HAIRLINE, color: SLATE, backgroundColor: SURFACE },
			},
		},

		MuiLink: {
			defaultProps: { underline: "hover" },
			styleOverrides: { root: { color: VERDIGRIS, fontWeight: 500 } },
		},

		MuiButtonBase: {
			styleOverrides: {
				root: {
					"&.Mui-focusVisible": { outline: `2px solid ${VERDIGRIS}`, outlineOffset: 2 },
				},
			},
		},

		MuiOutlinedInput: {
			styleOverrides: {
				notchedOutline: { borderColor: HAIRLINE },
				root: { backgroundColor: SURFACE },
			},
		},

		MuiInputLabel: { styleOverrides: { root: { fontSize: "0.8125rem" } } },

		MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2, fontSize: "0.6875rem" } } },

		MuiAlert: { styleOverrides: { root: { borderRadius: 3 } } },

		MuiListItemText: {
			styleOverrides: { primary: { fontSize: "0.875rem", fontWeight: 500 } },
		},
	},
});
