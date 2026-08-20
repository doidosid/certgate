import { Link as RouterLink } from "react-router-dom";
import Link from "@mui/material/Link";
import { useDeviceOptions } from "./queries";

interface Props {
	deviceId: string | null;
}

/**
 * Device를 이름으로 보여주고 상세로 가는 링크를 만든다. deviceId가 목록에 없으면
 * (아직 로딩 중, 조회 실패, 100개 상한 밖) 이름을 비우지 않고 UUID를 그대로
 * 드러낸다 — 링크는 여전히 유효하고, 사용자는 무엇을 가리키는지 알 수 있다.
 *
 * deviceId가 null인 것은 Device와 무관한 Event(SYSTEM·PKI)라는 서버의 실제
 * 상태다(data-model.md SecurityEvent). 이때는 링크를 만들지 않는다.
 */
export default function DeviceNameLink({ deviceId }: Props) {
	const devices = useDeviceOptions();

	if (deviceId === null) {
		return <>—</>;
	}

	const name = devices.data?.content.find((device) => device.id === deviceId)?.name;
	return (
		<Link
			component={RouterLink}
			to={`/devices/${deviceId}`}
			underline="hover"
			// 행 전체 클릭(상세 Drawer 열기)과 겹쳐 두 동작이 같이 일어나지 않게 한다.
			onClick={(event) => event.stopPropagation()}
		>
			{name ?? deviceId}
		</Link>
	);
}
