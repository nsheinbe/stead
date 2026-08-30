import { Navigate, Route, Routes } from "react-router-dom";
import { BookPage } from "./pages/Book";
import { ExplorePage } from "./pages/Explore";
import { ListingDetailPage } from "./pages/ListingDetail";
import { LoginPage } from "./pages/Login";
import { TripDetailPage } from "./pages/TripDetail";
import { TripsPage } from "./pages/Trips";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/explore" replace />} />
      <Route path="/explore" element={<ExplorePage />} />
      <Route path="/listing/:id" element={<ListingDetailPage />} />
      <Route path="/book/:listingId" element={<BookPage />} />
      <Route path="/trips" element={<TripsPage />} />
      <Route path="/trips/:bookingId" element={<TripDetailPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Navigate to="/explore" replace />} />
    </Routes>
  );
}
