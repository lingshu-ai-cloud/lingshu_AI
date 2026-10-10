Page({data:{url:'',error:''},onLoad(query){const url=decodeURIComponent(query.url || '');if(/^https:\/\//.test(url))this.setData({url});else this.setData({error:'授权地址无效，请返回刷新事项'})}})
