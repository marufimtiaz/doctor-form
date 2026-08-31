import { ClipboardList, Hospital, Shield, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";

import { useAuth } from "@/auth";
import { cn } from "@/lib/utils";

/** Fixed bottom tab bar. */
export default function BottomNav({ hidden = false }: { hidden?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();

  const tabs = [
    { to: "/", label: t("nav.hospitals"), icon: Hospital },
    { to: "/surveys", label: t("nav.surveys"), icon: ClipboardList },
    { to: "/account", label: t("nav.account"), icon: User },
    ...(user?.role === "admin"
      ? [{ to: "/admin", label: t("nav.admin"), icon: Shield }]
      : []),
  ];

  return (
    <nav
      // pb keeps the row clear of the iOS home indicator.
      className={cn(
        "fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur transition-transform duration-300 ease-in-out",
        hidden && "translate-y-full",
      )}
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-3xl">
        {tabs.map(({ to, label, icon: Icon }) => {
          const isTabActive = (isActive: boolean) =>
            isActive || (to === "/" && location.pathname === "/doctors");

          return (
            <li key={to} className="flex-1">
              <NavLink
                to={to}
                // "/" would otherwise match every route.
                end={to === "/"}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                    isTabActive(isActive)
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={cn("size-5", isTabActive(isActive) && "fill-primary/10")}
                      aria-hidden
                    />
                    <span>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
