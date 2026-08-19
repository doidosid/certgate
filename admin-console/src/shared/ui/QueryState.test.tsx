import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QueryState from "./QueryState";
import { ApiError } from "../api/ApiError";

describe("QueryState", () => {
	it("shows a progress indicator while loading", () => {
		render(
			<QueryState isLoading isError={false} error={null} isEmpty={false}>
				<div>content</div>
			</QueryState>,
		);
		expect(screen.getByRole("progressbar")).toBeInTheDocument();
		expect(screen.queryByText("content")).not.toBeInTheDocument();
	});

	it("shows the server message and traceId on error", () => {
		const error = new ApiError(409, {
			code: "CONFLICT",
			message: "이미 처리된 요청입니다.",
			traceId: "trace-9",
			fieldErrors: [],
		});
		render(
			<QueryState isLoading={false} isError error={error} isEmpty={false}>
				<div>content</div>
			</QueryState>,
		);
		expect(screen.getByText("이미 처리된 요청입니다.")).toBeInTheDocument();
		expect(screen.getByText(/trace-9/)).toBeInTheDocument();
	});

	it("calls onRetry when the retry button is pressed", async () => {
		const onRetry = vi.fn();
		render(
			<QueryState isLoading={false} isError error={new Error("boom")} isEmpty={false} onRetry={onRetry}>
				<div>content</div>
			</QueryState>,
		);
		await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
		expect(onRetry).toHaveBeenCalledOnce();
	});

	it("shows the empty message instead of children when empty", () => {
		render(
			<QueryState isLoading={false} isError={false} error={null} isEmpty emptyMessage="디바이스가 없습니다.">
				<div>content</div>
			</QueryState>,
		);
		expect(screen.getByText("디바이스가 없습니다.")).toBeInTheDocument();
		expect(screen.queryByText("content")).not.toBeInTheDocument();
	});

	/**
	 * 오류 표시에 서버 원문이 아닌 값이 섞이면 사용자가 볼 Message와 진단용 Reason
	 * Code가 뒤섞인다(development-guide.md). 비-ApiError는 내부 메시지를 그대로
	 * 노출하지 않아야 한다.
	 */
	it("does not leak a non-ApiError's internal message to the user", () => {
		render(
			<QueryState isLoading={false} isError error={new Error("TypeError: undefined is not a function")} isEmpty={false}>
				<div>content</div>
			</QueryState>,
		);
		expect(screen.queryByText(/undefined is not a function/)).not.toBeInTheDocument();
		expect(screen.getByText("알 수 없는 오류가 발생했습니다.")).toBeInTheDocument();
	});

	it("renders children when there is nothing to report", () => {
		render(
			<QueryState isLoading={false} isError={false} error={null} isEmpty={false}>
				<div>content</div>
			</QueryState>,
		);
		expect(screen.getByText("content")).toBeInTheDocument();
	});
});
