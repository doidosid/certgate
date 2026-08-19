import type { ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { ApiError } from "../api/ApiError";

interface Props {
	open: boolean;
	title: string;
	description?: string;
	confirmLabel: string;
	confirmColor?: "primary" | "error";
	isPending?: boolean;
	error?: unknown;
	onConfirm: () => void;
	onClose: () => void;
	children?: ReactNode;
	confirmDisabled?: boolean;
}

/** 처리 중에는 닫기를 막아, 되돌릴 수 없는 동작이 두 번 실행되지 않게 한다. */
export default function ConfirmDialog({
	open,
	title,
	description,
	confirmLabel,
	confirmColor = "primary",
	isPending = false,
	error,
	onConfirm,
	onClose,
	children,
	confirmDisabled = false,
}: Props) {
	return (
		<Dialog open={open} onClose={isPending ? undefined : onClose} fullWidth maxWidth="sm">
			<DialogTitle>{title}</DialogTitle>
			<DialogContent>
				{description && <DialogContentText sx={{ mb: 2 }}>{description}</DialogContentText>}
				{children}
				{Boolean(error) && (
					<Alert severity="error" sx={{ mt: 2 }}>
						{error instanceof ApiError ? error.message : "요청을 처리하지 못했습니다."}
						{error instanceof ApiError && (
							<div style={{ fontSize: "0.75rem", opacity: 0.8 }}>traceId {error.traceId}</div>
						)}
					</Alert>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={onClose} disabled={isPending}>
					취소
				</Button>
				<Button onClick={onConfirm} color={confirmColor} variant="contained" disabled={isPending || confirmDisabled}>
					{confirmLabel}
				</Button>
			</DialogActions>
		</Dialog>
	);
}
