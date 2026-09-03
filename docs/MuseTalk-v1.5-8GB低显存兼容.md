# MuseTalk v1.5 8GB 低显存兼容准备

## 适用边界

本项目在 RTX 5060 8GB 上使用 MuseTalk v1.5。固定 checkout 为：

- Git commit：`0a89dec45a0192b824e3cf4daf96c239440c5ed8`
- 目标文件：`musetalk/models/unet.py`
- 上游文件 SHA-256：`05d5dadfde2e726b61d8387a4876336d4dcacc696636e8dcfec69863ce819256`
- 兼容后文件 SHA-256：`e245234f6620194deedc84a752b4da7fc21ddd4932d87f4137069bf35cdeb934`

该版本原实现可能把带 CUDA storage tag 的约 3.4GB state dict 直接还原到显存，然后再把 fp16 UNet 迁移到 GPU，造成 8GB 显卡在模型初始化阶段 OOM。兼容步骤固定改为 `torch.load(..., map_location="cpu")`，在 `load_state_dict` 后立即 `del weights`，再迁移模型。

## 自动准备与失败策略

`scripts/run-musetalk.ps1` 每次推理前执行：

```text
python3 scripts/prepare-musetalk-low-vram.py --repo <MuseTalk checkout>
```

准备脚本同时校验 checkout 根目录、精确 commit、Git 文件模式、目标路径、文件 SHA-256 和唯一源码模式。只接受上述原始状态或上述已兼容状态；第一次原子改写，后续运行返回 `already_prepared`。未知版本、人工改动、模式不匹配或写后校验失败都会中止推理，不会尝试模糊替换或继续占用 GPU。

启动脚本还在 WSL 推理进程内固定设置：

```text
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
```

该设置用于降低可扩展 CUDA 分配场景中的碎片风险，不代替显存水位、任务串行和 OOM 门禁。

## 检查与测试

只检查当前 MuseTalk checkout 是否已经处于兼容状态：

```powershell
wsl.exe -d Ubuntu-22.04 -u root -- python3 /mnt/d/LINGSHU_逐分镜数字人开发/scripts/prepare-musetalk-low-vram.py --repo /root/digital-human-lab/repos/MuseTalk --check
```

运行最小回归：

```powershell
python scripts/prepare-musetalk-low-vram.test.py
```

升级 MuseTalk 时必须先重新审核上游 `unet.py` 和 checkpoint 加载行为，再显式更新 commit、两个 SHA-256、源码模式和测试。不得为了兼容未知版本而放宽校验。
