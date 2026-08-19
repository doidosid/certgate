import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

/**
 * Backend 없이 화면만 확인할 때 쓴다. VITE_USE_MOCK=true 일 때만 시작하므로
 * 운영 Build에는 Mock이 끼어들지 않는다.
 */
export async function startMockWorker(): Promise<void> {
	await setupWorker(...handlers).start({ onUnhandledRequest: "bypass" });
}
