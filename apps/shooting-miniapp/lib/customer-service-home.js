const { normalizeCustomer } = require('./inquiries')

function hasOutbound(customer) {
  return (customer.timeline || []).some(item => ['seller', 'agent', 'out', 'outbound', 'msg_out', 'msg_out_human'].includes(String(item.actor || item.direction || item.type || '').toLowerCase()))
}

function isHighIntent(customer) {
  const signal = [customer.stage, ...(customer.tags || [])].join(' ').toLowerCase()
  return /(high|hot|qualified|quote|quotation|高意向|报价|成交|采购)/.test(signal)
}

function isConverted(customer) {
  const signal = [customer.stage, ...(customer.tags || [])].join(' ').toLowerCase()
  return /(converted|won|paid|成交|已付款)/.test(signal)
}

function project(rawItems) {
  const customers = (rawItems || []).map(normalizeCustomer)
  const pendingReply = customers.filter(item => item.unread || item.status === 'confirm')
  const pendingFollowup = customers.filter(item => item.status === 'followup' && !item.unread && !isConverted(item))
  const highIntent = customers.filter(isHighIntent)
  return {
    customers,
    pendingReply,
    pendingFollowup,
    highIntent,
    counts: {
      pendingReply: pendingReply.length,
      replied: customers.filter(item => hasOutbound(item.raw)).length,
      pendingFollowup: pendingFollowup.length,
      followedUp: customers.filter(item => hasOutbound(item.raw) && !item.unread).length,
      highIntent: highIntent.length,
      converted: customers.filter(isConverted).length
    }
  }
}

module.exports = { project, isHighIntent, isConverted, hasOutbound }
