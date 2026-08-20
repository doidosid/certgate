import Alert from "@mui/material/Alert";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ConfirmDialog from "../../shared/ui/ConfirmDialog";

/** CertificateService의 검증과 같은 값이다(V5__create_certificate.sql의 열 길이). */
export const MAX_REASON_LENGTH = 64;
export const MAX_NOTE_LENGTH = 500;

interface Props {
	open: boolean;
	serialNumber: string;
	/** 재조회 결과 이미 폐기된 것으로 확인된 경우. 다시 보낼 수 없다. */
	alreadyRevoked: boolean;
	reason: string;
	note: string;
	isPending: boolean;
	error: unknown;
	onReasonChange: (value: string) => void;
	onNoteChange: (value: string) => void;
	onConfirm: () => void;
	onClose: () => void;
}

/**
 * 폐기는 이 콘솔에서 가장 위험한 동작이다. 되돌릴 수 없고, Device는 새 CSR을 제출해
 * 다시 발급받아야 한다(ui-design.md §6 "재발급은 기존 인증서를 복사하지 않고 새 CSR
 * 요청으로 처리한다").
 *
 * 안내 문구에 "즉시 차단"이라고 쓰지 않는다 — 폐기 Transaction Commit 후 Gateway Cache
 * 무효화를 호출하고, 그 호출이 실패해도 폐기는 Rollback하지 않는다. 최종 수렴은 30초
 * TTL이 보장한다(api-spec.md §5, architecture.md). 화면이 실제보다 강하게 약속하면
 * 관리자가 차단됐다고 믿는 30초의 공백이 생긴다.
 */
export default function RevokeDialog({
	open,
	serialNumber,
	alreadyRevoked,
	reason,
	note,
	isPending,
	error,
	onReasonChange,
	onNoteChange,
	onConfirm,
	onClose,
}: Props) {
	const reasonTooLong = reason.length > MAX_REASON_LENGTH;
	const noteTooLong = note.length > MAX_NOTE_LENGTH;

	return (
		<ConfirmDialog
			open={open}
			title={`인증서 폐기 (${serialNumber})`}
			description="폐기하면 Gateway가 이 인증서의 접근을 차단합니다. 반영에 최대 30초가 걸리며, 되돌릴 수 없습니다. 재발급은 새 CSR 요청으로 처리합니다."
			confirmLabel="폐기하기"
			confirmColor="error"
			isPending={isPending}
			error={error}
			onConfirm={onConfirm}
			onClose={onClose}
			confirmDisabled={alreadyRevoked || reason.trim() === "" || reasonTooLong || noteTooLong}
		>
			<Stack spacing={2}>
				{/*
				 * 409 뒤 재조회가 REVOKED를 확인했으면 같은 요청을 다시 보낼 수 없다. 오류만
				 * 띄우고 확인 버튼을 열어 두면 성공할 수 없는 POST를 반복하게 된다
				 * (Codex 리뷰 PR #47 Medium).
				 */}
				{alreadyRevoked && (
					<Alert severity="info">
						이 인증서는 이미 폐기되어 있습니다. 창을 닫고 상태를 확인하세요.
					</Alert>
				)}
				{/* 사유는 감사 기록으로 남는다. 서버도 필수로 검증한다(REVOCATION_REASON_REQUIRED). */}
				<TextField
					label={`폐기 사유 (필수, ${MAX_REASON_LENGTH}자 이내)`}
					fullWidth
					required
					disabled={alreadyRevoked}
					value={reason}
					error={reasonTooLong}
					helperText={`${reason.length}/${MAX_REASON_LENGTH}`}
					onChange={(event) => onReasonChange(event.target.value)}
				/>
				<TextField
					label={`메모 (선택, ${MAX_NOTE_LENGTH}자 이내)`}
					fullWidth
					multiline
					minRows={2}
					disabled={alreadyRevoked}
					value={note}
					error={noteTooLong}
					helperText={`${note.length}/${MAX_NOTE_LENGTH}`}
					onChange={(event) => onNoteChange(event.target.value)}
				/>
			</Stack>
		</ConfirmDialog>
	);
}
