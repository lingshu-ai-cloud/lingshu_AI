export const PERSON_CONSENT_VERSION = 'lingshu-person-consent-v1';
export const PERSON_CONSENT_MAX_BYTES = 20 * 1024 * 1024;
export const PERSON_CONSENT_STATEMENT = '我是母片中的出镜本人。我自愿授权本企业通过灵枢创建和使用我的数字形象与声音，用于已获授权的内容制作和商业传播。我知道视频会交给受托技术服务处理。我会保持自然、自信和充沛的表达，让系统了解我的声音、表情与动作。';
export const PERSON_CONSENT_NOTICE = '请由母片中的同一位本人完成录制，单人正脸、无遮挡、清晰说出授权内容。灵枢会将母片和授权视频提交给受托数字人服务商 HeyGen 进行身份匹配、授权审核和人物准备；此操作可能产生处理费用。授权视频不进入普通素材库。灵枢保留授权版本、文件摘要、提交账户和时间用于审计，服务商按其协议处理视频。请勿使用他人代录、合成声音或生成视频。';

export interface PersonOnboardingCapability {
  available: boolean;
  reason?: string;
  consentVersion: string;
  statement: string;
  notice: string;
  maxVideoBytes: number;
}
