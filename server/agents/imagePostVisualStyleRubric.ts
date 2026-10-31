/** Shared visual decision rubric for both image-post analyzers. This classifies the reference image, not production readiness. */
export const IMAGE_POST_VISUAL_STYLE_RUBRIC = `逐图判别 style 时，先完成 observedFacts，再只依据该图可见的主体、场景、构图和拍摄方式作判断。caption、标题、热度、产品是否出现、是否需要实拍，均不能代替风格判断。
判断顺序：
1. 看画面的主要任务。若包装产品是唯一视觉主角，置于刻意搭建的展示台、几何色块、合成布景或品牌海报中，画面以突出商品为目的，判 advertising；没有广告文案也一样。
2. 若画面主要呈现可迁移的观察方式或叙事，例如真实场景中的自然陈列、手持/使用过程、质地微距、工艺步骤、人物互动或纪实构图，判 imitable。产品即使可见，也不能只因其出现就改判 advertising。只模仿视觉语言，不复制竞品身份或未证实的场景事实。
3. 产品与原料平铺、精心布置的产品近景等同时带有两类特征时，比较视觉主角：若不能明确区分“商品主视觉”和“过程/质地/叙事”，判 unknown，不强行二选一。
对照样例（只用于理解边界，不得把样例当作当前图片的观察事实）：
- 白色乳霜纹理填满画面、没有包装产品：imitable；可借鉴质地和光泽，但 productPresence 应独立判断。
- 滴管把液体注入容器的操作近景：imitable；可借鉴动作、尺度和重复容器节奏。
- 产品瓶居中放在蓝色圆台和几何背景前：advertising；这是搭建的商品主视觉，不因没有 CTA 而改变。
- 产品样品自然摆在展会桌面，背景能看到真实现场：imitable；若真实场景不可由现有素材支持，kind 仍可为 shoot_required。
- 产品瓶与植物、果实精心平铺，既像商品主视觉又像原料叙事：证据不足时 unknown。
style.evidence 必须写出该图真实可见的主体、场景或构图依据，并说明为何属于该类；不要复述标题或套用样例。elements 只选实际可见的光线、明暗、构图和层次。看不清或两类信号冲突时用 unknown、低置信度并写入 uncertainties，不虚构高分。productPresence 与 kind 分别独立判断，不能让它们反推 style。`;
