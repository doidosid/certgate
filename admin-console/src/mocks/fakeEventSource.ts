import { vi } from "vitest";

/**
 * jsdom에는 `EventSource`가 없다. `AppLayout`이 CRITICAL Toast Provider를 감싸면서
 * 화면 테스트마다 하나가 만들어지므로 대신 쓸 것이 필요하다.
 *
 * **연결 사실을 기록한다.** 아무것도 기록하지 않는 껍데기로 두면 `AppLayout`에서
 * Provider를 통째로 지워도 모든 화면 테스트가 그대로 통과한다 — 기능 삭제 mutation을
 * 가리는 stub이 된다(Codex 리뷰 PR #49 Medium). `routes.test.tsx`가 이 기록으로 전역
 * 배선을 확인하고, `CriticalEventProvider.test.tsx`가 같은 fake로 수신·재연결을
 * 직접 일으킨다.
 */
export class FakeEventSource {
	static instances: FakeEventSource[] = [];

	static reset() {
		FakeEventSource.instances = [];
	}

	/** 마지막으로 만들어진 연결. 없으면 던진다 — 없는데 조작하려 한 것 자체가 오류다. */
	static last(): FakeEventSource {
		const source = FakeEventSource.instances.at(-1);
		if (!source) {
			throw new Error("EventSource가 만들어지지 않았다");
		}
		return source;
	}

	listeners = new Map<string, (event: MessageEvent) => void>();
	onopen: (() => void) | null = null;
	onerror: (() => void) | null = null;
	close = vi.fn();
	url: string;

	constructor(url: string) {
		this.url = url;
		FakeEventSource.instances.push(this);
	}

	addEventListener(type: string, handler: (event: MessageEvent) => void) {
		this.listeners.set(type, handler);
	}

	removeEventListener(type: string) {
		this.listeners.delete(type);
	}

	/** 서버가 그 이름의 Event를 보낸 것처럼 만든다. */
	emit(type: string, data: unknown) {
		const raw = typeof data === "string" ? data : JSON.stringify(data);
		this.listeners.get(type)?.(new MessageEvent(type, { data: raw }));
	}

	/** 브라우저가 연결에 성공한 것처럼 만든다. 재연결도 같은 신호다. */
	open() {
		this.onopen?.();
	}

	/** 연결이 끊긴 것처럼 만든다. 실제 브라우저는 이후 자동으로 다시 연결한다. */
	error() {
		this.onerror?.();
	}
}
