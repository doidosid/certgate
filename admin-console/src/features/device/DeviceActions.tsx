import { useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ConfirmDialog from "../../shared/ui/ConfirmDialog";
import EnrollmentTokenPanel from "./EnrollmentTokenPanel";
import {
	useReissueToken,
	useRoles,
	useUpdateDeviceRole,
	useUpdateDeviceStatus,
	type IssuedEnrollmentToken,
} from "./queries";
import type { DeviceDetail } from "../../shared/api/types";

interface Props {
	device: DeviceDetail;
}

type OpenDialog = "status" | "role" | "token" | null;

/**
 * Device 상세의 관리 동작 (ui-design.md §4).
 *
 * 물리 삭제는 만들지 않는다 — 문서가 제공하지 않기로 한 기능이고, 인증서를 발급한 Device의
 * 기록을 지우면 Security Event의 deviceId가 가리킬 대상이 사라진다. 접근을 막는 수단은
 * 비활성화와 인증서 폐기다.
 */
export default function DeviceActions({ device }: Props) {
	const [open, setOpen] = useState<OpenDialog>(null);
	const [roleName, setRoleName] = useState(device.roleName);
	const [issued, setIssued] = useState<IssuedEnrollmentToken | null>(null);

	const roles = useRoles();
	const updateStatus = useUpdateDeviceStatus();
	const updateRole = useUpdateDeviceRole();
	// 평문은 mutation의 data를 거치지 않고 여기로 바로 들어온다(queries.ts 주석 참고).
	const reissue = useReissueToken(setIssued);

	const willDisable = device.status === "ACTIVE";
	const busy = updateStatus.isPending || updateRole.isPending || reissue.isPending;

	function close() {
		setOpen(null);
		// Token 평문은 창을 닫는 순간 버린다.
		setIssued(null);
		updateStatus.reset();
		updateRole.reset();
		reissue.reset();
	}

	return (
		<>
			<Stack direction="row" spacing={1}>
				<Button
					variant="outlined"
					disabled={busy}
					// 열 때마다 최신 Role로 초기화한다. mount 이후 다른 관리자가 바꿨을 수 있다.
					onClick={() => {
						setRoleName(device.roleName);
						setOpen("role");
					}}
				>
					Role 변경
				</Button>
				<Button variant="outlined" disabled={busy} onClick={() => setOpen("token")}>
					Token 재발급
				</Button>
				<Button
					variant="contained"
					color={willDisable ? "error" : "primary"}
					disabled={busy}
					onClick={() => setOpen("status")}
				>
					{willDisable ? "비활성화" : "활성화"}
				</Button>
			</Stack>

			{/*
			 * 비활성화는 Gateway가 이 Device의 요청을 DEVICE_DISABLED로 차단하게 만든다.
			 * 인증서 폐기와 마찬가지로 Cache TTL 때문에 반영에 시간이 걸린다.
			 */}
			<ConfirmDialog
				open={open === "status"}
				title={willDisable ? "Device 비활성화" : "Device 활성화"}
				description={
					willDisable
						? "비활성화하면 Gateway가 이 Device의 요청을 차단합니다. 반영에 최대 30초가 걸리며, 인증서는 그대로 유지됩니다."
						: "활성화하면 유효한 인증서로 다시 접근할 수 있습니다."
				}
				confirmLabel={willDisable ? "비활성화" : "활성화"}
				confirmColor={willDisable ? "error" : "primary"}
				isPending={updateStatus.isPending}
				error={updateStatus.error}
				onConfirm={() =>
					updateStatus.mutate(
						{ deviceId: device.id, status: willDisable ? "DISABLED" : "ACTIVE" },
						{ onSuccess: close },
					)
				}
				onClose={close}
			/>

			<ConfirmDialog
				open={open === "role"}
				title="Role 변경"
				description="Role은 이 Device가 접근할 수 있는 경로를 결정합니다. 변경은 다음 요청부터 적용되며 반영에 최대 30초가 걸립니다."
				confirmLabel="변경"
				isPending={updateRole.isPending}
				error={updateRole.error}
				confirmDisabled={roleName === device.roleName}
				onConfirm={() => updateRole.mutate({ deviceId: device.id, roleName }, { onSuccess: close })}
				onClose={close}
			>
				<TextField
					select
					label="Role"
					fullWidth
					value={roleName}
					onChange={(event) => setRoleName(event.target.value)}
					error={roles.isError}
					helperText={roles.isError ? "Role 목록을 불러오지 못했습니다." : undefined}
				>
					{(roles.data ?? []).map((role) => (
						<MenuItem key={role.name} value={role.name}>
							{role.name}
						</MenuItem>
					))}
				</TextField>
			</ConfirmDialog>

			{/*
			 * 재발급은 ConfirmDialog로 시작하지만 성공 후에는 결과(평문 Token)를 보여줘야
			 * 하므로 같은 창을 Dialog로 직접 그린다. ConfirmDialog는 확인만 하고 닫히는
			 * 동작을 위한 것이다.
			 */}
			{issued === null ? (
				<ConfirmDialog
					open={open === "token"}
					title="Enrollment Token 재발급"
					description="재발급하면 기존 활성 Token은 폐기됩니다. 그 Token으로 진행 중인 등록은 실패하며, 새 Token은 이번 한 번만 표시됩니다."
					confirmLabel="재발급"
					isPending={reissue.isPending}
					error={reissue.error}
					onConfirm={() => reissue.mutate({ deviceId: device.id })}
					onClose={close}
				/>
			) : (
				<Dialog open onClose={close} fullWidth maxWidth="sm">
					<DialogTitle>Enrollment Token을 재발급했습니다</DialogTitle>
					<DialogContent>
						<EnrollmentTokenPanel token={issued.token} expiresAt={issued.expiresAt} />
					</DialogContent>
					<DialogActions>
						<Button onClick={close}>닫기</Button>
					</DialogActions>
				</Dialog>
			)}
		</>
	);
}
