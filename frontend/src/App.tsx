import { Stethoscope } from "lucide-react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { RequireAdmin, useAuth } from "@/auth";
import BottomNav from "@/components/BottomNav";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import AccountPage from "@/routes/AccountPage";
import AdminPage from "@/routes/AdminPage";
import DoctorPage from "@/routes/DoctorPage";
import HospitalPage from "@/routes/HospitalPage";
import LoginPage from "@/routes/LoginPage";
import SurveysPage from "@/routes/SurveysPage";

/** Title bar only. Navigation lives in BottomNav and sign-out on /account,
 *  which is where a phone app puts them. */
function Header() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <Stethoscope className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="font-semibold tracking-tight">Doctor Form</span>
        <Badge variant="secondary" className="ml-auto">
          {user.role}
        </Badge>
      </div>
    </header>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!user) return <LoginPage />;

  const showNav = pathname !== "/doctors";

  return (
    <>
      <Header />
      {/* Padding clears the fixed bar so the last control on a page stays
          tappable; without it the bar sits on top of page content. */}
      <div className={showNav ? "pb-[calc(4rem+env(safe-area-inset-bottom))]" : ""}>
        <Routes>
          <Route path="/" element={<HospitalPage />} />
          <Route path="/doctors" element={<DoctorPage />} />
          <Route path="/surveys" element={<SurveysPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      {showNav && <BottomNav />}
      <Toaster richColors position="top-center" />
    </>
  );
}
