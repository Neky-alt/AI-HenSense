"""Main entry point for the Raspberry Pi worker."""

from __future__ import annotations

from backend_client import BackendClient, BackendClientError
from config import load_config


def run_once() -> None:
    """Run one Backend communication cycle."""

    config = load_config()
    client = BackendClient(config)

    print(
        f"[Pi Worker] Device: {config.device_id}"
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
    monitoring_config = (
        client.get_monitoring_config()
    )
    print(
        "[Pi Worker] Monitoring config:",
        monitoring_config,
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


def main() -> None:
    try:
        run_once()

    except BackendClientError as exc:
        print(
            f"[Pi Worker] Backend error: {exc}"
        )

    except RuntimeError as exc:
        print(
            f"[Pi Worker] Configuration error: {exc}"
        )

    except KeyboardInterrupt:
        print(
            "\n[Pi Worker] Stopped."
        )


if __name__ == "__main__":
    main()