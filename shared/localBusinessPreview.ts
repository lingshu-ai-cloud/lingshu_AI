/** Local development projection only. Never a task, customer or provider receipt. */
export interface LocalBusinessPreview {
  companyName: string; industry: string; markets: string; description: string;
  productCount: number;
  products: Array<{ id: string; name: string; category: string; imageUrl: string }>;
}
