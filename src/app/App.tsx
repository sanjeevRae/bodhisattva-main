import { useState, useEffect, Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router";
import { motion, MotionConfig } from "motion/react";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import CartDrawer from "./components/CartDrawer";
import SitePopup from "./components/SitePopup";
import { CustomerProvider } from "./lib/customer";
import { routeMeta, setPageMeta } from "./lib/meta";
import { useWebsiteProtection } from "./components/shared";
import HomePage from "./pages/HomePage";
import MuseumPage from "./pages/MuseumPage";
import GalleryPage from "./pages/GalleryPage";
import GiftShopPage from "./pages/GiftShopPage";
import NewsPage from "./pages/NewsPage";
import NewsArticlePage from "./pages/NewsArticlePage";
import FoundationPage from "./pages/FoundationPage";
import AboutPage from "./pages/AboutPage";
import LoginPage from "./pages/LoginPage";
import RegisterPage from "./pages/RegisterPage";
import VerifyEmailPage from "./pages/VerifyEmailPage";
import { ForgotPasswordPage, ResetPasswordPage } from "./pages/PasswordPages";
import AccountPage from "./pages/AccountPage";
import AccountOrdersPage from "./pages/AccountOrdersPage";
import AccountAddressesPage from "./pages/AccountAddressesPage";
import CheckoutPage from "./pages/CheckoutPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

/**
 * Applies the route's document metadata on every navigation, so tab
 * titles and share tags always describe the page being viewed (the
 * article page refines its own entry once the record has loaded).
 */
function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = routeMeta(pathname);
    setPageMeta({ ...meta, path: pathname });
  }, [pathname]);
  return null;
}

function Shell() {
  const [dark, setDark] = useState(false);
  const contentObscured = useWebsiteProtection();
  const location = useLocation();

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <CustomerProvider>
      <div className="min-h-screen bg-background text-foreground">
        <div className={`protected-content ${contentObscured ? "is-obscured" : ""}`}>
          <Nav dark={dark} onToggleDark={() => setDark((d) => !d)} />
          <main>
            <motion.div key={location.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}>
              <Routes location={location}>
                <Route path="/" element={<HomePage />} />
                <Route path="/museum" element={<MuseumPage />} />
                <Route path="/gallery" element={<GalleryPage />} />
                <Route path="/shop" element={<GiftShopPage />} />
                <Route path="/news" element={<NewsPage />} />
                {/* News Clippings article reader + draft preview (the
                    preview route must precede :slug is unnecessary —
                    React Router ranks the static segment higher — but
                    keep them adjacent for readers). */}
                <Route path="/news/preview/:token" element={<NewsArticlePage preview />} />
                <Route path="/news/:slug" element={<NewsArticlePage />} />
                <Route path="/foundation" element={<FoundationPage />} />
                <Route path="/about" element={<AboutPage />} />
                {/* Customer accounts + checkout (Phase 6). These paths are
                    in RESERVED_SLUGS so a CMS page can never shadow them. */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                <Route path="/reset-password" element={<ResetPasswordPage />} />
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/account" element={<AccountPage />} />
                <Route path="/account/orders" element={<AccountOrdersPage />} />
                <Route path="/account/addresses" element={<AccountAddressesPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </motion.div>
          </main>
          <Footer />
        </div>
        <CartDrawer />
        <SitePopup />
        {contentObscured && (
          <div className="privacy-screen" aria-hidden="true">
            <span>Content protected — click anywhere to resume viewing</span>
          </div>
        )}
      </div>
    </CustomerProvider>
  );
}

// The admin SPA is code-split: it loads only when an /admin URL is
// visited, and it renders OUTSIDE the public Shell — no site Nav/Footer
// and no useWebsiteProtection (admins must be able to copy text and use
// devtools; see src/admin/AdminApp.tsx).
const AdminApp = lazy(() => import("../admin/AdminApp"));

export default function App() {
  return (
    <MotionConfig reducedMotion="user">
    <BrowserRouter>
      <ScrollToTop />
      <RouteMeta />
      <Routes>
        <Route
          path="/admin/*"
          element={
            <Suspense
              fallback={
                <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
                  Loading admin…
                </div>
              }
            >
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Shell />} />
      </Routes>
    </BrowserRouter>
    </MotionConfig>
  );
}
