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
 *
 * ApiError가 아닌 오류는 내부 메시지를 화면에 노출하지 않는다 — 그건 사용자에게
 * 보여줄 문장이 아니라 개발자용 진단 문자열이다.
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
