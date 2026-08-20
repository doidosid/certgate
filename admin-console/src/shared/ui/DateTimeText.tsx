import Mono from "./Mono";

interface Props {
	value: string | null | undefined;
}

/** 2자리로 채운다 — 표에서 자리가 어긋나면 시각을 눈으로 비교할 수 없다. */
function pad(value: number): string {
	return String(value).padStart(2, "0");
}

/**
 * 서버는 UTC ISO 8601로 주고 화면에는 로컬 시간으로 보여준다.
 *
 * `toLocaleString("ko-KR")`의 "2026. 8. 13. 오후 2:50:00" 대신 `YYYY-MM-DD HH:mm:ss`로
 * 쓴다. 보안 감사 화면에서 시각은 Gateway·Management API 로그와 맞춰 보는 값이고, 그
 * 로그는 24시간제 고정폭 형식이다. 월·일 자리 수가 달라지지 않아 표에서 세로로
 * 정렬되고, 오전·오후 표기 때문에 등폭 글꼴을 쓸 수 없는 문제도 없어진다.
 */
export default function DateTimeText({ value }: Props) {
	if (!value) {
		return <>—</>;
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return <>—</>;
	}
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	return <Mono tabular>{`${day} ${time}`}</Mono>;
}
