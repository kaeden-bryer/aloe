/**
 * Demo sign-in. A "Sign in as" picker over the seeded personas: it creates a
 * real server session (cookie), so everything after the click is the real
 * auth path. When GitHub sign-in arrives it replaces only this picker.
 */
import type { ReactNode } from "react";
import type { DemoUser } from "@aloe/core/contracts";
import { useAuth, useDemoUsers, useProjects, useSignOut, useSwitchUser } from "../api/hooks";
import { Brand } from "../components/Brand";

/** Renders its children only when someone is signed in; otherwise the sign-in screen. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { data: auth, isPending } = useAuth();
  if (isPending) return <p className="loading">Loading…</p>;
  if (!auth?.user) return <SignInScreen />;
  return <>{children}</>;
}

function useRoleLabel() {
  const { data: projects = [] } = useProjects();
  return (u: DemoUser) =>
    u.role === "maintainer"
      ? `Maintainer of ${u.maintainerOf.map((id) => projects.find((p) => p.id === id)?.name ?? id).join(", ")}`
      : "Donor";
}

function SignInScreen() {
  const { data: users, isPending, isError } = useDemoUsers();
  const label = useRoleLabel();
  const sw = useSwitchUser();
  return (
    <div className="signin">
      <Brand logoSize={28} />
      <div style={{ height: 28 }} />
      <h1 className="page-title">Sign in</h1>
      {isError ? (
        <p className="page-lede">Sign-in isn't switched on for this server yet. (GitHub sign-in is coming; for the demo, set ALOE_DEMO_LOGIN=1.)</p>
      ) : (
        <>
          <p className="page-lede">This is a demo: pick who you want to be. Donors give agent time; maintainers make the calls on their own project.</p>
          {isPending && <p className="loading">Loading…</p>}
          <div className="signin-list">
            {users?.map((u) => (
              <button key={u.id} type="button" className="signin-person" disabled={sw.isPending} onClick={() => sw.mutate(u.id)}>
                <span className="n">{u.name}</span>
                <span className="r">{label(u)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Sidebar control: switch persona in one click (demo), or sign out. Hidden when demo login is off. */
export function PersonaPicker() {
  const { data: auth } = useAuth();
  const { data: users } = useDemoUsers();
  const label = useRoleLabel();
  const sw = useSwitchUser();
  const out = useSignOut();
  if (!auth?.user) return null;
  return (
    <div className="persona">
      {users && (
        <label>
          Sign in as (demo)
          <select value={auth.user.id} disabled={sw.isPending} onChange={(e) => sw.mutate(e.target.value)}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {label(u)}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className="ghost signout" disabled={out.isPending} onClick={() => out.mutate()}>
        Sign out
      </button>
    </div>
  );
}
