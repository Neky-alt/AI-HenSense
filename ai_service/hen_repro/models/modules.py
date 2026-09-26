"""
自定义网络模块，复现论文《基于头部检测与原型多实例学习的层叠笼养低产蛋鸡识别》
中改进YOLOv8n所使用的三个模块之一：SEAM 注意力机制。

SCDown 与 RepConv 已在 ultralytics(>=8.1) 内置(ultralytics.nn.modules)，
直接复用，不再重复实现，见 patch_ultralytics.py。

SEAM (Separated and Enhancement Attention Module)
---------------------------------------------------
对应论文正文第 1.3.1 节与式(1)-(4)：
    式(1): 三个不同 patch 尺寸的 CSMM 分支输出与原始输入逐元素相加，得到融合后的多尺度空间特征 y
    式(2): 对 y 做全局平均池化，得到全局描述向量
    式(3): 经两层全连接层建模通道依赖，得到通道注意力 logits
    式(4): 对通道注意力 logits 做指数映射(exp)，得到通道权重，并与原始输入 x 逐通道相乘

每个 CSMM 分支 = 深度可分离卷积(不同 patch/kernel 尺寸，建模空间信息) + 1x1 逐点卷积(通道融合降维)，
这与论文"CSMM 可在不同感受野下提取多尺度特征，并采用深度可分离卷积建模空间信息，结合1x1逐点卷积
完成通道融合与降维"的描述一致。
"""

from __future__ import annotations

import torch
import torch.nn as nn


class Residual(nn.Module):
    """f(x) + x 残差包装器，用于在 CSMM 内部保留主干信息、改善梯度传播。"""

    def __init__(self, fn: nn.Module):
        super().__init__()
        self.fn = fn

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.fn(x) + x


class CSMM(nn.Module):
    """通道-空间混合模块 (Channel-Spatial Mixing Module)，SEAM 的一个分支。

    结构: [depthwise(kxk) -> GELU -> BN] 残差块 (重复 n 次) -> pointwise(1x1) -> GELU -> BN
    """

    def __init__(self, c: int, kernel_size: int = 3, n: int = 1):
        super().__init__()
        padding = kernel_size // 2
        blocks = []
        for _ in range(n):
            blocks.append(
                nn.Sequential(
                    Residual(
                        nn.Sequential(
                            nn.Conv2d(c, c, kernel_size, stride=1, padding=padding, groups=c, bias=False),
                            nn.GELU(),
                            nn.BatchNorm2d(c),
                        )
                    ),
                    nn.Conv2d(c, c, kernel_size=1, stride=1, padding=0, groups=1, bias=False),
                    nn.GELU(),
                    nn.BatchNorm2d(c),
                )
            )
        self.block = nn.Sequential(*blocks)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class SEAM(nn.Module):
    """SEAM 注意力模块：三种不同 patch 尺寸的 CSMM 分支 + 通道注意力(指数映射)。

    Args:
        c1: 输入通道数 (由 parse_model 自动从 ch[f] 传入)
        c2: 输出通道数，SEAM 不改变通道数，因此必须等于 c1
        kernel_sizes: 三个 CSMM 分支对应的 patch/kernel 尺寸，默认 (3, 5, 7)
        n: 每个 CSMM 分支内部残差块重复次数
        reduction: 通道注意力 FC 瓶颈压缩比
    """

    def __init__(self, c1: int, c2: int | None = None, kernel_sizes=(3, 5, 7), n: int = 1, reduction: int = 16):
        super().__init__()
        c2 = c1 if c2 is None else c2
        assert c1 == c2, f"SEAM 不改变通道数，但收到 c1={c1}, c2={c2}"
        self.c = c1
        self.branches = nn.ModuleList([CSMM(c1, k, n) for k in kernel_sizes])
        self.avg_pool = nn.AdaptiveAvgPool2d(1)
        hidden = max(c1 // reduction, 4)
        self.fc = nn.Sequential(
            nn.Linear(c1, hidden, bias=False),
            nn.ReLU(inplace=True),
            nn.Linear(hidden, c1, bias=False),
        )
        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.constant_(m.weight, 1)
                nn.init.constant_(m.bias, 0)
        # 论文式(4)中的指数映射希望初始权重接近1(exp(0)=1)，因此将最后一层FC初始化为0附近
        nn.init.zeros_(self.fc[-1].weight)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, c, _, _ = x.shape
        y = x
        for branch in self.branches:
            y = y + branch(x)  # 式(1): 多分支输出与原始输入逐元素相加
        z = self.avg_pool(y).view(b, c)  # 式(2): 全局平均池化
        z = self.fc(z)  # 式(3): 两层FC建模通道依赖
        z = torch.exp(z).view(b, c, 1, 1)  # 式(4): 指数映射扩展权重范围到 (0, +inf)
        return x * z.expand_as(x)


if __name__ == "__main__":
    m = SEAM(c1=64, c2=64)
    x = torch.randn(2, 64, 32, 32)
    y = m(x)
    assert y.shape == x.shape
    print("SEAM smoke test OK, output shape:", y.shape)
