/**
 * Routes: one URL per screen. The landing page and onboarding are full-bleed;
 * everything else shares the sidebar layout in <AppShell />.
 */
import { Navigate, Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { ScrollToTop } from "./components/ScrollToTop";
import { Dashboard } from "./screens/Dashboard";
import { Landing } from "./screens/Landing";
import { Market } from "./screens/Market";
import { Onboarding } from "./screens/Onboarding";
import { ProjectPage } from "./screens/ProjectPage";
import { Settings } from "./screens/Settings";
import { WeeklyEmailPreview } from "./screens/WeeklyEmailPreview";
import { MaintainerPage } from "./screens/maintainer/MaintainerPage";

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/start" element={<Onboarding />} />
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/market" element={<Market />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/maintain/:projectId" element={<MaintainerPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/weekly-email" element={<WeeklyEmailPreview />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
