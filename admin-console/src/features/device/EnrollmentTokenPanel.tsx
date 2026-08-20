import { useState } from "react";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import DateTimeText from "../../shared/ui/DateTimeText";
import Mono from "../../shared/ui/Mono";

interface Props {
	token: string;
	expiresAt: string;
}

/**
 * 발급된 Enrollment Token을 한 번 보여주는 패널.
 *
 * 서버는 Token의 SHA-256 Hash만 저장하고 평문은 생성 응답에서 한 번만 돌려준다
 * (security-design.md §2). 즉 이 화면을 닫으면 어디서도 다시 볼 수 없다 — 그 사실을
 * 추측하게 두지 않고 문장으로 말한다.
 *
 * 평문은 호출자의 지역 상태에만 있고 Query Cache·URL·로그에 남기지 않는다. 복사 실패에
 * 대비해 값 자체를 선택 가능한 텍스트로 함께 보여준다 — 클립보드 권한이 없는 브라우저에서
 * 복사 버튼만 두면 Token을 옮길 방법이 사라진다.
 */
export default function EnrollmentTokenPanel({ token, expiresAt }: Props) {
	const [copied, setCopied] = useState(false);
	const [copyFailed, setCopyFailed] = useState(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(token);
			setCopied(true);
			setCopyFailed(false);
		} catch {
			// 권한이 없거나 보안 컨텍스트가 아니면 실패한다. 값은 화면에 그대로 있다.
			setCopied(false);
			setCopyFailed(true);
		}
	}

	return (
		<Stack spacing={2}>
			<Alert severity="warning">
				<AlertTitle>이 값은 지금만 확인할 수 있습니다</AlertTitle>
				서버는 Token의 Hash만 저장합니다. 이 창을 닫으면 다시 조회할 수 없고, 필요하면 재발급해야
				합니다(재발급하면 이 Token은 폐기됩니다).
			</Alert>

			<Box>
				<Typography variant="body2" color="textSecondary" gutterBottom>
					Enrollment Token
				</Typography>
				<Box
					sx={{
						p: 1.5,
						borderRadius: 1,
						border: 1,
						borderColor: "divider",
						backgroundColor: "background.default",
						userSelect: "all",
					}}
				>
					<Mono breakAll>{token}</Mono>
				</Box>
			</Box>

			<Typography variant="body2" color="textSecondary">
				만료: <DateTimeText value={expiresAt} />
			</Typography>

			<Box>
				<Button variant="outlined" onClick={() => void copy()}>
					{copied ? "복사했습니다" : "Token 복사"}
				</Button>
				{copyFailed && (
					<Typography variant="body2" color="error" sx={{ mt: 1 }}>
						복사하지 못했습니다. 위 값을 직접 선택해 복사하세요.
					</Typography>
				)}
			</Box>
		</Stack>
	);
}
