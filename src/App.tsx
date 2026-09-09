import { Navigate, Route, Routes } from "react-router-dom";
import { BookPage } from "./pages/Book";
import { ExplorePage } from "./pages/Explore";
import { ListingDetailPage } from "./pages/ListingDetail";
import { LoginPage } from "./pages/Login";
import { TripDetailPage } from "./pages/TripDetail";
import { TripsPage } from "./pages/Trips";
import { HostListingsPage } from "./pages/HostListings";
import { HostListingEditPage } from "./pages/HostListingEdit";
import { HostPayoutsPage } from "./pages/HostPayouts";
import { HostClaimsPage } from "./pages/HostClaims";
import { HostClaimDetailPage } from "./pages/HostClaimDetail";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/explore" replace />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="/listing/:id" element={<ListingDetailPage />} />
      <Route path="/book/:listingId" element={<BookPage />} />
      <Route path="/trips" element={<TripsPage />} />
      <Route path="/trips/:bookingId" element={<TripDetailPage />} />
      <Route path="/host/listings" element={<HostListingsPage />} />
      <Route path="/host/listings/:listingId" element={<HostListingEditPage />} />
      <Route path="/host/payouts" element={<HostPayoutsPage />} />
      <Route path="/host/claims" element={<HostClaimsPage />} />
      <Route path="/host/claims/:claimId" element={<HostClaimDetailPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Navigate to="/explore" replace />} />
    </Routes>
  );
}
