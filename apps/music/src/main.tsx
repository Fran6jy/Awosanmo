import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import "./styles.css";
import { Layout } from "./components/Layout";
import { Toaster } from "./components/Toast";
import { restoreSession, token } from "./lib/api";
import { installKeyboardShortcuts } from "./lib/player";

const Home = lazy(() => import("./pages/Home").then((m) => ({ default: m.Home })));
const SearchPage = lazy(() => import("./pages/SearchPage").then((m) => ({ default: m.SearchPage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const AlbumPage = lazy(() => import("./pages/AlbumPage").then((m) => ({ default: m.AlbumPage })));
const ArtistPage = lazy(() => import("./pages/ArtistPage").then((m) => ({ default: m.ArtistPage })));
const GenrePage = lazy(() => import("./pages/GenrePage").then((m) => ({ default: m.GenrePage })));
const PlaylistPage = lazy(() => import("./pages/PlaylistPage").then((m) => ({ default: m.PlaylistPage })));
const LikedPage = lazy(() => import("./pages/PlaylistPage").then((m) => ({ default: m.LikedPage })));
const Login = lazy(() => import("./pages/Login").then((m) => ({ default: m.Login })));

const fallback = <div className="grid min-h-[50vh] place-items-center text-muted">Loading…</div>;

/** Everything inside the app shell requires a session; the player persists across routes. */
function Shell() {
  if (!token()) return <Navigate to="/login" replace />;
  return <Layout><Suspense fallback={fallback}><Outlet /></Suspense></Layout>;
}

const router = createBrowserRouter([
  { path: "/login", element: <Suspense fallback={fallback}><Login /></Suspense> },
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
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

async function start() {
  await restoreSession();
  installKeyboardShortcuts();
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
