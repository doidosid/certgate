/**
 * 공개 인증서를 파일로 저장한다.
 *
 * 서버가 PEM 문자열을 주므로 화면이 파일로 만든다. 인증서 원문을 화면에 렌더링하지
 * 않는 것과 같은 이유로(ui-design.md §6, security-design.md) 내용을 표시하지 않고
 * 그대로 내려준다.
 */
export function savePem(serialNumber: string, pem: string): void {
	const url = URL.createObjectURL(new Blob([pem], { type: "application/x-pem-file" }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${serialNumber}.pem`;
	anchor.click();
	// click 직후 동기적으로 해제하면 일부 브라우저가 저장을 취소한다. 다음 turn에 푼다.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
