"""Local YOLO + ProtoMIL inference for the Raspberry Pi worker."""

from __future__ import annotations

import math
import os
from pathlib import Path
from typing import Any

import torch
from PIL import Image
from torchvision import transforms


# ---------------------------------------------------------------------------
# Reuse the existing trained-model source code without running ai_service.
# ---------------------------------------------------------------------------

# The custom Ultralytics patch must be loaded before importing YOLO.
if __package__:
    from .models import patch_ultralytics  # noqa: F401
    from .models.protomil import ProtoMIL, ResNetFeatureExtractor
else:
    import models.patch_ultralytics  # noqa: F401
    from models.protomil import ProtoMIL, ResNetFeatureExtractor

from ultralytics import YOLO

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

IMGSZ = int(os.environ.get("HENSENSE_IMGSZ", "640"))
PAD_RATIO = float(
    os.environ.get("HENSENSE_PAD_RATIO", "0.1")
)
INSTANCE_THRESHOLD = float(
    os.environ.get(
        "HENSENSE_INSTANCE_THRESHOLD",
        "0.5",
    )
)
CAGE_THRESHOLD = float(
    os.environ.get(
        "HENSENSE_CAGE_THRESHOLD",
        "0.5",
    )
)
IMG_SIZE = int(
    os.environ.get("HENSENSE_IMG_SIZE", "224")
)

INFERENCE_DEVICE = os.environ.get(
    "HENSENSE_INFERENCE_DEVICE",
    "cpu",
)


LIMITATION_NOTE = (
    "All normal/low-yield and normal_cage/spent_cage predictions "
    "are estimates produced by a weakly supervised ProtoMIL model. "
    "They have not been individually verified against ground-truth "
    "egg-production records."
)

FREE_RANGE_NOTE = (
    " The free-range model currently has less training data and may "
    "be biased toward normal predictions."
)


PI_WORKER_DIR = Path(__file__).resolve().parent
WEIGHTS_DIR = PI_WORKER_DIR / "weights"


def _default_weight_path(filename: str) -> str:
    return str(
        WEIGHTS_DIR / filename
    )


MODE_CONFIGS: dict[str, dict[str, Any]] = {
    "caged": {
        "det_weights": os.environ.get(
            "CAGED_DET_WEIGHTS",
            _default_weight_path(
                "detector_yolov8n_head_best.pt"
            ),
        ),
        "cls_ckpt": os.environ.get(
            "CAGED_CLS_CKPT",
            _default_weight_path(
                "caged_protomil_best.pt"
            ),
        ),
        "conf_threshold": float(
            os.environ.get(
                "CAGED_CONF_THRESHOLD",
                "0.25",
            )
        ),
        "top_k": None,
    },
    "free_range": {
        "det_weights": os.environ.get(
            "FREE_RANGE_DET_WEIGHTS",
            _default_weight_path(
                "detector_yolov8n_head_best.pt"
            ),
        ),
        "cls_ckpt": os.environ.get(
            "FREE_RANGE_CLS_CKPT",
            _default_weight_path(
                "free_range_protomil_best.pt"
            ),
        ),
        "conf_threshold": float(
            os.environ.get(
                "FREE_RANGE_CONF_THRESHOLD",
                "0.5",
            )
        ),
        "top_k": int(
            os.environ.get(
                "FREE_RANGE_TOP_K",
                "1",
            )
        ),
    },
}


class LocalInferenceError(RuntimeError):
    """Raised when local Pi inference cannot be completed."""


class LocalInferenceEngine:
    """Run YOLO + ProtoMIL directly on the Raspberry Pi."""

    def __init__(
        self,
        mode: str,
        *,
        device: str = INFERENCE_DEVICE,
    ):
        if mode not in MODE_CONFIGS:
            raise LocalInferenceError(
                f"Unsupported farming mode: {mode}"
            )

        self.mode = mode
        self.device = device
        self.config = MODE_CONFIGS[mode]

        self.detector = None
        self.extractor = None
        self.classifier = None

        self.transform = transforms.Compose(
            [
                transforms.Resize(
                    (IMG_SIZE, IMG_SIZE)
                ),
                transforms.ToTensor(),
                transforms.Normalize(
                    IMAGENET_MEAN,
                    IMAGENET_STD,
                ),
            ]
        )

    def load(self) -> None:
        """Load the detector and classifier into memory."""

        det_weights = Path(
            self.config["det_weights"]
        )
        cls_ckpt = Path(
            self.config["cls_ckpt"]
        )

        if not det_weights.is_file():
            raise LocalInferenceError(
                f"Detector weights not found: "
                f"{det_weights}"
            )

        if not cls_ckpt.is_file():
            raise LocalInferenceError(
                f"Classifier checkpoint not found: "
                f"{cls_ckpt}"
            )

        print(
            "[Pi Inference] Loading detector:",
            det_weights,
        )

        self.detector = YOLO(
            str(det_weights)
        )

        print(
            "[Pi Inference] Loading classifier:",
            cls_ckpt,
        )

        checkpoint = torch.load(
            str(cls_ckpt),
            map_location=self.device,
        )

        self.extractor = ResNetFeatureExtractor(
            checkpoint["backbone"],
            pretrained=False,
        ).to(self.device)

        self.extractor.load_state_dict(
            checkpoint["extractor"]
        )
        self.extractor.eval()

        self.classifier = ProtoMIL(
            feat_dim=checkpoint["feat_dim"],
            num_classes=2,
        ).to(self.device)

        self.classifier.load_state_dict(
            checkpoint["model"]
        )
        self.classifier.eval()

        print(
            f"[Pi Inference] Ready "
            f"(mode={self.mode}, "
            f"device={self.device})"
        )

    def predict(
        self,
        image_path: str | Path,
    ) -> dict[str, Any]:
        """Run local inference and return Backend-compatible JSON."""

        if (
            self.detector is None
            or self.extractor is None
            or self.classifier is None
        ):
            raise LocalInferenceError(
                "Inference engine is not loaded"
            )

        path = Path(image_path)

        if not path.is_file():
            raise LocalInferenceError(
                f"Image does not exist: {path}"
            )

        try:
            with Image.open(path) as source:
                image = source.convert("RGB")
        except Exception as exc:
            raise LocalInferenceError(
                f"Unable to decode image: {path}"
            ) from exc

        width, height = image.size

        detection = self.detector.predict(
            source=image,
            conf=self.config["conf_threshold"],
            imgsz=IMGSZ,
            verbose=False,
        )[0]

        if (
            detection.boxes is not None
            and len(detection.boxes) > 0
        ):
            boxes = (
                detection.boxes.xyxy
                .cpu()
                .numpy()
            )

            confidences = (
                detection.boxes.conf
                .cpu()
                .numpy()
            )

            order = confidences.argsort()[::-1]
            boxes = boxes[order]

            top_k = self.config["top_k"]

            if top_k is not None:
                boxes = boxes[:top_k]

        else:
            boxes = []

        total_count = len(boxes)

        limitation_note = LIMITATION_NOTE

        if self.mode == "free_range":
            limitation_note += FREE_RANGE_NOTE

        if total_count == 0:
            return {
                "mode": self.mode,
                "limitation_note": limitation_note,
                "cage_label": "no_detections",
                "ratio_normal": None,
                "total_count": 0,
                "high_count": 0,
                "low_count": 0,
                "instances": [],
            }

        crops = []
        padded_boxes = []

        for box in boxes:
            x1, y1, x2, y2 = box[:4]

            box_width = x2 - x1
            box_height = y2 - y1

            px1 = max(
                0,
                x1 - box_width * PAD_RATIO,
            )
            py1 = max(
                0,
                y1 - box_height * PAD_RATIO,
            )
            px2 = min(
                width,
                x2 + box_width * PAD_RATIO,
            )
            py2 = min(
                height,
                y2 + box_height * PAD_RATIO,
            )

            padded_boxes.append(
                (
                    float(px1),
                    float(py1),
                    float(px2),
                    float(py2),
                )
            )

            crop = image.crop(
                (
                    px1,
                    py1,
                    px2,
                    py2,
                )
            )

            crops.append(
                self.transform(crop)
            )

        feature_input = torch.stack(
            crops,
            dim=0,
        ).to(self.device)

        with torch.no_grad():
            features = self.extractor(
                feature_input
            )

            (
                instance_probabilities,
                is_normal,
                ratio_normal,
            ) = self.classifier.predict_instances(
                features,
                threshold=INSTANCE_THRESHOLD,
            )

        cage_label = (
            "normal_cage"
            if ratio_normal >= CAGE_THRESHOLD
            else "spent_cage"
        )

        instances = []
        high_count = 0
        low_count = 0

        for index, bbox in enumerate(
            padded_boxes
        ):
            normal = bool(
                is_normal[index].item()
            )

            prob_normal = float(
                instance_probabilities[
                    index,
                    0,
                ].item()
            )

            if normal:
                high_count += 1
            else:
                low_count += 1

            instances.append(
                {
                    "bbox": {
                        "x1": bbox[0],
                        "y1": bbox[1],
                        "x2": bbox[2],
                        "y2": bbox[3],
                    },
                    "label": (
                        "normal"
                        if normal
                        else "low_yield"
                    ),
                    "prob_normal": round(
                        prob_normal,
                        4,
                    ),
                }
            )

        ratio_value = (
            None
            if math.isnan(ratio_normal)
            else round(
                float(ratio_normal),
                4,
            )
        )

        return {
            "mode": self.mode,
            "limitation_note": limitation_note,
            "cage_label": cage_label,
            "ratio_normal": ratio_value,
            "total_count": total_count,
            "high_count": high_count,
            "low_count": low_count,
            "instances": instances,
        }