import { Languages, Hospital, Stethoscope } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { RequireAdmin, useAuth } from "@/auth";
import BottomNav from "@/components/BottomNav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { useHospital } from "@/hospital";
import { useAutoDistractFree } from "@/hooks/useAutoDistractFree";
import { clearDoctorDraft } from "@/lib/doctorDraft";
import { cn } from "@/lib/utils";
import AccountPage from "@/routes/AccountPage";
import AdminPage from "@/routes/AdminPage";
import DoctorPage from "@/routes/DoctorPage";
import HospitalPage from "@/routes/HospitalPage";
import LoginPage from "@/routes/LoginPage";
import SurveysPage from "@/routes/SurveysPage";

function LanguageToggle() {
  const { i18n } = useTranslation();
  const currentLang = i18n.language?.startsWith("bn") ? "bn" : "en";

  const toggleLanguage = () => {
    const nextLang = currentLang === "en" ? "bn" : "en";
    void i18n.changeLanguage(nextLang);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs font-semibold shrink-0 text-muted-foreground hover:text-foreground"
      onClick={toggleLanguage}
      title="Switch language / ভাষা পরিবর্তন করুন"
    >
      <Languages className="mr-1 size-3.5 text-primary" aria-hidden />
      {currentLang === "en" ? "বাংলা" : "EN"}
    </Button>
  );
}

/** Title bar only. Navigation lives in BottomNav and sign-out on /account,
 *  which is where a phone app puts them. */
function Header({ hidden }: { hidden: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { hospital, doctorsAdded, exitHospital } = useHospital();

  if (!user) return null;

  const isDoctorRoute = location.pathname === "/doctors" && hospital !== null;

  return (
    <header
      className={cn(
        "sticky top-0 z-10 border-b bg-background/95 backdrop-blur transition-transform duration-300 ease-in-out",
        hidden && "-translate-y-full",
      )}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-2.5">
        {isDoctorRoute ? (
          <>
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <Hospital className="size-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate text-sm font-semibold tracking-tight">
                {hospital.hospital_name}
              </span>
              <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 font-medium">
                {doctorsAdded} {t("header.filed")}
              </Badge>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                size="sm"
                className="h-7 px-2.5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-xs transition-all"
                onClick={() => {
                  clearDoctorDraft();
                  exitHospital();
                  navigate("/");
                }}
              >
                {t("header.new_hospital")}
              </Button>
              <LanguageToggle />
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Stethoscope className="size-5 shrink-0 text-primary" aria-hidden />
              <span className="font-semibold tracking-tight">{t("header.doctor_form")}</span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Badge variant="secondary">
                {user.role}
              </Badge>
              <LanguageToggle />
            </div>
          </>
        )}
      </div>
    </header>
  );
}

export default function App() {
  const { user, loading } = useAuth();
  const hidden = useAutoDistractFree();

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (!user) return <LoginPage />;

  return (
    <>
      <Header hidden={hidden} />
      {/* Padding clears the fixed bar so the last control on a page stays
          tappable; without it the bar sits on top of page content. */}
      <div
        className={cn(
          "transition-[padding-bottom] duration-300 ease-in-out",
          hidden
            ? "pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "pb-[calc(3.5rem+env(safe-area-inset-bottom))]",
        )}
      >
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
      <BottomNav hidden={hidden} />
      <Toaster richColors position="top-center" />
    </>
  );
}
