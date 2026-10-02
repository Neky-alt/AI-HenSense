"""Main entry point for the Raspberry Pi worker."""

from __future__ import annotations

import time

from backend_client import BackendClient, BackendClientError
from camera import CameraError, capture_image
from config import PiWorkerConfig, load_config
from inference import LocalInferenceEngine, LocalInferenceError


def handle_manual_detection(
    client: BackendClient,
    command: dict,
    farming_type: str,
) -> None:
    """Execute one manual detection command locally."""

    command_id = command["command_id"]

    print(
        f"[Pi Worker] Executing manual detection: "
        f"{command_id}"
    )

    try:
        print(
            f"[Pi Worker] Loading local inference "
            f"engine ({farming_type})..."
        )

        engine = LocalInferenceEngine(
            farming_type
        )
        engine.load()

        print("[Pi Worker] Capturing image...")
        image_path = capture_image()

        print("[Pi Worker] Running local inference...")
        result = engine.predict(
            image_path
        )

        print(
            "[Pi Worker] Local inference result:",
            result,
        )

        print(
            "[Pi Worker] Uploading result to Backend..."
        )

        response = client.submit_detection_result(
            command_id,
            image_path,
            result,
        )

        print(
            "[Pi Worker] Detection completed:",
            response,
        )

    except (
        CameraError,
        LocalInferenceError,
    ) as exc:
        print(
            f"[Pi Worker] Local execution failed: "
            f"{exc}"
        )

        try:
            client.fail_command(
                command_id,
                str(exc),
            )
        except BackendClientError as fail_exc:
            print(
                "[Pi Worker] Could not report command "
                f"failure: {fail_exc}"
            )

        raise

def run_automatic_monitoring_sample(
    client: BackendClient,
    farming_type: str,
) -> None:
    """Capture, infer, and upload one automatic monitoring sample."""

    print(
        f"[Pi Worker] Running automatic monitoring sample "
        f"({farming_type})..."
    )

    print(
        f"[Pi Worker] Loading local inference "
        f"engine ({farming_type})..."
    )

    engine = LocalInferenceEngine(
        farming_type
    )
    engine.load()

    print(
        "[Pi Worker] Capturing monitoring image..."
    )

    image_path = capture_image()

    print(
        "[Pi Worker] Running local inference..."
    )

    result = engine.predict(
        image_path
    )

    print(
        "[Pi Worker] Monitoring inference result:",
        result,
    )

    print(
        "[Pi Worker] Uploading monitoring sample..."
    )

    response = client.submit_monitoring_sample(
        image_path,
        result,
    )

    print(
        "[Pi Worker] Monitoring sample accepted:",
        response,
    )

def handle_command(
    client: BackendClient,
    command: dict,
    farming_type: str,
) -> None:
    """Dispatch one claimed hardware command."""

    command_type = command.get(
        "command_type"
    )

    if command_type == "manual_detection":
        handle_manual_detection(
            client,
            command,
            farming_type,
        )
        return

    command_id = command["command_id"]

    message = (
        f"Unsupported command type: "
        f"{command_type}"
    )

    try:
        client.fail_command(
            command_id,
            message,
        )
    except BackendClientError as exc:
        print(
            "[Pi Worker] Could not report unsupported "
            f"command: {exc}"
        )

    raise RuntimeError(message)


def run_cycle(
    client: BackendClient,
    config: PiWorkerConfig,
) -> None:
    """Run one Pi Worker polling cycle."""

    print("[Pi Worker] Sending heartbeat...")
    client.heartbeat()

    monitoring_response = client.get_monitoring_config()
    monitoring_data = monitoring_response.get("data") or {}

    farming_type = monitoring_data.get("farming_type")

    if farming_type not in {
        "caged",
        "free_range",
    }:
        raise RuntimeError(
            f"Unsupported farming type: {farming_type}"
        )

    # Manual commands have priority over automatic monitoring.
    command_response = client.claim_command()
    command = command_response.get("data")

    if command is not None:
        print(
            "[Pi Worker] Claimed command:",
            command.get("command_id"),
        )

        handle_command(
            client,
            command,
            farming_type,
        )
        return

    # No manual command is waiting. Ask Backend whether an
    # automatic monitoring sample is currently due.
    due_response = client.get_monitoring_due()
    due_data = due_response.get("data") or {}

    if not due_data.get("due", False):
        print(
            "[Pi Worker] No automatic monitoring due:",
            due_data.get("reason"),
        )
        return

    print(
        "[Pi Worker] Automatic monitoring is due:",
        due_data.get("reason"),
        "due_at=",
        due_data.get("due_at"),
    )

    run_automatic_monitoring_sample(
        client,
        farming_type,
    )

def run_forever() -> None:
    """Continuously poll the Backend for hardware work."""

    config = load_config()
    client = BackendClient(config)

    print(
        f"[Pi Worker] Device: "
        f"{config.device_id}"
    )

    print(
        f"[Pi Worker] Poll interval: "
        f"{config.poll_interval_seconds} seconds"
    )

    while True:
        try:
            run_cycle(
                client,
                config,
            )

        except BackendClientError as exc:
            print(
                f"[Pi Worker] Backend error: {exc}"
            )

        except CameraError as exc:
            print(
                f"[Pi Worker] Camera error: {exc}"
            )

        except LocalInferenceError as exc:
            print(
                f"[Pi Worker] Inference error: {exc}"
            )

        except RuntimeError as exc:
            print(
                f"[Pi Worker] Worker error: {exc}"
            )

        print(
            f"[Pi Worker] Waiting "
            f"{config.poll_interval_seconds} seconds..."
        )

        time.sleep(
            config.poll_interval_seconds
        )


def main() -> None:
    try:
        run_forever()

    except KeyboardInterrupt:
        print(
            "\n[Pi Worker] Stopped."
        )


if __name__ == "__main__":
    main()