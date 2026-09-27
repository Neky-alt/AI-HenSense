"""
ProtoMIL: 原型引导的多实例学习(MIL)笼级低产蛋鸡分类模型。

对应论文正文第 1.4 节与式(5)-(8)：

    包(bag) = 一张鸡笼图像；实例(instance) = 该笼图中检测到的每个鸡头区域。
    输入实例特征张量维度 (B, N, D)：B=batch size, N=包内实例数(鸡头个数)，D=特征维度。
    (论文训练阶段 batch_size=1，即逐包训练，故这里默认按单包处理，也支持批量图像但每张图各自独立聚合。)

    式(5): e_i = w^T tanh(V h_i^T)          — 实例 i 的注意力打分 (未归一化)
    式(6): z = sum_i softmax(e)_i * h_i     — 包级特征 (注意力加权聚合)
    式(7): p_c^(0) = (1/N_c) * sum_k h_k    — 类别 c 原型的初始值(该类实例特征的全局平均)，
                                               随后作为可学习参数在训练中动态更新
    式(8): s_c = cos_sim(z, p_c)            — 包级特征与各类别原型的余弦相似度，作为分类依据

ResNet 特征提取器 (ResNetFeatureExtractor) 见本文件底部，对应论文
"第二阶段将第一阶段提取的鸡头图像输入 ResNet 网络进行特征提取"。
"""

from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class ResNetFeatureExtractor(nn.Module):
    """基于 torchvision ResNet 的实例特征提取器，输出去掉分类头后的全局池化特征向量。"""

    def __init__(self, backbone: str = "resnet18", pretrained: bool = True, freeze: bool = False):
        super().__init__()
        import torchvision.models as tvm

        ctor = getattr(tvm, backbone)
        weights = None
        if pretrained:
            try:
                weights_enum = getattr(tvm, f"{backbone.capitalize()}_Weights", None)
                weights = weights_enum.DEFAULT if weights_enum is not None else None
            except Exception:
                weights = None
        net = ctor(weights=weights)
        self.out_dim = net.fc.in_features
        net.fc = nn.Identity()
        self.backbone = net
        if freeze:
            for p in self.backbone.parameters():
                p.requires_grad_(False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (N, 3, H, W) 一个包内的所有鸡头裁剪图 -> (N, out_dim) 实例特征"""
        return self.backbone(x)


class ABMILAttention(nn.Module):
    """基础的 attention-based MIL 聚合模块 (Ilse et al., 2018)，对应式(5)-(6)。"""

    def __init__(self, feat_dim: int, hidden_dim: int = 128):
        super().__init__()
        self.V = nn.Linear(feat_dim, hidden_dim, bias=False)
        self.w = nn.Linear(hidden_dim, 1, bias=False)

    def forward(self, h: torch.Tensor):
        """h: (N, D) 包内实例特征 -> (z: (D,), a: (N,)) 包级特征与注意力权重"""
        e = self.w(torch.tanh(self.V(h)))  # 式(5): (N, 1)
        a = torch.softmax(e, dim=0)  # (N, 1)
        z = (a * h).sum(dim=0)  # 式(6): (D,)
        return z, a.squeeze(-1)


class ProtoMIL(nn.Module):
    """原型引导的多实例学习分类模型 (ABMIL + 全局可学习原型 + 余弦相似度分类)。

    Args:
        feat_dim: 实例特征维度 D (ResNet18/34: 512, ResNet50: 2048)
        hidden_dim: 注意力网络隐藏层维度
        num_classes: 类别数 (本任务为2: normal_cage / spent_cage)
        temperature: 余弦相似度 -> logits 的缩放系数 (可学习)，用于配合交叉熵损失训练
    """

    def __init__(self, feat_dim: int = 512, hidden_dim: int = 128, num_classes: int = 2, temperature: float = 10.0):
        super().__init__()
        self.feat_dim = feat_dim
        self.num_classes = num_classes
        self.attention = ABMILAttention(feat_dim, hidden_dim)
        # 式(7): 原型向量，先由数据初始化(见 init_prototypes)，随后作为可学习参数由反向传播更新
        self.prototypes = nn.Parameter(torch.randn(num_classes, feat_dim) * 0.01)
        self.log_temperature = nn.Parameter(torch.log(torch.tensor(float(temperature))))
        self._prototypes_initialized = False

    @torch.no_grad()
    def init_prototypes(self, class_feature_lists: list[torch.Tensor | None]):
        """式(7): 用每个类别全部实例特征的全局平均初始化对应原型。

        Args:
            class_feature_lists: 长度为 num_classes 的列表，每项是形状 (N_c, D) 的实例特征张量，
                N_c 为初始化时用于该类别的实例总数。
        """
        for c, feats in enumerate(class_feature_lists):
            if feats is not None and feats.numel() > 0:
                self.prototypes.data[c] = feats.mean(dim=0)
        self._prototypes_initialized = True

    def forward(self, instance_feats: torch.Tensor):
        """instance_feats: (N, D) 单个包内的实例特征。

        Returns:
            logits: (num_classes,) 分类 logits (可直接送入 CrossEntropyLoss，label 为标量类别索引)
            attn: (N,) 实例注意力权重，可用于可视化哪些鸡头对判决贡献最大
            bag_feat: (D,) 包级特征 z
        """
        z, attn = self.attention(instance_feats)  # 式(5)(6)
        z_n = F.normalize(z, dim=-1)
        p_n = F.normalize(self.prototypes, dim=-1)
        sim = z_n @ p_n.t()  # 式(8): (num_classes,) 余弦相似度 in [-1, 1]
        logits = sim * self.log_temperature.exp()
        return logits, attn, z

    def forward_batch(self, bags: list[torch.Tensor]):
        """便捷方法：对一批包(每包实例数可不同)分别前向，返回堆叠后的 logits。"""
        outs = [self.forward(b) for b in bags]
        logits = torch.stack([o[0] for o in outs], dim=0)
        attns = [o[1] for o in outs]
        feats = torch.stack([o[2] for o in outs], dim=0)
        return logits, attns, feats

    def predict_instances(self, instance_feats: torch.Tensor, threshold: float = 0.5):
        """弱监督的实例(单个鸡头)级推断：跳过式(5)(6)的注意力聚合，直接拿每个实例
        自己的特征 h_i 去和式(7)的类别原型算式(8)的余弦相似度，得到"这一个鸡头更像
        哪个类别"的打分。

        注意：训练时的交叉熵损失只作用于包级 logits(见 forward())，从未直接监督过
        单个实例的标签，所以这里给出的是没有实例级真值验证过的弱监督估计，不是像
        Wang et al. (2025) 那样由真实产蛋记录 + 兽医触诊确认过的个体标签。使用/汇报
        时应说明这一点。

        Args:
            instance_feats: (N, D) 单个包内所有实例(鸡头)的特征。
            threshold: 判定"更接近 normal_cage 原型(索引0)"的概率阈值。

        Returns:
            inst_probs: (N, num_classes) 每个实例对各类别的 softmax 概率。
            is_normal: (N,) bool，每个实例是否被判定为更接近"高产/normal"原型。
            ratio_normal: float，这一包(笼子)内判定为"高产/normal"的实例占比。
        """
        h_n = F.normalize(instance_feats, dim=-1)  # (N, D)
        p_n = F.normalize(self.prototypes, dim=-1)  # (num_classes, D)
        inst_sim = h_n @ p_n.t()  # (N, num_classes)
        inst_logits = inst_sim * self.log_temperature.exp()
        inst_probs = torch.softmax(inst_logits, dim=-1)
        is_normal = inst_probs[:, 0] >= threshold
        ratio_normal = is_normal.float().mean().item() if instance_feats.shape[0] > 0 else float("nan")
        return inst_probs, is_normal, ratio_normal


if __name__ == "__main__":
    torch.manual_seed(0)
    model = ProtoMIL(feat_dim=512, num_classes=2)
    # 模拟用训练集特征初始化原型
    normal_feats = torch.randn(50, 512)
    spent_feats = torch.randn(30, 512)
    model.init_prototypes([normal_feats, spent_feats])

    bag = torch.randn(7, 512)  # 一个笼子里检测到7个鸡头
    logits, attn, z = model(bag)
    print("logits:", logits.shape, logits)
    print("attn sum (should be ~1):", attn.sum().item())
    print("bag feat:", z.shape)

    # 反向传播检查
    label = torch.tensor(1)
    loss = F.cross_entropy(logits.unsqueeze(0), label.unsqueeze(0))
    loss.backward()
    n_grad = sum(1 for p in model.parameters() if p.grad is not None)
    n_total = sum(1 for _ in model.parameters())
    print(f"grad flowed to {n_grad}/{n_total} parameter tensors")
    print("ProtoMIL smoke test PASSED.")
