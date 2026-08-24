import { Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell';
import { TodayPage } from '../features/home/TodayPage';
import { LibraryPage } from '../features/library/LibraryPage';
import { ResourcePage } from '../features/library/ResourcePage';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<TodayPage />} />
        <Route path="bibliotheque" element={<LibraryPage />} />
        <Route path="bibliotheque/:resourceId" element={<ResourcePage />} />
      </Route>
    </Routes>
  );
}
