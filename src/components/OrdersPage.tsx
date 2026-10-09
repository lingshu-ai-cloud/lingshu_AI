import { Empty } from 'antd';

export default function OrdersPage() {
  return (
    <div className="h-full overflow-y-auto bg-surface-2 px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-[1440px]">
        <h1 className="sr-only">我的订单</h1>
        <section className="rounded-lg border border-border bg-white px-6 py-16"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未接入订单数据。接入后将在这里展示订单与履约记录。"/></section>
      </div>
    </div>
  );
}
