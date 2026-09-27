"""Main entry point for the Raspberry Pi worker."""

from __future__ import annotations

from backend_client import BackendClient, BackendClientError
from camera import CameraError, capture_image
from config import load_config
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


def run_once() -> None:
    """Run one Backend communication cycle."""

    config = load_config()
    client = BackendClient(config)

    print(
        f"[Pi Worker] Device: "
        f"{config.device_id}"
    )

    print("[Pi Worker] Sending heartbeat...")

    heartbeat = client.heartbeat()

    print(
        "[Pi Worker] Heartbeat OK:",
        heartbeat,
    )

    print(
        "[Pi Worker] Loading monitoring config..."
    )

    monitoring_response = (
        client.get_monitoring_config()
    )

    print(
        "[Pi Worker] Monitoring config:",
        monitoring_response,
    )

    monitoring_config = (
        monitoring_response.get("data")
        or {}
    )

    farming_type = monitoring_config.get(
        "farming_type"
    )

    if farming_type not in {
        "caged",
        "free_range",
    }:
        raise RuntimeError(
            "Backend returned invalid farming_type: "
            f"{farming_type}"
        )

    print(
        "[Pi Worker] Checking for command..."
    )

    command = client.claim_command()

    if command is None:
        print(
            "[Pi Worker] No pending command."
        )
        return

    print(
        "[Pi Worker] Claimed command:",
        command,
    )

    handle_command(
        client,
        command,
        farming_type,
    )


def main() -> None:
    try:
        run_once()

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

    except KeyboardInterrupt:
        print(
            "\n[Pi Worker] Stopped."
        )


if __name__ == "__main__":
    main()