import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import RouteLayout from '@components/layout/route-layout';

// Each page is a thin wrapper around one interaction panel with no shared state,
// so route-level splitting keeps a page's panel code (SVG art, DNA helix, …) out
// of everyone else's first-load bundle.
const HomePage = lazy(() => import('@pages/home'));
const PetsPage = lazy(() => import('@pages/pets'));
const TowerPage = lazy(() => import('@pages/tower'));
const BreedPage = lazy(() => import('@pages/breed'));
const BattlePage = lazy(() => import('@pages/battle'));
const TeamBattlePage = lazy(() => import('@pages/team-battle'));
const LevelUpPage = lazy(() => import('@pages/level-up'));
const TrainPage = lazy(() => import('@pages/train'));
const MarriagePage = lazy(() => import('@pages/marriage'));
const RenamePage = lazy(() => import('@pages/rename'));
const LeaderboardPage = lazy(() => import('@pages/leaderboard'));
const ChatPage = lazy(() => import('@pages/chat'));
const InventoryPage = lazy(() => import('@pages/inventory'));
const LedgerPage = lazy(() => import('@pages/ledger'));
// SCRATCH — remove after visual verification.
const BattleOverlayPreview = lazy(() => import('@pages/__preview/battle-overlay-preview'));

/** Matches the loading state used elsewhere (pet-gallery, interaction standalone). */
const RouteFallback: React.FC = () => (
    <div className="loading-container">
        <div className="loading-spinner" />
    </div>
);

/** App route tree — pages render regardless of wallet state; features gate themselves internally. */
const AppRoutes: React.FC = () => {
    return (
        <Suspense fallback={<RouteFallback />}>
            <Routes>
                <Route element={<RouteLayout />}>
                    <Route path="/main" element={<HomePage />} />
                    <Route path="/pets" element={<PetsPage />} />
                    <Route path="/tower" element={<TowerPage />} />
                    <Route path="/breed" element={<BreedPage />} />
                    {/* :roomId is optional — set once Start Battle mints a room id
                        (see useBattlePanel's handleBattle), same page either way. */}
                    <Route path="/battle/:roomId?" element={<BattlePage />} />
                    <Route path="/team-battle" element={<TeamBattlePage />} />
                    <Route path="/levelup" element={<LevelUpPage />} />
                    <Route path="/train" element={<TrainPage />} />
                    <Route path="/marriage" element={<MarriagePage />} />
                    <Route path="/rename" element={<RenamePage />} />
                    <Route path="/leaderboard" element={<LeaderboardPage />} />
                    <Route path="/messages" element={<ChatPage />} />
                    <Route path="/inventory" element={<InventoryPage />} />
                    <Route path="/ledger" element={<LedgerPage />} />
                </Route>
                <Route path="/__preview/battle-overlay" element={<BattleOverlayPreview />} />
                <Route path="*" element={<Navigate to="/main" replace />} />
            </Routes>
        </Suspense>
    );
};

export default AppRoutes;
