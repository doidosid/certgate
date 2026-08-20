import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { ApiError } from "../../shared/api/ApiError";
import EnrollmentTokenPanel from "./EnrollmentTokenPanel";
import { useRegisterDevice, useRoles, type IssuedEnrollmentToken } from "./queries";

interface Props {
	open: boolean;
	onClose: () => void;
}

/**
 * Device 등록. 성공하면 폼 대신 Token 패널로 바뀐다 — 평문 Token은 이 응답에만 한 번
 * 오므로(security-design.md §2) 사용자가 그것을 확인하기 전에 창을 정리해 버리면 안 된다.
 *
 * 평문은 이 컴포넌트의 지역 상태에만 둔다. mutation 상태에서도 지우고(reset) Query
 * Cache에는 애초에 들어가지 않는다 — 같은 값이 여러 곳에 남을 이유가 없다.
 */
export default function DeviceRegisterDialog({ open, onClose }: Props) {
	const [deviceKey, setDeviceKey] = useState("");
	const [name, setName] = useState("");
	const [roleName, setRoleName] = useState("");
	const [issued, setIssued] = useState<IssuedEnrollmentToken | null>(null);

	const roles = useRoles();
	// 평문은 mutation의 data를 거치지 않고 여기로 바로 들어온다(queries.ts 주석 참고).
	const register = useRegisterDevice(setIssued);

	const canSubmit =
		deviceKey.trim() !== "" && name.trim() !== "" && roleName !== "" && !register.isPending;

	function submit() {
		register.mutate({ deviceKey: deviceKey.trim(), name: name.trim(), roleName });
	}

	function close() {
		// 창을 닫는 순간 평문을 버린다. 다시 열어도 남아 있으면 안 된다.
		setIssued(null);
		setDeviceKey("");
		setName("");
		setRoleName("");
		register.reset();
		onClose();
	}

	return (
		<Dialog open={open} onClose={register.isPending ? undefined : close} fullWidth maxWidth="sm">
			<DialogTitle>{issued ? "Device를 등록했습니다" : "Device 등록"}</DialogTitle>
			<DialogContent>
				{issued ? (
					<EnrollmentTokenPanel token={issued.token} expiresAt={issued.expiresAt} />
				) : (
					<>
						<DialogContentText sx={{ mb: 2 }}>
							등록하면 단기 Enrollment Token이 발급됩니다. Device는 그 Token으로 CSR을 제출합니다.
						</DialogContentText>
						<Stack spacing={2}>
							{/*
							 * Device Key는 인증서 SAN URI(urn:certgate:device:{device-key})의 일부가
							 * 되고 등록 후에는 바꿀 수 없다(ADR-001). 그 사실을 입력 시점에 알린다.
							 */}
							<TextField
								label="Device Key (필수)"
								fullWidth
								required
								value={deviceKey}
								helperText="인증서 SAN URI에 들어가며 등록 후 변경할 수 없습니다."
								onChange={(event) => setDeviceKey(event.target.value)}
							/>
							<TextField
								label="이름 (필수)"
								fullWidth
								required
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
							<TextField
								select
								label="Role (필수)"
								fullWidth
								required
								value={roleName}
								onChange={(event) => setRoleName(event.target.value)}
								error={roles.isError}
								helperText={
									roles.isError ? "Role 목록을 불러오지 못했습니다." : "Role이 접근 가능한 경로를 결정합니다."
								}
							>
								{(roles.data ?? []).map((role) => (
									<MenuItem key={role.name} value={role.name}>
										{role.name}
									</MenuItem>
								))}
							</TextField>
						</Stack>
						{Boolean(register.error) && (
							<Alert severity="error" sx={{ mt: 2 }}>
								{register.error instanceof ApiError
									? register.error.message
									: "요청을 처리하지 못했습니다."}
								{register.error instanceof ApiError && (
									<Typography variant="caption" component="div" color="text.secondary">
										{register.error.code} · traceId {register.error.traceId}
									</Typography>
								)}
							</Alert>
						)}
					</>
				)}
			</DialogContent>
			<DialogActions>
				<Button onClick={close} disabled={register.isPending}>
					{issued ? "닫기" : "취소"}
				</Button>
				{!issued && (
					<Button variant="contained" onClick={submit} disabled={!canSubmit}>
						등록
					</Button>
				)}
			</DialogActions>
		</Dialog>
	);
}
