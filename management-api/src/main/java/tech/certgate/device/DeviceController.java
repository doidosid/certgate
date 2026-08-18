package tech.certgate.device;

import java.net.URI;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tech.certgate.common.ApiException;
import tech.certgate.common.PageResponse;

/**
 * docs/api-spec.md §3 "Device API". Protected only by deployment restriction
 * in the MVP - no application-level admin auth yet (same as
 * CertificateRequestAdminController).
 */
@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {

	private static final int DEFAULT_PAGE_SIZE = 20;
	private static final int MAX_PAGE_SIZE = 100;
	private static final Sort DEFAULT_SORT = Sort.by("createdAt").descending();
	private static final Set<String> SORTABLE_FIELDS = Set.of("createdAt", "name", "deviceKey", "roleName", "status", "lastSeenAt");

	private final DeviceService deviceService;

	public DeviceController(DeviceService deviceService) {
		this.deviceService = deviceService;
	}

	@PostMapping
	public ResponseEntity<DeviceResponse> register(@RequestBody DeviceRegistrationRequest request) {
		DeviceResponse response = deviceService.register(request);
		return ResponseEntity.created(URI.create("/api/v1/devices/" + response.id())).body(response);
	}

	@GetMapping
	public PageResponse<DeviceListItemResponse> list(
			@RequestParam(required = false) String query,
			@RequestParam(required = false) DeviceStatus status,
			@RequestParam(required = false) String roleName,
			@RequestParam(defaultValue = "0") int page,
			@RequestParam(defaultValue = "" + DEFAULT_PAGE_SIZE) int size,
			@RequestParam(required = false) String sort) {
		Pageable pageable = PageRequest.of(Math.max(page, 0), Math.min(Math.max(size, 1), MAX_PAGE_SIZE), parseSort(sort));
		return deviceService.list(query, status, roleName, pageable);
	}

	/**
	 * "field,direction" (e.g. "name,asc"); direction may be omitted (defaults
	 * to ASC). Omitting {@code sort} entirely falls back to the default sort,
	 * but a field outside {@link #SORTABLE_FIELDS} or an unrecognized
	 * direction is rejected rather than silently coerced — a typo like
	 * "descending" must not silently come back as ASC (Codex 리뷰 PR #26
	 * Medium). {@code id} is added as a tiebreaker so paging stays stable.
	 */
	private static Sort parseSort(String sort) {
		if (sort == null || sort.isBlank()) {
			return DEFAULT_SORT;
		}
		String[] parts = sort.split(",", 2);
		String field = parts[0].trim();
		if (!SORTABLE_FIELDS.contains(field)) {
			throw invalidSort();
		}
		Sort.Direction direction = Sort.Direction.ASC;
		if (parts.length > 1 && !parts[1].isBlank()) {
			String directionValue = parts[1].trim();
			if ("asc".equalsIgnoreCase(directionValue)) {
				direction = Sort.Direction.ASC;
			} else if ("desc".equalsIgnoreCase(directionValue)) {
				direction = Sort.Direction.DESC;
			} else {
				throw invalidSort();
			}
		}
		return Sort.by(direction, field).and(Sort.by("id"));
	}

	private static ApiException invalidSort() {
		return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST_PARAMETER", "'sort' 값이 올바르지 않습니다.");
	}

	@GetMapping("/{deviceId}")
	public DeviceDetailResponse get(@PathVariable UUID deviceId) {
		return deviceService.getDetail(deviceId);
	}

	@PatchMapping("/{deviceId}/status")
	public DeviceSummaryResponse updateStatus(@PathVariable UUID deviceId, @RequestBody DeviceStatusUpdateRequest request) {
		return deviceService.updateStatus(deviceId, request.status());
	}

	@PutMapping("/{deviceId}/role")
	public DeviceSummaryResponse updateRole(@PathVariable UUID deviceId, @RequestBody DeviceRoleUpdateRequest request) {
		return deviceService.updateRole(deviceId, request.roleName());
	}

	@PostMapping("/{deviceId}/enrollment-token")
	public EnrollmentTokenResponse reissueToken(@PathVariable UUID deviceId) {
		return deviceService.reissueToken(deviceId);
	}
}
