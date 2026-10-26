const fs = require('node:fs')
const vm = require('node:vm')
function loadApi(wx, config = { apiBase: 'http://127.0.0.1:8896', localPreviewOrigin: 'http://127.0.0.1:5191' }) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(__dirname + '/../lib/api.js', 'utf8'), { module, wx, require: id => id === '../config' ? config : { httpFailure: (status, data) => ({ status, message: data.error }) } })
  return module.exports
}
module.exports = { loadApi }
