"""Shared media + transactional persistence, without changing warning rules."""

from dataclasses import replace
import hashlib

from app.enums import CaptureSourceType, TriggerType
from app.services.detection_annotations import save_annotation
from app.services.detection_images import remove_image, save_capture_image
from app.services.detection_pipeline import persist_ai_result


def persist_inference_media(
    db,
    device,
    frame,
    result,
    *,
    source=CaptureSourceType.pi_camera,
    trigger_type=TriggerType.manual,
    provenance=None,
):
    """Save inference media and persist the detection transactionally."""

    paths = []

    try:
        original = save_capture_image(
            frame,
            device.device_id,
        )
        paths.append(original)

        annotated = None

        if result.raw_response is not None:
            annotated = save_annotation(
                frame,
                result,
                device.device_id,
            )
            paths.append(annotated)

        metadata = dict(provenance or {})

        # Keep an explicitly supplied origin, such as pi_local_inference.
        # Legacy inference calls that do not provide an origin retain the
        # existing ai_inference default.
        metadata.setdefault(
            "origin",
            "ai_inference"
            if result.raw_response is not None
            else "unknown",
        )

        metadata.update(
            {
                "input_sha256": hashlib.sha256(
                    frame.content
                ).hexdigest(),
                "original_filename": frame.filename,
                "coordinate_space": "raw_image_pixels",
            }
        )

        return persist_ai_result(
            db,
            device,
            replace(
                result,
                detected_at=result.detected_at
                or frame.captured_at,
            ),
            trigger_type=trigger_type,
            capture_source_type=source,
            image_path=original,
            annotated_image_path=annotated,
            provenance=metadata,
        )

    except Exception:
        db.rollback()

        for path in paths:
            remove_image(path)

        raise
