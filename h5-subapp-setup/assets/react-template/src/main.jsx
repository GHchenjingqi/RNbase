import React from 'react';
import { createRoot } from 'react-dom/client';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import Home from './Home';
import About from './About';

// 必须 hash 模式：子包以 file:// 加载，无服务器 rewrite，browser 模式会白屏
const router = createHashRouter([
  { path: '/', element: <Home /> },
  { path: '/about', element: <About /> },
]);

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
