import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installErrorReporting } from './lib/telemetry';

// App provides its own QueryClientProvider and BrowserRouter — do not wrap them
// again here, or React Router throws "cannot render a <Router> inside another".
installErrorReporting();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
