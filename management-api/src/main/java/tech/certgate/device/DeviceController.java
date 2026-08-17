package tech.certgate.device;

import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/devices")
public class DeviceController {

	private final DeviceService deviceService;

	public DeviceController(DeviceService deviceService) {
		this.deviceService = deviceService;
	}

	@PostMapping
	public ResponseEntity<DeviceResponse> register(@RequestBody DeviceRegistrationRequest request) {
		DeviceResponse response = deviceService.register(request);
		return ResponseEntity.created(URI.create("/api/v1/devices/" + response.id())).body(response);
	}
}
