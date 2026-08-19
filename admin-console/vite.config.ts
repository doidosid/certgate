import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	// 개발 중에도 운영(nginx)과 같은 same-origin 경로를 쓰도록 /api를 그대로 넘긴다.
	// 덕분에 Console 코드는 VITE_API_BASE_URL=/api/v1 하나로 양쪽에서 동작한다.
	server: {
		proxy: {
			"/api": {
				target: "http://localhost:8080",
				changeOrigin: false,
			},
		},
	},
	test: {
		environment: "jsdom",
		setupFiles: ["./src/setupTests.ts"],
		// Vite는 .env를 mode별로 읽는데 테스트에는 그 파일이 없어 import.meta.env가
		// 비어 있었다. 그러면 API Client가 "undefined/devices" 같은 URL을 만들고 MSW
		// Handler와 어긋나, 화면 테스트가 조용히 실제 계약과 다른 경로를 검증하게 된다.
		// .env.example과 같은 상대 경로를 넣어 테스트도 운영과 같은 경로 모양을 쓴다.
		env: {
			VITE_API_BASE_URL: "/api/v1",
			VITE_SSE_URL: "/api/v1/security-events/stream",
		},
	},
});
