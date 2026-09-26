"""Render AI instances on a separate image, in the AI's raw-pixel coordinate space."""
from io import BytesIO
import math

from PIL import Image, ImageDraw, ImageFont

from app.services.ai_adapter import AIInferenceResult
from app.services.capture_adapter import CapturedFrame
from app.services.detection_images import save_capture_image


def decoded_image(frame: CapturedFrame) -> Image.Image:
    with Image.open(BytesIO(frame.content)) as image:
        if image.format not in {"JPEG", "PNG"}:
            raise ValueError("Only decoded JPEG/PNG input is supported")
        # The current AI opens raw pixels without exif_transpose. Reject a rotated
        # input rather than silently changing pixels/coordinates or the original.
        if image.getexif().get(274, 1) != 1:
            raise ValueError("EXIF-rotated input must be explicitly normalized before inference")
        image.load()
        return image.convert("RGB")


def render_annotation(frame: CapturedFrame, result: AIInferenceResult) -> bytes:
    image = decoded_image(frame)
    width, height = image.size
    if len(result.detections) != result.total_count:
        raise ValueError("Instance count does not match AI total_count")
    normal = low = 0
    for instance in result.detections:
        if not isinstance(instance, dict):
            raise ValueError("Invalid instance")
        label, probability, box = instance.get("label"), instance.get("prob_normal"), instance.get("bbox")
        if label not in {"normal", "low_yield"} or not isinstance(box, dict):
            raise ValueError("Invalid instance label or bbox")
        values = [box.get(key) for key in ("x1", "y1", "x2", "y2")]
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in [*values, probability]):
            raise ValueError("Coordinates and prob_normal must be finite numbers")
        x1, y1, x2, y2 = values
        if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height and 0 <= probability <= 1):
            raise ValueError("Instance outside image/probability bounds")
        normal += label == "normal"
        low += label == "low_yield"
    if (normal, low) != (result.normal_count, result.low_count):
        raise ValueError("Instance labels disagree with AI counts")

    draw = ImageDraw.Draw(image)
    font_size = max(12, round(min(width, height) / 85))
    font = ImageFont.load_default(size=font_size)
    stroke = max(2, round(min(width, height) / 250))
    labels = []
    for instance in result.detections:
        box = instance["bbox"]
        x1, y1, x2, y2 = (box[k] for k in ("x1", "y1", "x2", "y2"))
        color = (22, 163, 74) if instance["label"] == "normal" else (220, 38, 38)
        label = "Normal" if instance["label"] == "normal" else "Low"
        label += f" | p(Normal)={instance['prob_normal']:.4f}"
        draw.rectangle((x1, y1, min(x2, width - 1), min(y2, height - 1)), outline=color, width=stroke)
        bbox = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0] + 8, bbox[3] - bbox[1] + 6
        tx, ty = max(0, min(x1, width - tw)), max(0, min(y1 - th, height - th))
        # Keep dense/overlapping AI detections, but place their labels separately.
        candidates = [(tx, ty)]
        for step in range(1, height // (th + 2) + 1):
            candidates.extend((tx, y) for y in (ty - step * (th + 2), ty + step * (th + 2)) if 0 <= y <= height - th)
        for cx, cy in candidates:
            if all(cx + tw <= a or a + w <= cx or cy + th <= b or b + h <= cy for a, b, w, h in labels):
                tx, ty = cx, cy
                break
        labels.append((tx, ty, tw, th))
        draw.line((x1, y1, tx, ty + th), fill=color, width=1)
        draw.rectangle((tx, ty, tx + tw, ty + th), fill=color)
        draw.text((tx + 4, ty + 3 - bbox[1]), label, fill="white", font=font)
    output = BytesIO()
    image.save(output, format="PNG")  # No EXIF orientation copied to derivative.
    return output.getvalue()


def save_annotation(frame: CapturedFrame, result: AIInferenceResult, device_id: str) -> str:
    return save_capture_image(CapturedFrame(
        content=render_annotation(frame, result), filename="annotated.png",
        content_type="image/png", captured_at=frame.captured_at,
    ), device_id)
