import type { ReactNode } from 'react';
import { ArrowLeft, FileText, ShieldCheck, Trash2 } from 'lucide-react';

const SUPPORT_EMAIL = 'support@lingshu.ai';
const UPDATED_AT = '2026年9月27日';

type LegalPageKind = 'privacy' | 'terms' | 'data-deletion';

function PageShell({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-ink px-4 py-6 text-text-primary sm:py-8">
      <div className="mx-auto max-w-4xl">
        <a href="/" className="inline-flex items-center gap-2 rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-text-secondary transition-colors hover:border-border-bright hover:bg-surface-2 hover:text-text-primary">
          <ArrowLeft size={16} />
          返回灵枢 AI
        </a>
        <section className="mt-5 rounded-lg border border-border bg-white p-5 sm:p-6 md:p-8">
          <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-start">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-accent-glow text-accent">{icon}</div>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-accent">LINGSHU AI · LEGAL</p>
              <h1 className="mt-2 text-2xl font-bold text-text-primary md:text-3xl">{title}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">{subtitle}</p>
              <p className="mt-3 text-xs text-text-muted">更新日期：{UPDATED_AT}</p>
            </div>
          </header>
          <article className="mt-6 space-y-7 text-sm leading-7 text-text-secondary">{children}</article>
        </section>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="border-l-2 border-insight pl-3 text-base font-bold text-text-primary">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <PageShell title="隐私政策" subtitle="本政策说明灵枢 AI 在提供企业出海营销、社媒运营、素材生成、客户跟进和第三方平台授权服务时，如何收集、使用、保存、共享和保护用户数据。" icon={<ShieldCheck size={24} />}>
      <Section title="1. 我们收集的信息">
        <p>在您注册、登录或使用灵枢 AI 时，我们可能收集账号信息、企业资料、产品信息、素材库内容、客户线索、订单记录、社媒账号配置、生成的文案/脚本/图片/视频/字幕/配音、操作日志、设备信息和必要的 Cookie 或本地存储数据。</p>
        <p>当您连接 Meta、Facebook、Instagram、WhatsApp、TikTok、YouTube 等第三方平台时，我们只会在您授权范围内读取或处理必要数据，例如账号 ID、主页信息、授权令牌、内容发布状态、互动数据、评论或消息数据。</p>
      </Section>
      <Section title="2. 我们如何使用信息">
        <p>我们使用相关信息用于账号登录、安全验证、权限管理、企业资料管理、AI 内容生成、素材管理、客户回复草稿、订单与运营分析、社媒账号授权、内容发布、服务统计、错误排查和安全审计。</p>
        <p>我们不会出售您的个人信息，也不会将第三方平台数据用于未经授权的广告定向、数据经纪或与用户授权目的无关的用途。</p>
      </Section>
      <Section title="3. Meta 平台数据说明">
        <p>如果您通过 Meta 授权灵枢 AI，我们可能根据您的授权读取 Facebook Page、Instagram 专业账号、WhatsApp Business 账号、帖子、评论、消息、媒体内容和账号表现数据，用于账号连接、内容发布、客户回复、运营分析和数据复盘。</p>
        <p>我们仅在完成您请求的功能所需范围内处理 Meta 平台数据，并遵守 Meta Platform Terms 和相关开发者政策。</p>
      </Section>
      <Section title="4. Google 与 YouTube 数据说明">
        <p>当您通过 Google OAuth 连接 YouTube 频道时，我们可能在授权范围内处理频道标识、频道名称、访问令牌与授权范围，并按您的明确操作上传视频、读取您自己的频道与视频信息，以及在另行获得对应权限后展示评论或分析指标。</p>
        <p>Google 用户数据仅用于产品中清晰可见的用户功能。我们不会出售 Google 用户数据，不会将其用于无关的广告画像，也不会在未经单独、明确同意的情况下将从 Google API 获得的非公开数据用于训练面向其他客户的通用 AI 模型。</p>
        <p lang="en">Lingshu AI&apos;s use and transfer to any other app of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" className="font-semibold text-accent">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
      </Section>
      <Section title="5. TikTok 与抖音数据说明">
        <p>当您通过 TikTok 官方授权流程连接账号时，我们可能在获准范围内处理 open_id、头像、昵称、访问令牌、授权范围，以及您自己的视频信息或平台处理状态。只有在相关能力已获平台批准、产品已启用，并由您确认目标账号、内容和设置后主动提交时，我们才会传送对应内容。</p>
        <p>当前国内抖音主要提供发布包，由用户下载视频、封面和文案后在抖音端自行核对并发布。仅在抖音开放平台批准相应能力、用户完成官方授权且产品明确启用后，我们才会处理必要的抖音账号标识、投稿内容、回执或作品数据。</p>
      </Section>
      <Section title="6. 信息共享">
        <p>我们不会向无关第三方出售或出租您的信息。为提供服务，我们可能与云服务、存储、AI 模型、语音合成、短信、邮件、支付、数据分析或第三方平台接口服务商共享必要数据。我们会要求服务提供商仅按授权目的处理数据，并采取合理安全措施。</p>
        <p>在法律法规、法院命令、监管要求、平台合规要求或保护用户与系统安全所必需的情况下，我们可能披露必要信息。</p>
      </Section>
      <Section title="7. 数据保存与安全">
        <p>我们会在实现服务目的所需期间保存数据，并采取访问控制、权限隔离、日志审计、加密传输、备份和安全监控等措施保护数据安全。</p>
        <p>当您撤销第三方授权后，我们会停止后续访问；核验通过的数据删除请求通常在 30 日内完成或告知进度。活动系统中的数据会被删除、匿名化或解除关联，备份残留会随正常轮换覆盖，通常不超过 90 日。法律法规、争议处理、安全审计或合规证明要求保留的最少记录除外。</p>
      </Section>
      <Section title="8. 您的权利">
        <p>您可以请求访问、更正、补充、删除个人数据，撤销第三方平台授权，注销账号，或获取关于数据处理的说明。您可以在灵枢 AI“渠道连接”中断开账号，也可以在 Meta、Google、TikTok 或其他平台的账号设置中移除灵枢 AI 的应用授权。</p>
      </Section>
      <Section title="9. Cookie 与本地存储">
        <p>我们可能使用 Cookie 或类似技术保持登录状态、保存偏好、提升性能、分析访问行为并保障账号安全。您可以通过浏览器设置管理 Cookie，但部分功能可能因此无法正常使用。</p>
      </Section>
      <Section title="10. 未成年人保护">
        <p>灵枢 AI 主要面向企业用户和商业用户。我们不会主动面向未成年人提供服务，也不会故意收集未成年人的个人信息。如您发现未成年人向我们提供了个人信息，请联系我们删除。</p>
      </Section>
      <Section title="11. 联系我们">
        <p>运营主体：灵小枢（杭州）科技有限公司。注册地址：浙江省杭州市上城区宽桥街道水墩社区水墩北路 1 号产业区 5 幢 207-7 室。</p>
        <p>客服与隐私邮箱：<a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent">{SUPPORT_EMAIL}</a></p>
      </Section>
    </PageShell>
  );
}

function DataDeletionPage() {
  return (
    <PageShell title="用户数据删除说明" subtitle="本页面用于说明用户如何请求删除灵枢 AI 保存的账号数据、业务数据，以及通过 Meta、Google/YouTube、TikTok 等第三方平台授权产生的数据。" icon={<Trash2 size={24} />}>
      <Section title="1. 删除范围">
        <p>您可以请求删除灵枢 AI 中与您账号相关的个人信息、企业资料、第三方平台授权数据、素材、文案、脚本、图片、视频、字幕、配音、客户数据、订单数据、操作记录和其他由您上传或生成的内容。</p>
      </Section>
      <Section title="2. 如何提交删除请求">
        <p>请发送邮件至 <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent">{SUPPORT_EMAIL}</a>，邮件标题建议为“灵枢 AI 数据删除请求”。</p>
        <p>请在邮件中提供：注册邮箱、企业名称、需要删除的数据范围、相关第三方平台账号信息，以及便于我们核验身份的必要说明。</p>
      </Section>
      <Section title="3. 处理流程">
        <p>我们收到请求后，会先进行身份核验。核验通过后，通常会在 30 日内删除、匿名化相关数据或告知进度，并通过邮件告知处理结果。</p>
        <p>如果您的请求涉及 Meta、Google/YouTube、TikTok 或其他平台授权数据，我们会删除灵枢 AI 控制的授权信息、账号关联信息和在授权范围内同步的数据。</p>
      </Section>
      <Section title="4. 无法立即删除的情况">
        <p>如法律法规、监管要求、安全审计、争议处理、平台合规证明或系统备份机制要求保留部分数据，我们可能会在必要期限内保留相关数据，并在不再需要时删除或匿名化。</p>
      </Section>
      <Section title="5. 撤销第三方授权">
        <p>您也可以在灵枢 AI“渠道连接”中断开账号，或直接在 Meta、Google、TikTok 或其他第三方平台的账号设置中移除灵枢 AI 应用授权。撤销授权后，我们将无法继续通过该授权访问相关平台数据，但平台上的既有内容不会自动删除。</p>
      </Section>
      <Section title="6. 联系方式">
        <p>客服邮箱：<a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent">{SUPPORT_EMAIL}</a></p>
      </Section>
    </PageShell>
  );
}

function TermsPage() {
  return (
    <PageShell title="用户协议（服务条款）" subtitle="本协议说明灵枢 AI 网站、企业工作台、AI 辅助能力及第三方平台接入的使用规则。" icon={<FileText size={24} />}>
      <Section title="1. 条款适用与接受">
        <p>灵枢 AI 由灵小枢（杭州）科技有限公司运营。创建账号、登录或使用服务，即表示您已阅读并同意本条款与《隐私政策》。如您代表企业操作，您确认已获得代表该企业的必要授权。</p>
      </Section>
      <Section title="2. 服务范围">
        <p>灵枢 AI 提供内容洞察、AI 辅助创作、企业知识库、内容审核、平台连接、发布准备、客户互动和运营分析等能力。实际可用功能取决于您所购服务、角色权限、配置情况以及第三方平台批准和可用性。</p>
        <p>演示数据和效果说明仅用于展示产品方向，不构成收益、传播效果、销售额或第三方平台审核结果的保证。</p>
      </Section>
      <Section title="3. 账号与授权责任">
        <p>您应保护账号、验证码、API 凭证和企业成员权限，不得连接无权管理的平台账号或资产。灵枢 AI 不要求您提供社媒平台密码；第三方账号应通过平台支持的官方授权流程连接。</p>
      </Section>
      <Section title="4. 内容与人工复核">
        <p>您应在使用或发布前核对 AI 输出、事实陈述、人物授权、商标、版权、音乐、广告合规和行业资质，并确认对上传或发布的素材拥有必要权利。不得利用服务从事欺诈、骚扰、侵权、垃圾信息、规避平台审核或其他违法违规活动。</p>
      </Section>
      <Section title="5. 第三方平台与发布">
        <p>Meta、Facebook、Instagram、WhatsApp、Google、YouTube、TikTok、抖音及其他平台由其各自运营。平台可能调整 API、权限、地区可用性或审核标准，进而影响部分功能。</p>
        <p>在平台能力已获批准并启用时，您应在发布前核对目标账号、内容预览、文案和平台设置并主动确认。平台收到请求后仍可能继续处理或审核，最终状态以平台返回结果为准。撤销授权和数据删除方式见《隐私政策》与《用户数据删除说明》。</p>
      </Section>
      <Section title="6. 数据与知识产权">
        <p>您应确保向服务提供的数据具有合法来源、适当告知和必要授权。您保留对合法提供的客户素材所享有的权利，并授权我们仅在提供、维护和改进约定服务所需范围内处理这些素材。</p>
      </Section>
      <Section title="7. 暂停、终止与责任边界">
        <p>如存在安全风险、严重违反本条款、侵犯他人权利或违反法律与平台规则的情况，我们可在合理范围内暂停或终止相关功能。我们会以合理技能和谨慎提供服务，但不保证不间断运行、特定商业结果或第三方平台持续可用。</p>
      </Section>
      <Section title="8. 联系我们">
        <p>条款、投诉或服务争议请发送至 <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-accent">{SUPPORT_EMAIL}</a>。</p>
      </Section>
    </PageShell>
  );
}

export default function LegalPages({ kind }: { kind: LegalPageKind }) {
  if (kind === 'data-deletion') return <DataDeletionPage />;
  if (kind === 'terms') return <TermsPage />;
  return <PrivacyPage />;
}
