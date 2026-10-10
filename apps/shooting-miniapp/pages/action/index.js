const api = require('../../lib/api')
const model = require('./model')
Page({
  data:{loading:true,submitting:false,error:'',detail:null,options:[],fields:{},receipt:null,receiptLabel:''},
  onLoad(query) { this.matterId = decodeURIComponent(query.matterId || ''); this.scope = api.token(); this.accountKey = ''; this.refresh() },
  onShow() { if(this.data.detail) { if(this.data.receipt && !['succeeded','failed'].includes(this.data.receipt.status))this.pollReceipt();else this.refresh() } },
  onHide() { this.stopPolling() },
  onUnload() { this.disposed = true; this.stopPolling() },
  validSession() { return !this.disposed && api.token() === this.scope },
  async refresh() {
    this.setData({loading:true,error:''})
    try {
      const identity = await api.me()
      if(!this.validSession()) return
      const user=identity.user || identity
      this.accountKey=String(user.tenantId || user.tenant_id || '')+':'+String(user.id || user.email || '')
      if(!user.id && !user.email)throw Error('无法核验当前账号')
      const response = await api.request('mobile-workbench/matters/' + encodeURIComponent(this.matterId))
      if(!this.validSession()) return
      const detail = response.matter || response.detail
      if(!detail || !detail.subjectVersion) throw Error('服务未返回有效事项版本，请刷新工作台')
      detail.failedScenes=(detail.failedScenes || []).map(scene=>{const materialOptions=(scene.materialOptions || scene.eligibleMaterialOptions || []).map(item=>({...item,id:item.id || item.materialId}));return {...scene,reason:scene.reason || (scene.problems || []).map(problem=>problem.message || problem.code).join('、'),materialOptions,materialLabels:['由 Agent 自动匹配',...materialOptions.map(item=>item.title || item.label || item.id)],materialSelection:0}})
      const fields = {replacements:[],sceneIds:(detail.failedScenes || []).filter(s=>s.status !== 'passed').map(s=>String(s.id))}
      this.setData({detail,options:model.options(detail),fields})
      const stored = wx.getStorageSync(this.pendingKey())
      if(stored?.receiptId) { this.receiptId = stored.receiptId; this.pollReceipt() }
    } catch(error) { if(this.validSession()) this.setData({error:error.message}) }
    finally { if(this.validSession()) this.setData({loading:false}) }
  },
  pendingKey() { return 'mobile-action-pending:' + this.accountKey + ':' + this.matterId },
  inputField(event) { this.setData({['fields.' + event.currentTarget.dataset.key]:event.detail.value}) },
  selectScenes(event) { this.setData({'fields.sceneIds':event.detail.value}) },
  selectReplacement(event) {
    const id=event.currentTarget.dataset.id,index=Number(event.detail.value)
    const scenes=this.data.detail.failedScenes.map(scene=>scene.id===id?{...scene,materialSelection:index}:scene)
    const replacements=scenes.filter(scene=>scene.materialSelection>0).map(scene=>({sceneId:scene.id,materialId:scene.materialOptions[scene.materialSelection-1].id,trimStart:Number(scene.materialOptions[scene.materialSelection-1].trimStart || 0)}))
    this.setData({'detail.failedScenes':scenes,'fields.replacements':replacements})
  },
  chooseMaterial(event) { this.setData({'fields.materialId':event.currentTarget.dataset.id,'fields.materialIds':[event.currentTarget.dataset.id]}) },
  async submit(event) {
    if(this.data.submitting) return
    const option = this.data.options.find(o=>o.id===event.currentTarget.dataset.id)
    if(!option || option.disabled) return
    let payload
    try {
      payload = model.buildPayload(option,this.data.fields)
      if(option.kind==='scoped_repair') {
        const eligible=option.payload.sceneIds || []
        payload.sceneIds=(this.data.fields.sceneIds || []).filter(id=>eligible.includes(id))
        if(!payload.sceneIds.length)throw Error('请选择该问题类型对应的失败分镜')
        const replacements=(this.data.fields.replacements || []).filter(item=>payload.sceneIds.includes(item.sceneId))
        if(option.requiresMaterialSelection && replacements.length!==payload.sceneIds.length)throw Error('自动修复已耗尽，请为每个选中分镜选择替代素材')
        if(replacements.length) {
          if(replacements.length!==payload.sceneIds.length)throw Error('请为所有选中分镜选择替代素材，或全部使用自动匹配')
          payload.replacements=replacements
        }
      }
    } catch(error) { this.setData({error:error.message}); return }
    const confirmation = await new Promise(resolve=>wx.showModal({title:option.label,content:option.confirmation || this.data.detail.blockingImpact || '确认提交此决定？',confirmText:'确认提交',success:r=>resolve(r.confirm),fail:()=>resolve(false)}))
    if(!confirmation || !this.validSession()) return
    this.setData({submitting:true,error:''})
    try {
      const action = {kind:option.kind,targetId:option.targetId || this.data.detail.source?.entityId || this.matterId,expectedVersion:String(this.data.detail.subjectVersion),payload}
      const signature = JSON.stringify(action)
      const previous = wx.getStorageSync(this.pendingKey())
      const idempotencyKey = previous?.signature===signature ? previous.idempotencyKey : 'mobile-action-'+Date.now()+'-'+Math.random().toString(36).slice(2)
      wx.setStorageSync(this.pendingKey(),{signature,idempotencyKey})
      const response = await api.request('mobile-workbench/actions','POST',{...action,idempotencyKey})
      if(!this.validSession()) return
      if(!response.receipt?.id) throw Error('未收到操作回执，请保留页面后重试')
      this.receiptId=response.receipt.id
      wx.setStorageSync(this.pendingKey(),{signature,idempotencyKey,receiptId:this.receiptId})
      this.displayReceipt(response.receipt)
      this.pollReceipt()
    } catch(error) { if(this.validSession())this.setData({error:error.message}) }
    finally { if(this.validSession())this.setData({submitting:false}) }
  },
  displayReceipt(receipt) {
    this.setData({receipt,receiptLabel:model.statusLabels[receipt.status] || '等待状态更新'})
    if(['succeeded','failed'].includes(receipt.status))this.stopPolling()
  },
  stopPolling() { if(this.timer)clearTimeout(this.timer);this.timer=null },
  async pollReceipt() {
    this.stopPolling()
    if(!this.receiptId || !this.validSession())return
    try { const response=await api.request('mobile-workbench/actions/'+encodeURIComponent(this.receiptId));if(!this.validSession())return;this.displayReceipt(response.receipt) }
    catch(error) { if(this.validSession())this.setData({error:'结果暂未同步：'+error.message}) }
    if(this.validSession() && !['succeeded','failed'].includes(this.data.receipt?.status))this.timer=setTimeout(()=>this.pollReceipt(),3000)
  },
  copy(event) { const value=String(event.currentTarget.dataset.value || '');if(value)wx.setClipboardData({data:value}) },
  async openConnection() {
    const connection=this.data.detail?.connection
    try {
      let url=connection?.authorizationUrl
      if(!url && connection?.startRoute) {
        const route=connection.startRoute.replace(/^\/api\/overseas\//,'')
        if(!/^social\/oauth\/(tiktok|facebook|instagram)\/start$/.test(route))throw Error('授权入口不受支持')
        const response=await api.request(route,'POST',{})
        url=response.url
      }
      if(!this.validSession())return
      if(!/^https:\/\//.test(url || ''))throw Error('平台未返回有效授权地址')
      wx.navigateTo({url:'/pages/action/connect?url='+encodeURIComponent(url)})
    }catch(error){if(this.validSession())this.setData({error:error.message})}
  },
  openShooting() { const taskId=this.data.detail?.materials?.shootingTaskId;if(taskId)wx.navigateTo({url:'/pages/index/index?taskId='+encodeURIComponent(taskId)}) },
  async downloadAsset(event) {
    const asset=(this.data.detail?.external?.assets || []).find(item=>item.contentHash===event.currentTarget.dataset.id)
    if(!asset || !/^https:\/\//.test(asset.downloadUrl || '')) {this.setData({error:'素材下载地址无效'});return}
    this.setData({submitting:true,error:''})
    try {
      const {apiBase}=require('../../config')
      const isOwn=asset.downloadUrl.startsWith(String(apiBase).replace(/\/$/,'')+'/')
      const bytes=await new Promise((resolve,reject)=>wx.request({url:asset.downloadUrl,method:'GET',responseType:'arraybuffer',timeout:120000,header:isOwn?{Authorization:'Bearer '+api.token()}:{},success:r=>r.statusCode===200?resolve(r.data):reject(Error('素材下载失败')),fail:e=>reject(Error(e.errMsg || '素材下载失败'))}))
      if(!this.validSession())return
      if(!bytes?.byteLength || bytes.byteLength>100*1024*1024)throw Error('素材为空或超过100MB，请在电脑端下载')
      const fileName=String(asset.fileName || 'publication.mp4').replace(/[^A-Za-z0-9._-]/g,'_')
      const filePath=wx.env.USER_DATA_PATH+'/publication-'+Date.now()+'-'+fileName
      await new Promise((resolve,reject)=>wx.getFileSystemManager().writeFile({filePath,data:bytes,success:resolve,fail:e=>reject(Error(e.errMsg))}))
      if(!this.validSession())return
      if(asset.kind==='video')await new Promise((resolve,reject)=>wx.saveVideoToPhotosAlbum({filePath,success:resolve,fail:e=>reject(Error(e.errMsg || '保存失败，请检查相册权限'))}))
      else if(['image','cover'].includes(asset.kind))await new Promise((resolve,reject)=>wx.saveImageToPhotosAlbum({filePath,success:resolve,fail:e=>reject(Error(e.errMsg || '保存失败，请检查相册权限'))}))
      else await new Promise((resolve,reject)=>wx.openDocument({filePath,showMenu:true,success:resolve,fail:e=>reject(Error(e.errMsg || '文件格式无法在微信打开'))}))
      wx.showToast({title:'素材已保存',icon:'success'})
    }catch(error){if(this.validSession())this.setData({error:error.message})}
    finally {if(this.validSession())this.setData({submitting:false})}
  },
  async downloadPackage() {
    const external=this.data.detail?.external
    if(!external?.packageUrl)return
    wx.setClipboardData({data:external.packageUrl})
  }
})
