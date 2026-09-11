import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { RouteAnnouncer } from "./components/RouteAnnouncer";
import { BookPage } from "./pages/Book";
import { ExplorePage } from "./pages/Explore";
import { ForHomeownersPage } from "./pages/ForHomeowners";
import { HostStartPage } from "./pages/HostStart";
import { LandingPage } from "./pages/Landing";
import { ListingDetailPage } from "./pages/ListingDetail";
import { LoginPage } from "./pages/Login";
import { ListingMessageRedirect, MessagesPage, MessageThreadPage } from "./pages/Messages";
import { NotFoundPage } from "./pages/NotFound";
import { TripDetailPage } from "./pages/TripDetail";
import { TripsPage } from "./pages/Trips";
import { HostListingsPage } from "./pages/HostListings";
import { HostListingEditPage } from "./pages/HostListingEdit";
import { HostPayoutsPage } from "./pages/HostPayouts";
import { HostClaimsPage } from "./pages/HostClaims";
import { HostClaimDetailPage } from "./pages/HostClaimDetail";
import { PassportPage } from "./pages/Passport";
import { OpsPage } from "./pages/Ops";
import { ReviewPage } from "./pages/Review";

// Development-only component gallery. Never registered in a production build,
// so it is neither a route nor a chunk there.
const UiGalleryPage = import.meta.env.DEV ? lazy(() => import("./pages/dev/UiGallery")) : null;

export function App() {
  return (
    <>
      <RouteAnnouncer />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/for-homeowners" element={<ForHomeownersPage />} />
        <Route path="/listing/:id" element={<ListingDetailPage />} />
        <Route path="/book/:listingId" element={<BookPage />} />
        <Route path="/trips" element={<TripsPage />} />
        <Route path="/trips/:bookingId" element={<TripDetailPage />} />
        <Route path="/messages" element={<MessagesPage />} />
        <Route path="/messages/:listingId" element={<ListingMessageRedirect />} />
        <Route path="/messages/:listingId/:guestId" element={<MessageThreadPage />} />
        <Route path="/review/:bookingId" element={<ReviewPage />} />
        <Route path="/passport/:userId" element={<PassportPage />} />
        <Route path="/host/start" element={<HostStartPage />} />
        <Route path="/host/listings" element={<HostListingsPage />} />
        <Route path="/host/listings/:listingId" element={<HostListingEditPage />} />
        <Route path="/host/payouts" element={<HostPayoutsPage />} />
        <Route path="/host/claims" element={<HostClaimsPage />} />
        <Route path="/host/claims/:claimId" element={<HostClaimDetailPage />} />
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/login" element={<LoginPage />} />
        {UiGalleryPage ? (
          <Route
            path="/_ui"
            element={
              <Suspense fallback={null}>
                <UiGalleryPage />
              </Suspense>
            }
          />
        ) : null}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}
