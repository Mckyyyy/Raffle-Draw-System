import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LiveDraw from './pages/LiveDraw.jsx';
import Winners from './pages/Winners.jsx';
import Audit from './pages/Audit.jsx';
import Admin from './pages/Admin.jsx';
import Sidebar from './components/Sidebar.jsx';
import './styles.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<LiveDraw />} />
            <Route path="/winners" element={<Winners />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/audit/:drawId" element={<Audit />} />
            <Route path="/admin" element={<Admin />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
