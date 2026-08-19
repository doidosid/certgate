/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_API_BASE_URL: string;
	readonly VITE_SSE_URL: string;
	/** "true"일 때만 브라우저에서 MSW Mock Worker를 켠다. 개발 편의용이며 운영에서는 설정하지 않는다. */
	readonly VITE_USE_MOCK?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
