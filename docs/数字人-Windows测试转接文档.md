# 数字人 Windows 测试转接文档

更新时间：2026-08-17
测试目标：在同一台 Windows NVIDIA GPU 电脑上，使用同一组人物和中文音频，依次测试 MuseTalk 1.5、LatentSync 1.6、EchoMimic V2 的生成质量，为灵枢生产方案选型。

## 1. 项目背景

### 1.1 灵枢是什么

灵枢 AI 工作台是一套面向外贸企业和海外社媒运营团队的智能业务系统。当前工作台主要包含：

- **社媒运营**：灵感大屏、脚本库、智能素材、账号管理。
- **客户管理**：客户会话、订单管理。
- **智能体管理**：企业知识库、智能体记忆、定时任务。
- **系统与管理员能力**：集成中心、组织与权限、账号总控、客户运维。

现有社媒内容流程大致为：

```text
灵感内容/企业资料
        ↓
脚本生成与人工确认
        ↓
AI智能素材/本地素材混剪
        ↓
字幕、配音、封面和成片确认
        ↓
一键发布或定时发布
```

目前系统已经具备脚本、素材和发布流程，但缺少“人物面对镜头讲解产品或方案”的数字人口播能力。数字人口播将作为智能素材的一种新增内容形态，而不是独立替代现有的视频生成和混剪功能。

### 1.2 为什么增加数字人口播

外贸企业在海外社媒运营中经常需要稳定生产以下内容：

- 产品介绍、功能讲解和使用方法。
- 工厂、供应能力、认证和交付能力说明。
- 行业知识、采购建议和常见问题解答。
- 多语言市场版本和不同平台比例版本。
- 同一人物形象持续输出的账号栏目内容。

如果每条视频都重新安排真人拍摄，时间和组织成本较高。计划中的数字人口播能力允许运营人员确认脚本后，选择已授权的数字人形象和声音，生成可继续编辑、加字幕并进入一键发布的口播视频。

### 1.3 计划中的产品入口

第一阶段拟放在：

```text
社媒运营
└── 智能素材
    ├── AI智能素材
    ├── 数字人口播（计划新增）
    └── 一键发布
```

预期使用流程：

```text
选择/生成口播脚本
        ↓
选择数字人模板或上传授权人物素材
        ↓
选择系统音色或上传已授权口播音频
        ↓
生成数字人口播视频
        ↓
字幕、背景、产品画面与封面编辑
        ↓
保存到素材库并进入一键发布
```

### 1.4 技术和成本原则

项目希望优先采用可本地部署的开源模型，避免按条向第三方数字人平台支付API费用。目标不是“完全没有成本”，而是：

- 模型和接口不产生第三方按次调用费。
- 客户人物、声音和生成素材由己方系统控制。
- GPU根据任务量按需扩容，闲时可以停止。
- 成品及业务素材继续保存到腾讯云对象存储。
- 正式生产时，Web/API与GPU推理服务相互隔离。

当前新加坡业务服务器只有2核CPU、约3.3GB内存、无NVIDIA GPU，不能承担数字人推理。未来正式架构计划由现有服务器负责任务、权限和存储流程，另设GPU Worker负责模型推理。

```text
灵枢 Web/API（新加坡业务服务器）
                 ↓
          数字人任务队列
                 ↓
       独立 NVIDIA GPU Worker
      ├── MuseTalk
      ├── LatentSync
      └── EchoMimic V2
                 ↓
          腾讯云对象存储
```

### 1.5 为什么测试三个模型

三个候选模型对应不同的产品档位：

- **MuseTalk 1.5**：候选默认快速版。重点考察速度、稳定性和批量生产能力。
- **LatentSync 1.6**：候选高清口型版。重点考察中文嘴型、口腔细节和人脸清晰度是否值得更高GPU成本。
- **EchoMimic V2**：候选照片数字人版。重点考察只提供单张半身照时，动作自然度和身份一致性是否达到产品要求。

最终不一定只保留一个模型。可能的生产结果是MuseTalk作为默认生成方式，LatentSync作为高清选项，EchoMimic V2作为独立的照片数字人高级功能。本轮Windows测试结果将决定：

1. 哪些模型进入下一阶段API封装。
2. 产品是否需要同时保留快速版和高清版。
3. 是否值得为照片数字人准备48GB GPU资源。
4. 每种模式的合理等待时间、额度和客户定价。

### 1.6 本轮测试边界

本轮只做单机离线质量验证，不做以下工作：

- 不连接正式客户数据库或腾讯云生产数据。
- 不接入当前灵枢前端、账号体系或订单系统。
- 不开放公网服务。
- 不训练或微调模型。
- 不测试多人并发和正式生产容量。
- 不使用未经授权的人脸、声音或客户素材。

测试通过后，才进入“统一推理API、异步任务队列、OSS上传、额度计费和前端页面”的产品开发阶段。

## 2. 本轮测试结论要回答什么

本轮不是训练模型，也不是接入灵枢正式系统，只回答以下问题：

1. 哪个模型的中文嘴型最准确？
2. 哪个模型的人脸最清晰、抖动最少？
3. 哪个模型生成速度和显存成本最低？
4. 哪个模型适合已有数字人视频，哪个适合单张照片？
5. 连续生成三次是否稳定，是否出现崩溃或显存溢出？

候选模型：

| 优先级 | 模型 | 主要用途 | 官方地址 |
|---|---|---|---|
| 1 | MuseTalk 1.5 | 已有数字人视频更换口播，候选默认快速版 | https://github.com/TMElyralab/MuseTalk |
| 2 | LatentSync 1.6 | 已有视频高清口型同步，候选高清版 | https://github.com/bytedance/LatentSync |
| 3 | EchoMimic V2 | 单张照片生成半身口播，候选照片数字人版 | https://github.com/antgroup/echomimic_v2 |

> 不要把三个模型的结果简单理解为同一种能力的排名。MuseTalk 和 LatentSync 修改已有视频；EchoMimic V2 会从单张图片生成包含半身动作的新视频。

## 3. 硬件准入要求

开始前先确认电脑满足：

- Windows 11，或 Windows 10 21H2 以上。
- NVIDIA 显卡，不支持只使用 AMD/Intel 核显完成本轮测试。
- 推荐显存 24GB；最低建议 18GB。
- 内存 32GB以上，推荐64GB。
- 固态硬盘至少预留150GB，推荐200GB。
- 网络能够访问 GitHub 和 Hugging Face。

显存影响：

- 4–8GB：只能优先尝试 MuseTalk，LatentSync 1.6和EchoMimic V2不进入正式对比。
- 12–16GB：可尝试 MuseTalk、LatentSync 1.5；LatentSync 1.6官方最低需要18GB。
- 18–24GB：可以依次测试全部三个模型，但不要同时运行。
- 48GB：可以更从容地测试，但本轮仍要求串行运行，保证指标可比。

## 4. Windows 基础环境

本转接统一使用 **WSL2 + Ubuntu 22.04**。不要为三个项目分别折腾原生 Windows CUDA 环境。

### 4.1 安装或更新 NVIDIA 驱动

在 Windows 安装支持 WSL CUDA 的最新稳定版 NVIDIA 驱动。安装完成后重启电脑，在 PowerShell 执行：

```powershell
nvidia-smi
```

需要看到显卡名称、驱动版本和显存容量。

### 4.2 安装 WSL2

以管理员身份打开 PowerShell：

```powershell
wsl --install -d Ubuntu-22.04
wsl --update
wsl --set-default-version 2
```

重启电脑，打开 Ubuntu，创建 Linux 用户。进入 Ubuntu 后再次执行：

```bash
nvidia-smi
```

如果 WSL 内看不到显卡，停止后续安装，先修复驱动或 WSL GPU 映射。

### 4.3 安装通用工具

在 Ubuntu 22.04 中执行：

```bash
sudo apt update
sudo apt install -y git git-lfs ffmpeg build-essential wget curl
git lfs install
```

安装 Miniconda 后重新打开终端，并确认：

```bash
conda --version
ffmpeg -version
git lfs version
```

## 5. 创建统一测试工作区

工作区必须创建在 WSL Linux 文件系统中。不要放在 `/mnt/c`，否则大量小文件读取会明显变慢。

```bash
mkdir -p ~/digital-human-lab/{inputs,outputs,logs,repos}
mkdir -p ~/digital-human-lab/outputs/{musetalk,latentsync,echomimic-v2}
```

最终目录：

```text
~/digital-human-lab/
├── inputs/
│   ├── avatar.mp4
│   ├── avatar.jpg
│   └── voice.wav
├── outputs/
│   ├── musetalk/
│   ├── latentsync/
│   └── echomimic-v2/
├── logs/
└── repos/
```

## 6. 统一测试素材

必须使用已获得肖像和声音授权的素材，禁止使用客户真实数据或未经许可的公众人物。

准备以下三份文件：

- `avatar.mp4`：20–30秒，正面或轻微侧脸，人物不遮挡嘴部，画面稳定。
- `avatar.jpg`：正面半身照，脸部清晰，建议不低于768×768。
- `voice.wav`：20–30秒中文口播，单人、无背景音乐、无混响。

建议统一测试文案：

> 大家好，今天为大家介绍我们的智能内容解决方案。它可以根据产品资料生成脚本、素材和发布计划，帮助团队更高效地开展海外社媒运营。如果你希望了解详细功能，欢迎随时联系我们。

将原始视频和音频复制到 `inputs` 后进行标准化：

```bash
cd ~/digital-human-lab

ffmpeg -y -i inputs/avatar.mp4 \
  -vf "fps=25,scale=1280:-2" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p -an \
  inputs/avatar-25fps.mp4

ffmpeg -y -i inputs/voice.wav \
  -ac 1 -ar 16000 -c:a pcm_s16le \
  inputs/voice-16k.wav
```

三个项目统一使用标准化后的文件。除非模型明确要求其他格式，不要为某个模型单独美化素材。

## 7. 测试一：MuseTalk 1.5

### 7.1 安装

```bash
cd ~/digital-human-lab/repos
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk

conda create -n musetalk python=3.10 -y
conda activate musetalk

pip install torch==2.0.1 torchvision==0.15.2 torchaudio==2.0.2 \
  --index-url https://download.pytorch.org/whl/cu118
pip install -r requirements.txt
pip install --no-cache-dir -U openmim
mim install mmengine
mim install "mmcv==2.0.1"
mim install "mmdet==3.1.0"
mim install "mmpose==1.1.0"
```

下载权重：

```bash
sh ./download_weights.sh
```

检查 `models/musetalkV15/unet.pth` 是否存在。

### 7.2 配置输入

复制官方配置，避免修改仓库原始示例：

```bash
cp configs/inference/test.yaml configs/inference/lingshu-test.yaml
```

打开 `configs/inference/lingshu-test.yaml`，将测试任务中的路径指向：

```text
/home/<你的WSL用户名>/digital-human-lab/inputs/avatar-25fps.mp4
/home/<你的WSL用户名>/digital-human-lab/inputs/voice-16k.wav
```

### 7.3 推理

先记录显存：

```bash
nvidia-smi | tee ~/digital-human-lab/logs/musetalk-before.txt
```

运行：

```bash
/usr/bin/time -v python -m scripts.inference \
  --inference_config configs/inference/lingshu-test.yaml \
  --result_dir ~/digital-human-lab/outputs/musetalk \
  --unet_model_path models/musetalkV15/unet.pth \
  --unet_config models/musetalkV15/musetalk.json \
  --version v15 \
  --ffmpeg_path /usr/bin \
  2>&1 | tee ~/digital-human-lab/logs/musetalk-run.txt
```

如果显存不足，优先尝试官方 Gradio 的 `--use_float16` 模式；不要修改共同输入素材来掩盖显存问题。

## 8. 测试二：LatentSync 1.6

LatentSync 1.6官方标注推理最低需要18GB显存。显存不足时记录“不满足1.6硬件条件”，可额外测试1.5，但结果必须单独标注版本。

### 8.1 安装

```bash
conda deactivate
cd ~/digital-human-lab/repos
git clone https://github.com/bytedance/LatentSync.git
cd LatentSync

bash setup_env.sh
```

按照脚本提示激活其环境。安装后检查：

```bash
python -c "import torch; print(torch.__version__); print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0))"
```

确认 `torch.cuda.is_available()` 为 `True`。

### 8.2 下载1.6权重

如果安装脚本没有完整下载权重，按照官方README从 `ByteDance/LatentSync-1.6` 下载。至少检查：

```text
checkpoints/latentsync_unet.pt
checkpoints/whisper/tiny.pt
```

### 8.3 推理

最稳妥的首次测试方式是启动官方界面：

```bash
python gradio_app.py
```

在界面上传：

- 视频：`avatar-25fps.mp4`
- 音频：`voice-16k.wav`
- `inference_steps`：先使用20
- `guidance_scale`：先使用1.5

将结果保存到 `outputs/latentsync`，同时记录生成时间和峰值显存。第一轮成功后，再分别测试：

- 20步 / guidance 1.5
- 30步 / guidance 1.5
- 30步 / guidance 2.0

不要一开始就使用50步，否则生成时间不可控。

## 9. 测试三：EchoMimic V2

EchoMimic V2使用单张图片和音频生成半身人物动画。官方测试环境包括16GB V100和24GB RTX 4090D，推荐24GB显存。

### 9.1 安装

```bash
conda deactivate
cd ~/digital-human-lab/repos
git clone https://github.com/antgroup/echomimic_v2.git
cd echomimic_v2
```

优先使用官方自动安装：

```bash
sh linux_setup.sh
```

如果自动安装失败，再按照官方README执行Python 3.10、PyTorch 2.5.1和CUDA 12.4的手动安装步骤，不要混用MuseTalk或LatentSync的conda环境。

下载权重：

```bash
git clone https://huggingface.co/BadToBest/EchoMimicV2 pretrained_weights
```

### 9.2 首次推理

先启动官方界面验证环境：

```bash
python app.py
```

上传：

- 图片：`avatar.jpg`
- 音频：`voice-16k.wav`

首次测试成功后，再使用加速推理配置：

```bash
python infer_acc.py --config='./configs/prompts/infer_acc.yaml'
```

修改配置时只替换图片、音频和输出路径，保留官方默认参数。结果统一复制到 `outputs/echomimic-v2`。

## 10. 三次稳定性测试

每个模型第一次成功后，用完全相同参数连续生成3次：

1. 第一次：冷启动，记录模型加载时间和总时间。
2. 第二次：热启动，记录总时间。
3. 第三次：热启动，确认是否显存持续增长或崩溃。

运行期间另开一个WSL终端：

```bash
watch -n 1 nvidia-smi
```

记录峰值显存，不要只记录任务结束后的显存。

## 11. 统一评分表

每项1–5分，5分最好。生成时间和显存填写实测数值。

| 指标 | MuseTalk 1.5 | LatentSync 1.6 | EchoMimic V2 |
|---|---:|---:|---:|
| 中文嘴型准确度 |  |  |  |
| 人脸清晰度 |  |  |  |
| 牙齿/口腔自然度 |  |  |  |
| 头部和身体自然度 |  |  |  |
| 身份一致性 |  |  |  |
| 画面抖动控制 |  |  |  |
| 30秒视频冷启动总时间 |  |  |  |
| 30秒视频热启动总时间 |  |  |  |
| 峰值显存 |  |  |  |
| 连续3次成功数量 |  |  |  |
| 安装难度 |  |  |  |
| 综合主观评分 |  |  |  |

另需记录：

- Windows版本
- GPU型号及显存
- NVIDIA驱动版本
- WSL版本
- 每个仓库的Git commit ID
- 是否修改官方代码或参数

获取版本信息：

```bash
wsl.exe --version 2>/dev/null || true
nvidia-smi
cd ~/digital-human-lab/repos/MuseTalk && git rev-parse HEAD
cd ~/digital-human-lab/repos/LatentSync && git rev-parse HEAD
cd ~/digital-human-lab/repos/echomimic_v2 && git rev-parse HEAD
```

## 12. 常见问题处理顺序

### WSL中 `nvidia-smi` 不可用

先更新Windows NVIDIA驱动和WSL，不要在WSL内安装Linux显示驱动。WSL只安装模型需要的CUDA运行库。

### `CUDA out of memory`

1. 关闭另外两个模型和所有Python进程。
2. 用 `nvidia-smi` 查找残留进程。
3. 优先降低模型官方推理参数中的分辨率、步数或启用FP16。
4. 不要将虚拟内存误认为GPU显存；增加Windows分页文件不能解决CUDA显存不足。

### Hugging Face下载中断

不要删除已下载目录，使用Git LFS或官方CLI续传。检查大文件是否实际下载完成，只有几KB的权重通常是LFS指针文件。

### FFmpeg找不到

```bash
which ffmpeg
ffmpeg -version
```

WSL路径使用 `/usr/bin/ffmpeg` 或 `/usr/bin`，不要填Windows盘符路径。

### WSL突然占满系统盘

三个模型不要同时下载。每完成一个模型先确认剩余空间：

```bash
df -h ~
du -sh ~/digital-human-lab/repos/*
```

磁盘不足时先导出结果和日志，再删除不用的conda缓存：

```bash
conda clean --all
```

执行前确认提示，不要删除正在使用的模型目录。

## 13. 测试完成后的交付物

将以下内容整理为一个文件夹交回：

```text
digital-human-test-results/
├── machine-info.txt
├── score-table.md
├── logs/
├── musetalk-result.mp4
├── latentsync-result.mp4
└── echomimic-v2-result.mp4
```

同时说明：

1. 最喜欢哪个结果以及原因。
2. 哪些瑕疵无法接受。
3. 可以接受的单条等待时间。
4. 是否需要单张照片生成，还是已有模板视频换口播就足够。

## 14. 安全要求

- 只使用已授权的内部测试人物和声音。
- 不上传客户数据库、客户头像或客户语音。
- 不使用未经许可的名人素材。
- 不把带声音克隆能力的Gradio端口开放到公网。
- 测试完成后清理临时上传文件；需要保留的结果进入受控文件夹。
- 所有输出必须标记为AI生成测试内容，不得直接对外发布。
