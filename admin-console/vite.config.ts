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
	},
});
