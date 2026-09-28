import assert from 'node:assert/strict';
import { recognizePresenterShot, isSalesPresenterLabel, salesPresenterRecognition, confirmedSalesPresenterRoute } from './presenterShotRecognition';
assert.equal(recognizePresenterShot({detail: '画面：戴眼镜女讲师穿浅蓝西装，双手展开，身后陈列各类瓶罐产品；近景特写，固定镜头\n口播：Repeat order rate.'}), 'presenter');
assert.equal(recognizePresenterShot({detail: '画面：销售正面说话，背景工人在生产线上灌装\n口播：Hello'}), 'presenter');
assert.equal(recognizePresenterShot({detail: '画面：工厂工人背影，产品灌装\n口播：Hello'}), 'material');
assert.equal(recognizePresenterShot({detail: '画面：产品瓶身\n口播：Hello'}), 'material');
assert.equal(recognizePresenterShot({detail: '画面：销售正面说话\n口播：Hello', observedPresenterRole: 'unknown'}), 'material');
console.log('Legacy reference presenter recognition passed');

assert.equal(salesPresenterRecognition({ detail: '画面：女性靠近镜头，敲门 镜头功能：d_to_c 口播：Hello' }), 'candidate');
assert.equal(salesPresenterRecognition({ detail: '画面：女性正面说话 口播：Hello' }), 'candidate');
assert.equal(confirmedSalesPresenterRoute({ detail: '画面：女性正面说话 口播：Hello' }), 'material');
assert.equal(salesPresenterRecognition({ observedPresenterRole: 'sales_presenter' }), 'candidate');
assert.equal(salesPresenterRecognition({ observedPresenterRole: 'sales_presenter', personContinuityId: 'main-sales' }), 'confirmed');
assert.equal(salesPresenterRecognition({ observedPresenterRole: 'sales_presenter', personContinuityId: 'main-sales', salesPresenterConfirmed: false }), 'other');
assert.equal(salesPresenterRecognition({ observedPresenterRole: 'sales_presenter', personContinuityId: 'main-sales', needsReview: true }), 'candidate');

assert.equal(isSalesPresenterLabel({ observedPresenterRole: 'sales_presenter' }), true);
assert.equal(salesPresenterRecognition({ observedPresenterRole: 'sales_presenter' }), 'candidate');
assert.equal(isSalesPresenterLabel({ observedPresenterRole: 'background', detail: '销售人员口播' }), false);
assert.equal(isSalesPresenterLabel({ detail: '画面：路人面对镜头，D to C' }), false);
assert.equal(isSalesPresenterLabel({ observedPresenterRole: 'sales_presenter', needsReview: true }), false);
