import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { usePageParams } from "./usePageParams";

function Probe() {
	const { page, size, setPage, setParam } = usePageParams();
	const location = useLocation();
	return (
		<div>
			<span data-testid="page">{String(page)}</span>
			<span data-testid="size">{String(size)}</span>
			<span data-testid="search">{location.search}</span>
			<button onClick={() => setPage(2)}>go page 2</button>
			<button onClick={() => setParam("status", "ACTIVE")}>filter</button>
		</div>
	);
}

function renderAt(initialUrl: string) {
	return render(
		<MemoryRouter initialEntries={[initialUrl]}>
			<Routes>
				<Route path="/devices" element={<Probe />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("usePageParams", () => {
	it("defaults to page 0 and size 20 (api-spec.md §1)", () => {
		renderAt("/devices");
		expect(screen.getByTestId("page")).toHaveTextContent("0");
		expect(screen.getByTestId("size")).toHaveTextContent("20");
	});

	it("reads page and size from the URL", () => {
		renderAt("/devices?page=3&size=50");
		expect(screen.getByTestId("page")).toHaveTextContent("3");
		expect(screen.getByTestId("size")).toHaveTextContent("50");
	});

	/** URL은 사용자가 직접 고칠 수 있다. NaN이 그대로 요청에 실리면 목록이 통째로 깨진다. */
	it("falls back to defaults for non-numeric or negative values", () => {
		renderAt("/devices?page=abc&size=-5");
		expect(screen.getByTestId("page")).toHaveTextContent("0");
		expect(screen.getByTestId("size")).toHaveTextContent("20");
	});

	/**
	 * Codex 리뷰 PR #43 Medium: 서버 Controller는 size를 1~100으로 clamp한다.
	 * Console이 범위 밖 값을 그대로 쓰면 화면의 페이지 크기와 서버가 실제 적용한
	 * 크기가 어긋난다. size=0은 MUI Pagination에도 유효하지 않다.
	 */
	it.each([
		["0", "20"],
		["101", "20"],
		["1.5", "20"],
		["", "20"],
		["1", "1"],
		["100", "100"],
	])("clamps size=%s to the api-spec range", (given, expected) => {
		renderAt(`/devices?size=${given}`);
		expect(screen.getByTestId("size")).toHaveTextContent(expected);
	});

	it("keeps the page when only the page changes", async () => {
		renderAt("/devices?status=ACTIVE");
		await userEvent.click(screen.getByRole("button", { name: "go page 2" }));

		expect(screen.getByTestId("page")).toHaveTextContent("2");
		expect(screen.getByTestId("search")).toHaveTextContent("status=ACTIVE");
	});

	/** 3페이지를 보다가 필터를 좁히면 결과가 없어 빈 화면이 뜬다. */
	it("resets to the first page when a filter changes", async () => {
		renderAt("/devices?page=3");
		await userEvent.click(screen.getByRole("button", { name: "filter" }));

		expect(screen.getByTestId("page")).toHaveTextContent("0");
		expect(screen.getByTestId("search")).not.toHaveTextContent("page=3");
		expect(screen.getByTestId("search")).toHaveTextContent("status=ACTIVE");
	});
});
