import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router";
import { motion } from "motion/react";
import Nav from "./components/Nav";
import Footer from "./components/Footer";
import { useWebsiteProtection } from "./components/shared";
import HomePage from "./pages/HomePage";
import MuseumPage from "./pages/MuseumPage";
import GalleryPage from "./pages/GalleryPage";
import GiftShopPage from "./pages/GiftShopPage";
import NewsPage from "./pages/NewsPage";
import FoundationPage from "./pages/FoundationPage";
import AboutPage from "./pages/AboutPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
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
              <Route path="/foundation" element={<FoundationPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </motion.div>
        </main>
        <Footer />
      </div>
      {contentObscured && <div className="privacy-screen" aria-hidden="true" />}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Shell />
    </BrowserRouter>
  );
}
