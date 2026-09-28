export interface DiscoveryCatalogProduct {
  id: string;
  name: string;
  category: string;
  text: string;
  files: Array<{ id: string; name: string; url: string; size: number; available: boolean }>;
}

export function selectDiscoveryCatalog(products: DiscoveryCatalogProduct[], productIds: string[], fileIds: string[]) {
  const selectedProducts = products.filter(product => productIds.includes(product.id));
  const selectedFiles = products.flatMap(product => product.files).filter(file => fileIds.includes(file.id));
  if (selectedProducts.length !== new Set(productIds).size || selectedFiles.length !== new Set(fileIds).size) throw new Error('所选资料已变化，请刷新目录');
  if (selectedFiles.some(file => !file.available)) throw new Error('所选文件暂不支持直接读取');
  return { products: selectedProducts, files: selectedFiles };
}
