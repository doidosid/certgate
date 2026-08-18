package tech.certgate.common;

import java.util.List;
import org.springframework.data.domain.Page;

/** docs/api-spec.md §1 "페이지 응답". */
public record PageResponse<T>(List<T> content, int page, int size, long totalElements, int totalPages) {

	public static <T> PageResponse<T> of(Page<T> page) {
		return new PageResponse<>(page.getContent(), page.getNumber(), page.getSize(), page.getTotalElements(), page.getTotalPages());
	}
}
