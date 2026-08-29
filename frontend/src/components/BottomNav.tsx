import { ClipboardList, Hospital, Shield, User } from "lucide-react";
import { NavLink } from "react-router-dom";

import { useAuth } from "@/auth";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Hospital", icon: Hospital },
  { to: "/surveys", label: "Surveys", icon: ClipboardList },
  { to: "/account", label: "Account", icon: User },
];

/** Fixed bottom tab bar.
 *
 *  Deliberately not rendered on /doctors: the doctor form is not persisted -
 *  only the hospital is - so a stray tab tap mid-entry would silently discard
 *  everything typed. That screen has its own "New hospital" button as the
 *  intended way out.
 */
export default function BottomNav() {
  const { user } = useAuth();
  const tabs =
    user?.role === "admin"
      ? [...TABS, { to: "/admin", label: "Admin", icon: Shield }]
      : TABS;

  return (
    <nav
      // pb keeps the row clear of the iOS home indicator.
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      aria-label="Main"
    >
      <ul className="mx-auto flex max-w-3xl">
        {tabs.map(({ to, label, icon: Icon }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              // "/" would otherwise match every route.
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon
                    className={cn("size-5", isActive && "fill-primary/10")}
                    aria-hidden
                  />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
