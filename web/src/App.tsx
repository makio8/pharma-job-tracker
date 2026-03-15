import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import JobsPage from './pages/JobsPage.tsx';
import TrendsPage from './pages/TrendsPage.tsx';
import CompanyPage from './pages/CompanyPage.tsx';
import PipelinePage from './pages/PipelinePage.tsx';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/trends" element={<TrendsPage />} />
          <Route path="/companies/:id" element={<CompanyPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
