/**
 * Layout for the signed-in screens: sidebar on the left, the current route
 * rendered into <Outlet /> on the right. NavLink adds the "active" class for
 * the current URL, which replaces the prototype's navDashStyle/... flags.
 */
import { NavLink, Outlet, useLocation } from "react-router";
import { useMe, useProjects } from "../api/hooks";
import { donorStatus } from "../lib/donor";
import { initials } from "../lib/format";
import { Brand } from "./Brand";
import { PersonaPicker, RequireSignIn } from "../screens/SignIn";
import { DashboardIcon, MarketIcon, SettingsIcon } from "./Icons";

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? "nav-item ghost active" : "nav-item ghost");

/** The signed-in layout. Signed-out visitors get the sign-in screen instead of the app. */
export function AppShell() {
  return (
    <RequireSignIn>
      <Shell />
    </RequireSignIn>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const { data: me } = useMe();
  const { data: projects = [] } = useProjects();
  const backed = (me?.backings ?? []).map((id) => projects.find((p) => p.id === id)).filter((p) => p !== undefined);
  const status = donorStatus(me);

  return (
    <div className="shell">
      <aside aria-label="Aloe navigation" className="sidebar">
        <Brand logoSize={24} />
        <div style={{ height: 10 }} />
        {/* The market stays highlighted while you look at a project, as in the design. */}
        <NavLink to="/market" className={({ isActive }) => navClass({ isActive: isActive || pathname.startsWith("/projects/") })}>
          <MarketIcon />
          Market
        </NavLink>
        <NavLink to="/dashboard" className={navClass}>
          <DashboardIcon />
          Dashboard
        </NavLink>
        <NavLink to="/settings" className={navClass}>
          <SettingsIcon />
          Settings
        </NavLink>

        <p className="nav-label">Backing</p>
        {backed.map((p) => (
          <NavLink key={p.id} to={`/projects/${p.id}`} className={(a) => navClass(a) + " is-project"}>
            <span className="e">{p.emoji}</span>
            <span className="n">{p.name}</span>
          </NavLink>
        ))}
        {me && me.backings.length === 0 && <p className="nav-empty">No projects yet. Open one in the market to back it.</p>}

        <div style={{ flex: 1, minHeight: 24 }} />

        <div className="status-card">
          <div className="status-card-head">
            <span className={status.on ? "status-dot is-on" : "status-dot"} />
            {status.title}
          </div>
          <p>{status.sub}</p>
        </div>
        <div className="account">
          <span className="avatar" aria-hidden="true">{initials(me?.name ?? "")}</span>
          <span className="account-text">
            <span className="n">{me?.name ?? " "}</span>
            <span className="s">{me && me.devices.length > 0 ? "Claude Pro connected" : "No agent paired yet"}</span>
          </span>
        </div>
        <PersonaPicker />
      </aside>

      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
