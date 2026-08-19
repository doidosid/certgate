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
