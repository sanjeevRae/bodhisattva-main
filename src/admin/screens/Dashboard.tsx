/**
 * Dashboard — a stub with live counts from the admin APIs and quick
 * links. Each card fails independently (shows "—") so one broken module
 * never blanks the landing screen.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FileText, Images, Menu as MenuIcon, Settings as SettingsIcon, Users as UsersIcon } from "lucide-react";
import { mediaApi, menusApi, pagesApi, settingsApi, usersApi } from "../api";
import { useAuth } from "../AdminApp";
import { Spinner } from "../ui";

interface Counts {
  pages?: number;
  media?: number;
  menus?: number;
  settings?: number;
  users?: number;
  pendingInvitations?: number;
}

export default function Dashboard() {
  const { user, hasPermission } = useAuth();
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let alive = true;
    const collect = (patch: Partial<Counts>) => {
      if (alive) setCounts((prev) => ({ ...(prev ?? {}), ...patch }));
    };
    if (hasPermission("cms.pages.read")) {
      pagesApi.list().then((d) => collect({ pages: d.items.length })).catch(() => undefined);
    }
    if (hasPermission("media.read")) {
      mediaApi.list({ page: 1, pageSize: 1 }).then((d) => collect({ media: d.meta.total })).catch(() => undefined);
    }
    if (hasPermission("cms.menus.manage")) {
      menusApi.list().then((d) => collect({ menus: d.items.length })).catch(() => undefined);
    }
    if (hasPermission("settings.manage")) {
      settingsApi.list().then((d) => collect({ settings: d.items.length })).catch(() => undefined);
    }
    if (hasPermission("roles.read")) {
      usersApi.list(1, 1).then((d) => collect({ users: d.meta.total })).catch(() => undefined);
      usersApi
        .listInvitations(1, 100)
        .then((d) => collect({ pendingInvitations: d.items.filter((i) => i.status === "PENDING").length }))
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // hasPermission identity changes with permissions load — intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = [
    { to: "/admin/pages", label: "Pages", icon: <FileText size={22} />, value: counts?.pages, hint: "Edit site pages in the visual builder" },
    { to: "/admin/media", label: "Media assets", icon: <Images size={22} />, value: counts?.media, hint: "Upload and organise images" },
    { to: "/admin/menus", label: "Menus", icon: <MenuIcon size={22} />, value: counts?.menus, hint: "Header and footer navigation" },
    { to: "/admin/settings", label: "Settings", icon: <SettingsIcon size={22} />, value: counts?.settings, hint: "Site-wide values and contact details" },
    {
      to: "/admin/users",
      label: "Users",
      icon: <UsersIcon size={22} />,
      value: counts?.users,
      hint: counts?.pendingInvitations ? `${counts.pendingInvitations} invitation(s) pending` : "Accounts, roles and invitations",
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-wide">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Welcome{user ? `, ${user.name}` : ""}. Everything published on the site is managed from here.
        </p>
      </div>
      {counts === null ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.to}
              to={card.to}
              className="group rounded-sm border border-border bg-card p-5 transition-colors hover:border-accent/60"
            >
              <div className="flex items-start justify-between">
                <span className="text-accent">{card.icon}</span>
                <span className="font-display text-4xl">{card.value ?? "—"}</span>
              </div>
              <p className="mt-3 font-medium">{card.label}</p>
              <p className="text-sm text-muted-foreground">{card.hint}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
