"""
给做网站/App的同学用的推理API服务 —— v2版本，同时支持"笼养"和"散养"两套模型。

背景：笼养(caged)和散养(free_range)是两套完全独立训练的ProtoMIL分类器
(检测器目前共用同一个YOLO头部检测器，但后处理参数不同 —— 散养图片近距离
拍摄，检测器容易把手臂/墙面误判成鸡头，所以散养走的是 conf=0.5 + 只保留
置信度最高的1个框 这条路径，笼养不需要这个限制)。

前端同学调哪个模式，取决于图片来源：
    - 笼养鸡舍照片(多只鸡在笼子里) -> POST /predict/caged
    - 散养/手持近距离拍的单只鸡照片 -> POST /predict/free_range

两个模型在服务启动时就都加载好了(不需要重启服务切换)，接口路径决定用哪个。

!! 重要局限，接口文档里也带了这句，请转告网站/App同学不要当成金标准 !!
这里返回的所有判断(每个检测框normal/low-yield、笼子整体normal_cage/spent_cage、
ratio_normal占比)都是ProtoMIL弱监督训练下的估计值，训练时只监督过"整体对不对"，
没有真实产蛋记录核实过具体某一个检测框/某一张图的判断，可信度请参考 README 或
data/cage_labeling_guide.md 里的说明。

另外单独提醒一句 free_range 模式：目前散养训练数据量还比较小(46张spent_cage vs
269张normal_cage，验证集更小)，train_log.csv 显示验证集AUC能到0.92-0.96，但最后
几轮 val_f1 掉到0 —— 这说明模型倾向于把所有图都判成normal_cage(因为normal样本本来
就多)，spent_cage一类的判断目前还不够可靠，请转告前端同学这条边界情况，后续会用
更多spent_cage数据继续训练。

安装依赖(如果还没装过)：
    pip install fastapi uvicorn python-multipart

启动服务：
    python api_server.py
    (默认监听 http://0.0.0.0:8000，网站/App同学在同一台机器/局域网内用
    http://<你的电脑IP>:8000/predict/caged 或 /predict/free_range 就能调；
    如果他们不在同一网络，需要用 ngrok 之类的工具把本地端口映射到公网URL)

也可以用环境变量指定要加载哪个checkpoint(方便以后换模型不用改代码)，
每个模式各有一组独立的环境变量，前缀 CAGED_ / FREE_RANGE_：
    CAGED_CLS_CKPT=runs/cls/protomil_140img/best.pt python api_server.py
    FREE_RANGE_CLS_CKPT=runs/cls/protomil_free_range/best.pt python api_server.py

接口:
    GET  /health                  健康检查，返回两个模式当前加载的checkpoint路径和状态
    POST /predict/caged           上传一张笼养鸡舍图片(multipart/form-data, 字段名 "file")
    POST /predict/free_range      上传一张散养鸡图片(multipart/form-data, 字段名 "file")

curl 测试示例:
    curl -X POST http://localhost:8000/predict/caged -F "file=@some_cage_image.jpg"
    curl -X POST http://localhost:8000/predict/free_range -F "file=@some_hen_photo.jpg"
"""
from __future__ import annotations

import io
import math
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

import torch
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from torchvision import transforms

import models.patch_ultralytics  # noqa: F401  (需在 import ultralytics 前加载)
from ultralytics import YOLO
from models.protomil import ProtoMIL, ResNetFeatureExtractor

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

DEVICE = os.environ.get(
    "DEVICE",
    "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu"),
)
IMGSZ = int(os.environ.get("IMGSZ", "640"))
PAD_RATIO = float(os.environ.get("PAD_RATIO", "0.1"))
INSTANCE_THRESHOLD = float(os.environ.get("INSTANCE_THRESHOLD", "0.5"))
CAGE_THRESHOLD = float(os.environ.get("CAGE_THRESHOLD", "0.5"))
IMG_SIZE = int(os.environ.get("IMG_SIZE", "224"))

# ---- 每个模式一组独立配置：checkpoint、检测置信度、top_k 过滤 ----
# 散养模式必须开 top_k=1，否则检测器会把手臂/墙面也当成鸡头(域偏移导致的误检，
# 已经用 check_detector_on_free_range.py 验证过 conf=0.5+top_k=1 能解决)。
MODE_CONFIGS = {
    "caged": {
        "label": "笼养",
        "det_weights": os.environ.get("CAGED_DET_WEIGHTS", "weights/detector_yolov8n_head_best.pt"),
        "cls_ckpt": os.environ.get("CAGED_CLS_CKPT", "weights/caged_protomil_best.pt"),
        "conf_threshold": float(os.environ.get("CAGED_CONF_THRESHOLD", "0.25")),
        "top_k": None,
    },
    "free_range": {
        "label": "散养",
        "det_weights": os.environ.get("FREE_RANGE_DET_WEIGHTS", "weights/detector_yolov8n_head_best.pt"),
        "cls_ckpt": os.environ.get("FREE_RANGE_CLS_CKPT", "weights/free_range_protomil_best.pt"),
        "conf_threshold": float(os.environ.get("FREE_RANGE_CONF_THRESHOLD", "0.5")),
        "top_k": int(os.environ.get("FREE_RANGE_TOP_K", "1")),
    },
}

LIMITATION_NOTE = (
    "所有 normal/low-yield 及 normal_cage/spent_cage 判断均为 ProtoMIL 弱监督训练下的"
    "估计值，训练时只监督过整体级别的标签，未经真实产蛋记录逐只核实，仅供参考，"
    "不是核实过的金标准结果。"
)
FREE_RANGE_NOTE = (
    "free_range 模式训练数据目前较少(spent_cage仅46张)，验证集显示模型倾向于把"
    "大多数图判成normal，spent_cage判断的可靠性还在持续改进中。"
)

app = FastAPI(title="Hen Classifier API", version="v2")

# 开发阶段先允许所有来源跨域调用，方便网站/App同学快速接入；
# 后续正式部署时建议改成只允许具体的前端域名。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_state: dict = {"modes": {}}


def _load_detector(det_weights: str, cache: dict):
    """同一个检测器权重文件只加载一次，两个模式如果用的是同一个文件就共享实例。"""
    if det_weights not in cache:
        print(f"[startup] 加载检测器: {det_weights}")
        cache[det_weights] = YOLO(det_weights)
    return cache[det_weights]


@app.on_event("startup")
def load_models():
    det_cache: dict = {}
    transform = transforms.Compose(
        [
            transforms.Resize((IMG_SIZE, IMG_SIZE)),
            transforms.ToTensor(),
            transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
        ]
    )

    for mode, cfg in MODE_CONFIGS.items():
        det_model = _load_detector(cfg["det_weights"], det_cache)

        print(f"[startup] 加载分类器({cfg['label']}): {cfg['cls_ckpt']}  (device={DEVICE})")
        ckpt = torch.load(cfg["cls_ckpt"], map_location=DEVICE)
        extractor = ResNetFeatureExtractor(ckpt["backbone"], pretrained=False).to(DEVICE)
        extractor.load_state_dict(ckpt["extractor"])
        extractor.eval()
        cls_model = ProtoMIL(feat_dim=ckpt["feat_dim"], num_classes=2).to(DEVICE)
        cls_model.load_state_dict(ckpt["model"])
        cls_model.eval()

        _state["modes"][mode] = {
            "det_model": det_model,
            "extractor": extractor,
            "cls_model": cls_model,
            "transform": transform,
            "cfg": cfg,
        }

    print("[startup] 两套模型(caged / free_range)都已加载完成，服务已就绪。")


@app.get("/health")
def health():
    if not _state.get("modes"):
        return {"status": "loading"}
    return {
        "status": "ok",
        "device": DEVICE,
        "modes": {
            mode: {
                "label": entry["cfg"]["label"],
                "det_weights": entry["cfg"]["det_weights"],
                "cls_ckpt": entry["cfg"]["cls_ckpt"],
                "conf_threshold": entry["cfg"]["conf_threshold"],
                "top_k": entry["cfg"]["top_k"],
            }
            for mode, entry in _state["modes"].items()
        },
    }


async def _run_predict(mode: str, file: UploadFile):
    if mode not in MODE_CONFIGS:
        raise HTTPException(status_code=404, detail=f"未知模式 '{mode}'，可选: {list(MODE_CONFIGS)}")
    if mode not in _state.get("modes", {}):
        raise HTTPException(status_code=503, detail="模型还在加载中，请稍后重试")

    entry = _state["modes"][mode]
    cfg = entry["cfg"]

    raw = await file.read()
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="图片解析失败，请确认上传的是有效的jpg/png文件")

    w, h = img.size
    det_model = entry["det_model"]
    extractor = entry["extractor"]
    cls_model = entry["cls_model"]
    transform = entry["transform"]

    result = det_model.predict(source=img, conf=cfg["conf_threshold"], imgsz=IMGSZ, verbose=False)[0]

    if result.boxes is not None and len(result.boxes) > 0:
        boxes = result.boxes.xyxy.cpu().numpy()
        confs = result.boxes.conf.cpu().numpy()
        order = confs.argsort()[::-1]
        boxes = boxes[order]
        if cfg["top_k"] is not None:
            boxes = boxes[: cfg["top_k"]]
    else:
        boxes = []

    total_count = len(boxes)

    base_response = {
        "mode": mode,
        "limitation_note": LIMITATION_NOTE + (f" {FREE_RANGE_NOTE}" if mode == "free_range" else ""),
    }

    if total_count == 0:
        return JSONResponse(
            {
                **base_response,
                "cage_label": "no_detections",
                "ratio_normal": None,
                "total_count": 0,
                "high_count": 0,
                "low_count": 0,
                "instances": [],
            }
        )

    crops = []
    padded_boxes = []
    for box in boxes:
        x1, y1, x2, y2 = box[:4]
        bw, bh = x2 - x1, y2 - y1
        px1 = max(0, x1 - bw * PAD_RATIO)
        py1 = max(0, y1 - bh * PAD_RATIO)
        px2 = min(w, x2 + bw * PAD_RATIO)
        py2 = min(h, y2 + bh * PAD_RATIO)
        padded_boxes.append((float(px1), float(py1), float(px2), float(py2)))
        crops.append(transform(img.crop((px1, py1, px2, py2))))

    feats_input = torch.stack(crops, dim=0).to(DEVICE)
    with torch.no_grad():
        feats = extractor(feats_input)
        inst_probs, is_normal, ratio_normal = cls_model.predict_instances(feats, threshold=INSTANCE_THRESHOLD)

    cage_label = "normal_cage" if ratio_normal >= CAGE_THRESHOLD else "spent_cage"

    instances = []
    high_count = 0
    low_count = 0
    for i, bbox in enumerate(padded_boxes):
        normal = bool(is_normal[i].item())
        prob_normal = float(inst_probs[i, 0].item())
        if normal:
            high_count += 1
        else:
            low_count += 1
        instances.append(
            {
                "bbox": {"x1": bbox[0], "y1": bbox[1], "x2": bbox[2], "y2": bbox[3]},
                "label": "normal" if normal else "low_yield",
                "prob_normal": round(prob_normal, 4),
            }
        )

    return JSONResponse(
        {
            **base_response,
            "cage_label": cage_label,
            "ratio_normal": None if math.isnan(ratio_normal) else round(float(ratio_normal), 4),
            "total_count": total_count,
            "high_count": high_count,
            "low_count": low_count,
            "instances": instances,
        }
    )


@app.post("/predict/caged")
async def predict_caged(file: UploadFile = File(...)):
    return await _run_predict("caged", file)


@app.post("/predict/free_range")
async def predict_free_range(file: UploadFile = File(...)):
    return await _run_predict("free_range", file)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
