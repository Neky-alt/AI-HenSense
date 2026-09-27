"""
将自定义模块 (SEAM, RepHead) 注册进 ultralytics 的模型解析器 (parse_model)，
使其可以像内置模块一样在 model.yaml 中通过字符串名称引用。

ultralytics 的 parse_model() 通过 `globals()[m]` 在其所在模块
(ultralytics.nn.tasks) 的全局命名空间中按名称查找模块类，且各模块的
输入/输出通道数解析逻辑写死在一堆 `if m in {...}:` 分支里，无法通过
"注册表"扩展。因此这里复制并扩展该函数(新增 SEAM 与 RepHead 的通道解析分支)，
再将其挂回 ultralytics.nn.tasks.parse_model，实现无侵入式的"猴子补丁"。

用法：在构建/训练自定义模型前，先 `import models.patch_ultralytics` 一次即可。

SCDown 与 RepConv 均已是 ultralytics 内置模块，无需注册。
"""

from __future__ import annotations

import contextlib

import torch
import torch.nn as nn

import ultralytics.nn.tasks as tasks_mod
from ultralytics.nn.tasks import (
    LOGGER,
    colorstr,
    make_divisible,
    Classify,
    Conv,
    ConvTranspose,
    GhostConv,
    Bottleneck,
    GhostBottleneck,
    SPP,
    SPPF,
    DWConv,
    Focus,
    BottleneckCSP,
    C1,
    C2,
    C2f,
    RepNCSPELAN4,
    ELAN1,
    ADown,
    AConv,
    SPPELAN,
    C2fAttn,
    C3,
    C3TR,
    C3Ghost,
    DWConvTranspose2d,
    C3x,
    RepC3,
    PSA,
    SCDown,
    C2fCIB,
    AIFI,
    HGStem,
    HGBlock,
    ResNetLayer,
    Concat,
    Detect,
    WorldDetect,
    Segment,
    Pose,
    OBB,
    ImagePoolingAttn,
    v10Detect,
    RTDETRDecoder,
    CBLinear,
    CBFuse,
)

from .modules import SEAM
from .heads import RepHead

# 让这些自定义类可以在 model.yaml 中直接以字符串名称被引用
tasks_mod.SEAM = SEAM
tasks_mod.RepHead = RepHead


def parse_model_with_custom_modules(d, ch, verbose=True):
    """ultralytics.nn.tasks.parse_model 的扩展版本，新增 SEAM / RepHead 支持。"""
    import ast

    max_channels = float("inf")
    nc, act, scales = (d.get(x) for x in ("nc", "activation", "scales"))
    depth, width, kpt_shape = (d.get(x, 1.0) for x in ("depth_multiple", "width_multiple", "kpt_shape"))
    if scales:
        scale = d.get("scale")
        if not scale:
            scale = tuple(scales.keys())[0]
            LOGGER.warning(f"WARNING ⚠️ no model scale passed. Assuming scale='{scale}'.")
        depth, width, max_channels = scales[scale]

    if act:
        Conv.default_act = eval(act)
        if verbose:
            LOGGER.info(f"{colorstr('activation:')} {act}")

    if verbose:
        LOGGER.info(f"\n{'':>3}{'from':>20}{'n':>3}{'params':>10}  {'module':<45}{'arguments':<30}")
    ch = [ch]
    layers, save, c2 = [], [], ch[-1]
    for i, (f, n, m, args) in enumerate(d["backbone"] + d["head"]):
        m = getattr(torch.nn, m[3:]) if "nn." in m else globals()[m]
        for j, a in enumerate(args):
            if isinstance(a, str):
                with contextlib.suppress(ValueError):
                    args[j] = locals()[a] if a in locals() else ast.literal_eval(a)

        n = n_ = max(round(n * depth), 1) if n > 1 else n
        if m in {
            Classify,
            Conv,
            ConvTranspose,
            GhostConv,
            Bottleneck,
            GhostBottleneck,
            SPP,
            SPPF,
            DWConv,
            Focus,
            BottleneckCSP,
            C1,
            C2,
            C2f,
            RepNCSPELAN4,
            ELAN1,
            ADown,
            AConv,
            SPPELAN,
            C2fAttn,
            C3,
            C3TR,
            C3Ghost,
            DWConvTranspose2d,
            C3x,
            RepC3,
            PSA,
            SCDown,
            C2fCIB,
            SEAM,  # <-- 新增：与 Conv 系模块采用相同的通道解析与宽度缩放逻辑
        }:
            c1, c2 = ch[f], args[0]
            if c2 != nc:
                c2 = make_divisible(min(c2, max_channels) * width, 8)
            if m is C2fAttn:
                args[1] = make_divisible(min(args[1], max_channels // 2) * width, 8)
                args[2] = int(
                    max(round(min(args[2], max_channels // 2 // 32)) * width, 1) if args[2] > 1 else args[2]
                )

            args = [c1, c2, *args[1:]]
            if m in {BottleneckCSP, C1, C2, C2f, C2fAttn, C3, C3TR, C3Ghost, C3x, RepC3, C2fCIB}:
                args.insert(2, n)
                n = 1
        elif m is AIFI:
            args = [ch[f], *args]
        elif m in {HGStem, HGBlock}:
            c1, cm, c2 = ch[f], args[0], args[1]
            args = [c1, cm, c2, *args[2:]]
            if m is HGBlock:
                args.insert(4, n)
                n = 1
        elif m is ResNetLayer:
            c2 = args[1] if args[3] else args[1] * 4
        elif m is nn.BatchNorm2d:
            args = [ch[f]]
        elif m is Concat:
            c2 = sum(ch[x] for x in f)
        elif m in {Detect, WorldDetect, Segment, Pose, OBB, ImagePoolingAttn, v10Detect, RepHead}:
            # <-- 新增 RepHead：与内置检测头一样，需要拿到各输入尺度的通道数列表
            args.append([ch[x] for x in f])
            if m is Segment:
                args[2] = make_divisible(min(args[2], max_channels) * width, 8)
        elif m is RTDETRDecoder:
            args.insert(1, [ch[x] for x in f])
        elif m is CBLinear:
            c2 = args[0]
            c1 = ch[f]
            args = [c1, c2, *args[1:]]
        elif m is CBFuse:
            c2 = ch[f[-1]]
        else:
            c2 = ch[f]

        m_ = nn.Sequential(*(m(*args) for _ in range(n))) if n > 1 else m(*args)
        t = str(m)[8:-2].replace("__main__.", "")
        m.np = sum(x.numel() for x in m_.parameters())
        m_.i, m_.f, m_.type = i, f, t
        if verbose:
            LOGGER.info(f"{i:>3}{str(f):>20}{n_:>3}{m.np:10.0f}  {t:<45}{str(args):<30}")
        save.extend(x % i for x in ([f] if isinstance(f, int) else f) if x != -1)
        layers.append(m_)
        if i == 0:
            ch = []
        ch.append(c2)
    return nn.Sequential(*layers), sorted(save)


# 猴子补丁：ultralytics.nn.tasks.DetectionModel.__init__ 内部以裸名 `parse_model(...)`
# 调用该函数，Python 在调用时才按名称查找该模块全局命名空间，因此替换模块属性即可生效。
tasks_mod.parse_model = parse_model_with_custom_modules

print("[patch_ultralytics] 已注册 SEAM / RepHead，并替换 parse_model 以支持自定义模块。")
