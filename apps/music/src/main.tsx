import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import "./styles.css";
import { Layout } from "./components/Layout";
import { Toaster } from "./components/Toast";
import { restoreSession, token } from "./lib/api";
import { installKeyboardShortcuts } from "./lib/player";
import { startSession } from "./lib/session";
import { loadAccountSettings } from "./lib/settings";

const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const SearchPage = lazy(() => import("./pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const AlbumPage = lazy(() => import("./pages/AlbumPage").then((m) => ({ default: m.AlbumPage })));
const ArtistPage = lazy(() => import("./pages/ArtistPage").then((m) => ({ default: m.ArtistPage })));
const GenrePage = lazy(() => import("./pages/GenrePage").then((m) => ({ default: m.GenrePage })));
const PlaylistPage = lazy(() => import("./pages/PlaylistPage").then((m) => ({ default: m.PlaylistPage })));
const LikedPage = lazy(() => import("./pages/PlaylistPage").then((m) => ({ default: m.LikedPage })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));
const SharePage = lazy(() => import("./pages/SharePage").then((m) => ({ default: m.SharePage })));
const MixPage = lazy(() => import("./pages/MixPage").then((m) => ({ default: m.MixPage })));
const WrappedPage = lazy(() => import("./pages/WrappedPage").then((m) => ({ default: m.WrappedPage })));

const fallback = <div className="grid min-h-[50vh] place-items-center text-muted">Loading…</div>;

/** Everything inside the app shell requires a session; the player persists across routes. */
function Shell() {
  if (!token()) return <Navigate to="/login" replace />;
  return <Layout><Suspense fallback={fallback}><Outlet /></Suspense></Layout>;
}

const router = createBrowserRouter([
  { path: "/login", element: <Suspense fallback={fallback}><Login /></Suspense> },
  // Public share pages: no session required, no app shell.
  { path: "/s/:slug", element: <Suspense fallback={fallback}><SharePage /></Suspense> },
  {
    element: <Shell />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/search", element: <SearchPage /> },
      { path: "/library", element: <LibraryPage /> },
      { path: "/liked", element: <LikedPage /> },
      { path: "/album/:id", element: <AlbumPage /> },
      { path: "/artist/:id", element: <ArtistPage /> },
      { path: "/genre/:name", element: <GenrePage /> },
      { path: "/playlist/:id", element: <PlaylistPage /> },
      { path: "/mix/:id", element: <MixPage kind="mix" /> },
      { path: "/mood/:id", element: <MixPage kind="mood" /> },
      { path: "/wrapped", element: <WrappedPage /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

async function start() {
  const authed = await restoreSession();
  installKeyboardShortcuts();
  // Learn what (if anything) is playing on the account's other devices.
  if (authed) { void startSession(); void loadAccountSettings(); }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
void start();
