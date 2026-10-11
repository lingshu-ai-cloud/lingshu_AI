const { options, buildPayload } = require('../../lib/action-form')
const statusLabels = { accepted:'已接收', queued:'排队中', running:'执行中', waiting_user:'需要补充决定', succeeded:'已完成', failed:'执行失败' }
module.exports = {statusLabels,options,buildPayload}
