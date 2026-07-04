import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "video.js/dist/video-js.css";
import "./styles.css";
import { LiveSync } from "./components/LiveSync";
import { Toaster } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";

const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const Login = lazy(() => import("./pages/Login").then((module) => ({ default: module.Login })));
const Player = lazy(() => import("./pages/Player").then((module) => ({ default: module.Player })));
const TorrentDetail = lazy(() => import("./pages/TorrentDetail").then((module) => ({ default: module.TorrentDetail })));
const FilesPage = lazy(() => import("./pages/FilesPage").then((module) => ({ default: module.FilesPage })));
const SystemPage = lazy(() => import("./pages/SystemPage").then((module) => ({ default: module.SystemPage })));

function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="grid min-h-screen place-items-center bg-ink text-slate-300">Loading...</div>}>{children}</Suspense>;
}

const queryClient = new QueryClient();
const router = createBrowserRouter([
  { path: "/", element: <Page><Dashboard /></Page> },
  { path: "/files", element: <Page><FilesPage /></Page> },
  { path: "/system", element: <Page><SystemPage /></Page> },
  { path: "/login", element: <Page><Login /></Page> },
  { path: "/torrents/:id", element: <Page><TorrentDetail /></Page> },
  { path: "/watch/:id", element: <Page><Player /></Page> }
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <LiveSync />
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
