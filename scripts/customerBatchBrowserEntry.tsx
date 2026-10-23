import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import '../src/styles/design-system.css';
import CustomerBatchPanel from '../src/components/customers/CustomerBatchPanel';
createRoot(document.getElementById('root')!).render(<CustomerBatchPanel runId="browser-run" onSaved={async()=>{}}/>);
