import { Link as RouterLink } from "react-router-dom";
import Link from "@mui/material/Link";
import { useDeviceOptions } from "./queries";

interface Props {
	deviceId: string | null;
	/**
	 * true면 링크 없이 이름만 보여준다. 이미 이 항목 전체가 다른 링크·버튼인 자리
	 * (Dashboard의 Critical Event 패널처럼)에서 쓴다 — `<a>` 안에 `<a>`를 중첩하면
	 * 무효한 HTML이 되고 클릭 대상이 모호해진다.
	 */
	linkless?: boolean;
}

/**
 * Device를 이름으로 보여준다. deviceId가 목록에 없으면(아직 로딩 중, 조회 실패, 100개
 * 상한 밖) 이름을 비우지 않고 UUID를 그대로 드러낸다 — 무엇을 가리키는지는 알 수 있다.
 *
 * deviceId가 null인 것은 Device와 무관한 Event(SYSTEM·PKI)라는 서버의 실제
 * 상태다(data-model.md SecurityEvent). 이때는 아무것도 렌더링하지 않는다.
 */
export default function DeviceNameLink({ deviceId, linkless = false }: Props) {
	const devices = useDeviceOptions();

	if (deviceId === null) {
		return <>—</>;
	}

	const name = devices.data?.content.find((device) => device.id === deviceId)?.name ?? deviceId;

	if (linkless) {
		return <>{name}</>;
	}

	return (
		<Link
			component={RouterLink}
			to={`/devices/${deviceId}`}
			underline="hover"
			// 행 전체 클릭(상세 Drawer 열기)과 겹쳐 두 동작이 같이 일어나지 않게 한다.
			onClick={(event) => event.stopPropagation()}
		>
			{name}
		</Link>
	);
}
