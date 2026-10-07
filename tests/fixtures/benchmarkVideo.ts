/** Isolated contract/UI fixture. No real media or model calls. */
export function benchmarkVideoFixture(): Record<string, unknown> {
  return { analysisMode: 'exact', geminiStatus: 'analyzed', analysisQuality: 'video', analysisRunId: 'run-fixture',
    analyzedAt: '2026-10-07T14:00:00Z', gemini: {
      scriptDetails15s: Array.from({ length: 9 }, (_, index) => ({
        time: `${index}-${index + 1}s`, visual: index === 0 || index === 8 ? '销售人员在工厂背景前面向镜头讲话' : index === 7 ? '消费者把护肤品涂在面部展示使用方法' : index === 1 ? '真实工厂生产线运转' : `第 ${index - 1} 个产品瓶身特写`,
        materialType: index === 0 || index === 8 ? 'talking_head' : index === 1 ? 'factory' : index === 7 ? 'consumer_demo' : 'product',
        narrativeRole: index === 0 ? 'hook' : index === 8 ? 'cta' : index === 1 ? 'capability_proof' : index === 7 ? 'effect_proof' : 'product_intro',
        classificationEvidence: index === 0 || index === 8 ? '人物面向镜头有可见讲话动作' : '本镜头可见产品、生产动作或使用过程',
        dialogue: index === 0 ? 'Hello, boss!' : '', confidence: 0.9, needsReview: false,
      })),
      audioTranscript: { text: 'Hello, boss! Custom skincare. Product options.', segments: [
        { start: 0, end: 1, text: 'Hello, boss!', timingPrecision: 'phrase', needsReview: false },
        { start: 1, end: 3, text: 'Do you want to customize your brand?', timingPrecision: 'phrase', needsReview: false },
        { start: 3, end: 9, text: 'Masks, cream, foundation and more.', timingPrecision: 'phrase', needsReview: false },
      ] },
    } };
}

/** Existing lighting reference evidence, trimmed to classification inputs only. */
export function lightingBenchmarkFixture(): Record<string, unknown> {
  const shots = [
    { time: '0-3.4s', visual: '女主播手持黑色麦克风与绿色吊灯，微笑挥手', environment: '展厅', observedPresenterRole: 'sales_presenter', salesPresenterConfirmed: true },
    { time: '3.4-8.48s', visual: '女主播手持绿灯，嘴唇微张似在提问', environment: '展厅', observedPresenterRole: 'sales_presenter', salesPresenterConfirmed: true },
    { time: '8.48-9.33s', visual: '女主播双臂展开，左手持灯，右手指向右侧', environment: '展厅全景，天花板挂满灯具', purpose: '展示产品广度与场景应用能力', observedPresenterRole: 'none', salesPresenterConfirmed: false },
    { time: '9.33-10.28s', visual: '黑衣女工戴白手套操作绿色立式钻床，前景堆叠银色铝制灯罩', environment: '工厂车间', observedPresenterRole: 'background', salesPresenterConfirmed: false },
    { time: '10.28-11.65s', visual: '多名工人在长桌旁分拣银色金属零件', environment: '工厂流水线', observedPresenterRole: 'background', salesPresenterConfirmed: false },
    { time: '11.65-14.26s', visual: '女主播手持绿色复古吊灯，左手竖大拇指', environment: '展厅', observedPresenterRole: 'sales_presenter', salesPresenterConfirmed: true },
  ];
  return { analysisMode: 'exact', geminiStatus: 'needs_review', analysisQuality: 'video_review_required', gemini: { scriptDetails15s: shots } };
}
