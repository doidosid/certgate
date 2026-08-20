import { createTheme } from "@mui/material/styles";

/**
 * CertGate 관리 콘솔의 디자인 톤 (Issue #7 Task 18).
 *
 * 이 화면들이 하는 일은 "이 Device를 신뢰할 수 있는가"를 판정한 기록을 읽는 것이다.
 * 그래서 대시보드가 아니라 발급 대장처럼 보이게 한다 — 표가 주인공이고, 판정은
 * 도장처럼 단단하고, 장식은 없다. 어두운 관제실에서 계기판을 읽는 상황을 기준으로
 * 삼는다: 바닥은 조용하고, 값과 판정만 빛난다.
 *
 * 제약(계획 문서 Task 18):
 * - 외부 폰트를 새로 끌어오지 않는다. 시스템 폰트 스택만 쓴다.
 * - 채도 높은 색은 상태 표시에만 쓴다.
 * - 단일 테마다. 전환 토글은 만들지 않는다(별도 상태 관리를 두지 않는다는 Issue #7
 *   완료 기준과 같은 이유).
 */

/*
 * 어둠에도 층이 있어야 면이 구분된다. 그림자를 쓰지 않으므로 명도 차이와 hairline이
 * 그 일을 한다. 순수 검정을 쓰지 않는 이유는 두 가지다 — 텍스트 후광(halation)이
 * 심해지고, 흔한 "터미널 화면"처럼 읽힌다.
 */
const CHROME = "#0A0E15"; // AppBar. 밝은 테마에서 잉크가 맡던 "권위" 자리를 그대로 잇는다
const GROUND = "#10141C"; // 페이지 바닥, 좌측 메뉴
const PANEL = "#171D28"; // 카드, 표 본문, 활성 메뉴
const RAISED = "#1D2531"; // 표 머리, 입력 필드
const HAIRLINE = "#2A3342"; // 모든 경계선
const RULE = "#3D485C"; // 표 머리를 못 박는 굵은 선
const TEXT = "#E4E9F2"; // 순백이 아니다 — 어두운 바닥에서 순백은 번진다
const MUTED = "#98A3B7"; // 보조 텍스트, 열 이름
const VERDIGRIS = "#3FB3A6"; // 단 하나의 브랜드 색: 링크, 활성 상태, focus

/*
 * 상태 4색은 서로 다른 색상 계열에 두고, 어두운 글자와의 명암비를 모두 5:1 이상으로
 * 맞춘다. 인증서 상태(유효·만료 임박·만료·폐기)를 색만으로 구분해야 한다.
 *
 * 어두운 바닥에서는 밝은 칩에 어두운 글자를 얹는 쪽이 읽기 쉽고, 도장처럼 찍힌
 * 느낌도 살아난다. INFO를 채도 낮은 청회색으로 둔 것은 의도다 — 가장 급하지 않은
 * 심각도가 가장 조용해야 하고, 브랜드 색과도 혼동되지 않는다.
 */
const SUCCESS = "#35C07C";
const WARNING = "#DDA02B";
const ERROR = "#F0685C";
const INFO = "#8CA6C9";
const ON_STATUS = "#0E1219";

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
		mode: "dark",
		primary: { main: VERDIGRIS, dark: "#2A8F85", light: "#6FCBC0", contrastText: ON_STATUS },
		secondary: { main: TEXT, contrastText: ON_STATUS },
		success: { main: SUCCESS, contrastText: ON_STATUS },
		warning: { main: WARNING, contrastText: ON_STATUS },
		error: { main: ERROR, contrastText: ON_STATUS },
		info: { main: INFO, contrastText: ON_STATUS },
		background: { default: GROUND, paper: PANEL },
		text: { primary: TEXT, secondary: MUTED },
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
				/*
				 * 브라우저가 그리는 UI(datetime-local 달력, select 목록, 스크롤바)까지
				 * 어둡게 만든다. 이걸 빼면 기간 필터의 달력만 흰 창으로 튀어나온다.
				 */
				html: { colorScheme: "dark" },
				body: { backgroundColor: GROUND, color: TEXT },
				// 움직임을 줄이도록 설정한 사용자에게는 전환을 사실상 끈다.
				"@media (prefers-reduced-motion: reduce)": {
					"*": { animationDuration: "0.01ms !important", transitionDuration: "0.01ms !important" },
				},
			},
		},

		// 그림자 대신 hairline과 명도 한 단계로 면을 구분한다.
		MuiPaper: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: { backgroundImage: "none", border: `1px solid ${HAIRLINE}` },
			},
		},

		MuiAppBar: {
			defaultProps: { elevation: 0 },
			styleOverrides: {
				root: { backgroundColor: CHROME, border: 0, borderBottom: `1px solid ${HAIRLINE}` },
			},
		},

		MuiToolbar: {
			styleOverrides: { root: { minHeight: 56, "@media (min-width:600px)": { minHeight: 56 } } },
		},

		MuiDrawer: {
			styleOverrides: {
				paper: { backgroundColor: GROUND, border: 0, borderRight: `1px solid ${HAIRLINE}` },
			},
		},

		// 표가 주인공이므로 기본을 밀도 높은 쪽에 둔다.
		MuiTable: { defaultProps: { size: "small" } },

		MuiTableCell: {
			styleOverrides: {
				root: { padding: "6px 12px", borderBottom: `1px solid ${HAIRLINE}` },
				/*
				 * 열 이름은 대장의 항목명처럼 읽히게 한다. 한글이라 등폭은 쓰지 않고,
				 * 작은 크기·굵은 두께·넓은 자간과 굵은 밑줄로 표의 머리를 못 박는다.
				 */
				head: {
					padding: "9px 12px",
					backgroundColor: RAISED,
					color: MUTED,
					fontSize: "0.6875rem",
					fontWeight: 700,
					letterSpacing: "0.045em",
					lineHeight: 1.4,
					whiteSpace: "nowrap",
					borderBottom: `2px solid ${RULE}`,
				},
			},
		},

		MuiTableRow: {
			styleOverrides: {
				root: {
					"&:last-of-type td": { borderBottom: 0 },
					// 브랜드 색을 아주 얇게 얹어 짚고 있는 행을 표시한다.
					"&.MuiTableRow-hover:hover": { backgroundColor: "rgba(63, 179, 166, 0.07)" },
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
				// "발급 없음"·"만료"처럼 사건이 아닌 상태는 조용해야 한다.
				outlined: { borderColor: HAIRLINE, color: MUTED, backgroundColor: PANEL },
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
				root: { backgroundColor: RAISED },
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
