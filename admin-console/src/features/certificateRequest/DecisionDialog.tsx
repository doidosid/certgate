import TextField from "@mui/material/TextField";
import ConfirmDialog from "../../shared/ui/ConfirmDialog";
import type { DecisionAction } from "./api";

interface Props {
	open: boolean;
	action: DecisionAction;
	decisionNote: string;
	isPending: boolean;
	error: unknown;
	onNoteChange: (value: string) => void;
	onConfirm: () => void;
	onClose: () => void;
}

/**
 * 승인·거절은 되돌릴 수 없다 — 승인은 Intermediate CA가 실제로 인증서를 발급하고,
 * 거절은 Device가 CSR을 다시 제출해야 한다. 그래서 한 번 더 확인을 받고, 무엇이
 * 일어나는지 문장으로 말한다.
 *
 * 거절 사유는 필수다(ui-design.md §5 "사유를 포함한 거절"). 서버는 본문 없는 거절도
 * 받지만, 사유 없는 거절은 나중에 이 결정을 설명할 수 없게 만든다.
 */
export default function DecisionDialog({
	open,
	action,
	decisionNote,
	isPending,
	error,
	onNoteChange,
	onConfirm,
	onClose,
}: Props) {
	const isReject = action === "reject";
	return (
		<ConfirmDialog
			open={open}
			title={isReject ? "인증서 요청 거절" : "인증서 요청 승인"}
			description={
				isReject
					? "거절 사유는 요청 이력에 함께 보관됩니다. Device는 CSR을 다시 제출해야 합니다."
					: "승인하면 Intermediate CA가 인증서를 발급합니다. 승인 전에 SAN URI가 등록된 Device Key와 일치하는지 확인하세요."
			}
			confirmLabel={isReject ? "거절하기" : "승인하기"}
			confirmColor={isReject ? "error" : "primary"}
			isPending={isPending}
			error={error}
			onConfirm={onConfirm}
			onClose={onClose}
			confirmDisabled={isReject && decisionNote.trim() === ""}
		>
			<TextField
				label={isReject ? "거절 사유 (필수)" : "메모 (선택)"}
				fullWidth
				multiline
				minRows={2}
				value={decisionNote}
				onChange={(event) => onNoteChange(event.target.value)}
			/>
		</ConfirmDialog>
	);
}
