/** Reserved local preview namespaces; classification never rewrites a provider/API record. */
export const isLocalExampleAd = (id: string) => id.startsWith('mock-ft-');
export const isLocalExampleCustomer = (id: string) => id.startsWith('mock-export-');
