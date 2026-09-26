"""
RepHead: 基于结构重参数化的极简解耦检测头。

对应论文正文第 1.3.3 节：
    共享特征提取模块由若干连续的 RepConv 组成（训练时多分支，推理时融合为单分支 3x3 卷积）；
    随后接入两个并行的轻量化预测分支：
        分类分支(Cls Branch): 一个 1x1 卷积，输出类别得分
        回归分支(Reg Branch): 一个 1x1 卷积，输出边界框回归量(DFL 形式)

直接继承 ultralytics 的 Detect 类以复用其 _inference / bias_init / decode_bboxes /
postprocess 等推理与训练基础设施，只重写 __init__ 与 forward，将默认的 3 层卷积
(cv2: Conv,Conv,Conv2d ; cv3: Conv,Conv,Conv2d) 替换为 "共享 RepConv 主干 + 单层 1x1 卷积"。
"""

from __future__ import annotations

import torch
import torch.nn as nn

from ultralytics.nn.modules import RepConv
from ultralytics.nn.modules.head import Detect
from ultralytics.nn.modules.block import DFL


class RepHead(Detect):
    """重参数化解耦检测头 (共享 RepConv 主干 + 轻量 1x1 cls/reg 分支)。

    Args:
        nc: 类别数
        ch: 各检测尺度输入通道数 tuple (由 parse_model 自动传入 [ch[x] for x in f])
        n_rep: 共享 RepConv 主干中重参数化卷积的堆叠层数
    """

    def __init__(self, nc: int = 80, ch: tuple = (), n_rep: int = 2):
        nn.Module.__init__(self)  # 不调用 Detect.__init__，避免构建默认的 cv2/cv3
        self.nc = nc
        self.nl = len(ch)
        self.reg_max = 16
        self.no = nc + self.reg_max * 4
        self.stride = torch.zeros(self.nl)
        self.end2end = False
        self.dynamic = False
        self.export = False
        self.shape = None
        self.anchors = torch.empty(0)
        self.strides = torch.empty(0)

        # 共享特征提取主干：每个检测尺度独立一套 RepConv 堆叠 (通道数不变)
        self.stem = nn.ModuleList(
            nn.Sequential(*[RepConv(x, x, k=3, s=1) for _ in range(n_rep)]) for x in ch
        )
        # 回归分支 (reg): 仅一个 1x1 卷积，输出 4*reg_max 个通道 (DFL 形式的边框回归)
        self.cv2 = nn.ModuleList(nn.Conv2d(x, 4 * self.reg_max, 1) for x in ch)
        # 分类分支 (cls): 仅一个 1x1 卷积，输出 nc 个通道
        self.cv3 = nn.ModuleList(nn.Conv2d(x, nc, 1) for x in ch)
        self.dfl = DFL(self.reg_max) if self.reg_max > 1 else nn.Identity()

    def forward(self, x: list[torch.Tensor]):
        for i in range(self.nl):
            feat = self.stem[i](x[i])  # 共享 RepConv 特征融合
            x[i] = torch.cat((self.cv2[i](feat), self.cv3[i](feat)), 1)
        if self.training:
            return x
        y = self._inference(x)
        return y if self.export else (y, x)

    def bias_init(self):
        """初始化检测头偏置。cv2/cv3 在 RepHead 中是单个 1x1 Conv2d(不是 Sequential)，
        因此不能复用父类 Detect.bias_init() 里 `a[-1]` 的取子模块写法，需要重写。"""
        import math

        for a, b, s in zip(self.cv2, self.cv3, self.stride):
            a.bias.data[:] = 1.0  # box
            b.bias.data[: self.nc] = math.log(5 / self.nc / (640 / s) ** 2)  # cls


if __name__ == "__main__":
    ch = (32, 64, 128)
    head = RepHead(nc=1, ch=ch)
    head.stride = torch.tensor([8.0, 16.0, 32.0])
    xs = [torch.randn(2, c, s, s) for c, s in zip(ch, (80, 40, 20))]
    head.train()
    out_train = head([x.clone() for x in xs])
    print("train mode output shapes:", [o.shape for o in out_train])
    head.eval()
    y, feats = head([x.clone() for x in xs])
    print("eval mode decoded output shape:", y.shape)
